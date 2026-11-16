import { v } from "convex/values";
import { internal } from "../_generated/api";
import {
  addAppointmentToGoogleCalendar as addAppointmentToGoogleCalendarUseCase,
  getAppointmentCalendarFile as getAppointmentCalendarFileUseCase,
  getCalendarConnection as getCalendarConnectionUseCase,
  loadCalendarAppointment,
  type AppointmentCalendarResult,
  type CalendarAppointmentContext,
} from "../application/calendar/calendar";
import { bookAppointment as bookAppointmentUseCase } from "../application/appointments/booking";
import {
  getOnlineAccess as getOnlineAccessUseCase,
  setOnlineAccessLink as setOnlineAccessLinkUseCase,
} from "../application/appointments/online_access";
import {
  cancelAppointment as cancelAppointmentUseCase,
  recordAppointmentAttendance as recordAppointmentAttendanceUseCase,
  rescheduleAppointment as rescheduleAppointmentUseCase,
  submitAppointmentJustification as submitAppointmentJustificationUseCase,
  reviewAppointmentJustification as reviewAppointmentJustificationUseCase,
} from "../application/appointments/changes";
import {
  getAppointment as getAppointmentUseCase,
  listAccompanimentAppointmentsUseCase,
  listAppointments as listAppointmentsUseCase,
} from "../application/appointments/queries";
import { action, mutation, query } from "../_generated/server";
import { APPOINTMENT_CONTRACT_VERSION } from "../domain/appointments/appointment";
import { AGENDA_TIME_ZONE } from "../domain/availability/availability";
import {
  accompanimentNeedsReader,
  authorizationReader,
} from "../infrastructure/accompaniments/repository";
import { appointmentAuditRecorder } from "../infrastructure/audit/repository";
import {
  appointmentAgendaReader,
  appointmentCalendarReader,
  appointmentChangeReader,
  appointmentListReader,
  appointmentOccupier,
  appointmentTransitionRepository,
  onlineAccessReader,
  onlineAccessStore,
} from "../infrastructure/appointments/repository";
import { availabilityReader } from "../infrastructure/availability/repository";
import {
  googleCalendarConnectionReader,
  googleCalendarGateway,
} from "../infrastructure/calendar/google_calendar";
import { notificationEventRecorder } from "../infrastructure/notifications/repository";
import { compatibilitySpaceSource } from "../infrastructure/spaces/repository";
import {
  accessNeedSelectionValidator,
  appointmentAttendanceOutcomeUnion,
  appointmentStatusUnion,
  justificationDecisionUnion,
  justificationReviewUnion,
  modalityUnion,
} from "../infrastructure/validators";
import { unwrapApiResult } from "./session";

/**
 * Borde de Presentación: reserva, cambios y consulta de atenciones
 * (TI2-111/TI2-121/TI2-112).
 *
 * Adaptadores delgados bajo `api.presentation.appointments`: validan la forma
 * del contrato v1 de TI2-87, resuelven la identidad en el servidor con
 * `ctx.auth.getUserIdentity()` y delegan en los casos de uso de TI2-98,
 * TI2-109, TI2-110 y TI2-112, compuestos con los adaptadores de TI2-86, TI2-95
 * y TI2-96. No tocan `ctx.db` ni deciden reglas: la pertenencia sale de la fila
 * leída en el servidor y el actor, del perfil de la sesión. Nunca aceptan un
 * `userId` del cliente como prueba.
 *
 * La reserva y el reagendamiento revalidan el destino contra la disponibilidad
 * vigente, siempre en la zona de la agenda (`AGENDA_TIME_ZONE`) que fija el
 * servidor: el cliente no envía zona horaria y no puede correr un cupo fuera
 * del horario publicado. La cancelación conserva la fila con su estado
 * terminal y el motivo; el reagendamiento mueve la misma fila; el registro
 * declara solo realización o inasistencia pendiente. La justificación posterior
 * es TI2-119 y todavía no tiene caso de uso persistido en `main`, así que no se
 * publica acá.
 *
 * Los errores se lanzan con la traducción compartida de TI2-88
 * (`ConvexError({code, message})`): `unauthorized` sin permiso o con un
 * identificador ajeno o inexistente, `conflict` ante una entrada inválida, un
 * estado que no admite el cambio o un cruce de ocupación, y `no_availability`
 * cuando el destino ya no existe o no es compatible. La respuesta de éxito es
 * la misma atención, sin datos de terceros.
 *
 * Cada reserva o cambio exitoso deja su evento mínimo de auditoría (TI2-128)
 * en la misma mutation; los errores abortan la mutation y no dejan evento. Las
 * consultas no escriben, así que no auditan la lectura, y ninguna entrada de
 * este archivo lee, edita ni borra la bitácora.
 *
 * Las consultas entregan solo la vista que autoriza el servidor, `full` o
 * `minimized`, y nunca `studentId`, notas ni necesidades de acceso. Opera con
 * datos ficticios.
 */

/** Éxito de una reserva o cambio: la misma atención, con identificador genérico. */
const appointmentResultValidator = v.object({ appointmentId: v.string() });

/**
 * Reserva el cupo elegido para un acompañamiento activo. El Estudiante dueño
 * reserva lo suyo; el Profesional asignado coordina en su nombre y puede sumar
 * profesionales adicionales y apoyos de la atención en línea (TI2-142). Un
 * Estudiante que envía adicionales o apoyos recibe `unauthorized`.
 */
export const bookAppointment = mutation({
  args: {
    accompanimentId: v.string(),
    professionalId: v.string(),
    modality: modalityUnion,
    spaceId: v.optional(v.string()),
    startAt: v.number(),
    endAt: v.number(),
    additionalProfessionalIds: v.optional(v.array(v.string())),
    onlineSupports: v.optional(v.array(accessNeedSelectionValidator)),
    version: v.literal(APPOINTMENT_CONTRACT_VERSION),
  },
  returns: appointmentResultValidator,
  handler: async (ctx, { version: _version, ...slot }) => {
    const identity = await ctx.auth.getUserIdentity();
    return unwrapApiResult(
      await bookAppointmentUseCase(
        {
          auth: authorizationReader(ctx),
          availability: availabilityReader(ctx),
          needs: accompanimentNeedsReader(ctx),
          compatibility: compatibilitySpaceSource(ctx),
          occupier: appointmentOccupier(ctx),
          audit: appointmentAuditRecorder(ctx),
        },
        { ...slot, timeZone: AGENDA_TIME_ZONE, tokenIdentifier: identity?.tokenIdentifier ?? null },
      ),
    );
  },
});

/**
 * Cancela una atención propia o a cargo del Profesional asignado. El destino
 * (`cancelled_by_student` o `cancelled_by_cereti`) lo decide el rol de la
 * sesión; el motivo es obligatorio para CERETI y opcional para el Estudiante.
 */
export const cancelAppointment = mutation({
  args: {
    appointmentId: v.string(),
    reason: v.optional(v.string()),
    version: v.literal(APPOINTMENT_CONTRACT_VERSION),
  },
  returns: appointmentResultValidator,
  handler: async (ctx, { version: _version, appointmentId, reason }) => {
    const identity = await ctx.auth.getUserIdentity();
    return unwrapApiResult(
      await cancelAppointmentUseCase(
        {
          auth: authorizationReader(ctx),
          appointments: appointmentChangeReader(ctx),
          persister: appointmentTransitionRepository(ctx).persister,
          audit: appointmentAuditRecorder(ctx),
        },
        {
          tokenIdentifier: identity?.tokenIdentifier ?? null,
          appointmentId,
          ...(reason === undefined ? {} : { reason }),
        },
      ),
    );
  },
});

/**
 * Mueve una atención a un cupo vigente y compatible. El cliente elige el
 * Profesional, la modalidad, la sala y el horario; el servidor revalida todo
 * con la misma regla de la reserva y descuenta la atención que se mueve. La
 * zona horaria no viaja en la entrada.
 */
export const rescheduleAppointment = mutation({
  args: {
    appointmentId: v.string(),
    professionalId: v.string(),
    modality: modalityUnion,
    spaceId: v.optional(v.string()),
    startAt: v.number(),
    endAt: v.number(),
    version: v.literal(APPOINTMENT_CONTRACT_VERSION),
  },
  returns: appointmentResultValidator,
  handler: async (ctx, { version: _version, appointmentId, ...slot }) => {
    const identity = await ctx.auth.getUserIdentity();
    return unwrapApiResult(
      await rescheduleAppointmentUseCase(
        {
          auth: authorizationReader(ctx),
          appointments: appointmentChangeReader(ctx),
          persister: appointmentTransitionRepository(ctx).persister,
          audit: appointmentAuditRecorder(ctx),
          occupier: appointmentOccupier(ctx),
          availability: availabilityReader(ctx),
          needs: accompanimentNeedsReader(ctx),
          compatibility: compatibilitySpaceSource(ctx),
        },
        {
          tokenIdentifier: identity?.tokenIdentifier ?? null,
          appointmentId,
          ...slot,
          timeZone: AGENDA_TIME_ZONE,
        },
      ),
    );
  },
});

/**
 * Registra que la atención se realizó o que el Estudiante no asistió. Solo el
 * Profesional asignado que la tiene a su cargo puede declararlo; la
 * justificación de la inasistencia queda para TI2-119.
 */
export const recordAppointmentAttendance = mutation({
  args: {
    appointmentId: v.string(),
    outcome: appointmentAttendanceOutcomeUnion,
    version: v.literal(APPOINTMENT_CONTRACT_VERSION),
  },
  returns: appointmentResultValidator,
  handler: async (ctx, { version: _version, appointmentId, outcome }) => {
    const identity = await ctx.auth.getUserIdentity();
    return unwrapApiResult(
      await recordAppointmentAttendanceUseCase(
        {
          auth: authorizationReader(ctx),
          appointments: appointmentChangeReader(ctx),
          persister: appointmentTransitionRepository(ctx).persister,
          audit: appointmentAuditRecorder(ctx),
        },
        {
          tokenIdentifier: identity?.tokenIdentifier ?? null,
          appointmentId,
          outcome,
        },
      ),
    );
  },
});

/**
 * El Estudiante dueño entrega la explicación y el respaldo de la inasistencia
 * dentro del plazo de cinco días hábiles (TI2-119). El respaldo se registra
 * como recepción por canal institucional: no se sube ni se guarda archivo.
 */
export const submitAppointmentJustification = mutation({
  args: {
    appointmentId: v.string(),
    explanation: v.string(),
    supportingDocumentReceived: v.boolean(),
    version: v.literal(APPOINTMENT_CONTRACT_VERSION),
  },
  returns: appointmentResultValidator,
  handler: async (
    ctx,
    { version: _version, appointmentId, explanation, supportingDocumentReceived },
  ) => {
    const identity = await ctx.auth.getUserIdentity();
    return unwrapApiResult(
      await submitAppointmentJustificationUseCase(
        {
          auth: authorizationReader(ctx),
          appointments: appointmentChangeReader(ctx),
          persister: appointmentTransitionRepository(ctx).persister,
        },
        {
          tokenIdentifier: identity?.tokenIdentifier ?? null,
          appointmentId,
          explanation,
          supportingDocumentReceived,
        },
      ),
    );
  },
});

/**
 * El Profesional asignado revisa la justificación pendiente y la acepta o
 * rechaza (TI2-119). Sin cron, la misma operación con `rejected` cierra una
 * inasistencia cuyo plazo venció sin entrega; el dominio decide el plazo.
 */
export const reviewAppointmentJustification = mutation({
  args: {
    appointmentId: v.string(),
    review: justificationDecisionUnion,
    version: v.literal(APPOINTMENT_CONTRACT_VERSION),
  },
  returns: appointmentResultValidator,
  handler: async (ctx, { version: _version, appointmentId, review }) => {
    const identity = await ctx.auth.getUserIdentity();
    return unwrapApiResult(
      await reviewAppointmentJustificationUseCase(
        {
          auth: authorizationReader(ctx),
          appointments: appointmentChangeReader(ctx),
          persister: appointmentTransitionRepository(ctx).persister,
        },
        {
          tokenIdentifier: identity?.tokenIdentifier ?? null,
          appointmentId,
          review,
        },
      ),
    );
  },
});

const version = v.literal(APPOINTMENT_CONTRACT_VERSION);

/** Proyección de la atención: las claves de cada vista son el contrato con los clientes. */
const appointmentProjectionValidator = v.union(
  v.object({
    id: v.string(),
    accompanimentId: v.string(),
    professionalId: v.string(),
    modality: modalityUnion,
    spaceId: v.optional(v.string()),
    startAt: v.number(),
    endAt: v.number(),
    originalStartAt: v.optional(v.number()),
    cancelReason: v.optional(v.string()),
    justificationExplanation: v.optional(v.string()),
    justificationSubmittedAt: v.optional(v.number()),
    justificationReview: v.optional(justificationReviewUnion),
    supportingDocumentReceived: v.optional(v.boolean()),
    status: appointmentStatusUnion,
    version,
    view: v.literal("full"),
  }),
  v.object({
    id: v.string(),
    accompanimentId: v.string(),
    professionalId: v.string(),
    modality: modalityUnion,
    spaceId: v.optional(v.string()),
    startAt: v.number(),
    endAt: v.number(),
    originalStartAt: v.optional(v.number()),
    justificationExplanation: v.optional(v.string()),
    justificationSubmittedAt: v.optional(v.number()),
    justificationReview: v.optional(justificationReviewUnion),
    supportingDocumentReceived: v.optional(v.boolean()),
    status: appointmentStatusUnion,
    version,
    view: v.literal("shared"),
  }),
  v.object({
    id: v.string(),
    status: appointmentStatusUnion,
    startAt: v.number(),
    endAt: v.number(),
    modality: modalityUnion,
    view: v.literal("minimized"),
  }),
);

/**
 * Atenciones por rango civil y por páginas. Sin `accompanimentId` es la
 * agenda propia del Estudiante o del Profesional; con él, las atenciones de ese
 * acompañamiento con la vista de quien consulta. Las fechas se leen en la zona
 * de la agenda (`AGENDA_TIME_ZONE`), que fija el servidor.
 */
export const listAppointments = query({
  args: {
    accompanimentId: v.optional(v.string()),
    from: v.string(),
    to: v.string(),
    limit: v.number(),
    cursor: v.optional(v.string()),
    version,
  },
  returns: v.object({
    items: v.array(appointmentProjectionValidator),
    hasMore: v.boolean(),
    nextCursor: v.union(v.string(), v.null()),
    version,
  }),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    const page = unwrapApiResult(
      await listAppointmentsUseCase(
        { auth: authorizationReader(ctx), appointments: appointmentAgendaReader(ctx) },
        { ...args, timeZone: AGENDA_TIME_ZONE, tokenIdentifier: identity?.tokenIdentifier ?? null },
      ),
    );
    // La página del dominio es de solo lectura; el validador espera un arreglo.
    return { ...page, items: [...page.items] };
  },
});

/** Detalle de una atención con la vista de `appointment:read`. */
export const getAppointment = query({
  args: { appointmentId: v.string(), version },
  returns: appointmentProjectionValidator,
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    return unwrapApiResult(
      await getAppointmentUseCase(
        { auth: authorizationReader(ctx), appointments: appointmentAgendaReader(ctx) },
        { ...args, tokenIdentifier: identity?.tokenIdentifier ?? null },
      ),
    );
  },
});

// ── TI2-122: calendario por atención y alternativa `.ics` ──────────────────
//
// El Estudiante dueño de la atención es el único que puede descargar el
// archivo o agregar el evento. La autorización se resuelve en Aplicación con
// la fila leída en el servidor; el consentimiento de Google Calendar es un
// alcance OAuth aparte del inicio institucional. Ninguna respuesta incluye
// tokens, correo de Google ni detalles del proveedor.

/** Contenido del archivo `.ics`; es el mismo en la descarga y en el respaldo. */
const calendarFileContentValidator = v.object({
  fileName: v.string(),
  content: v.string(),
});

/** Archivo `.ics` de una atención y si ya tiene evento registrado. */
const appointmentCalendarFileValidator = v.object({
  fileName: v.string(),
  content: v.string(),
  alreadyAdded: v.boolean(),
});

/** Resultado de agregar o actualizar la atención: éxito, ya vigente o respaldo `.ics`. */
const appointmentCalendarResultValidator = v.union(
  v.object({
    status: v.literal("created"),
    eventId: v.string(),
    ics: calendarFileContentValidator,
  }),
  v.object({
    status: v.literal("updated"),
    eventId: v.string(),
    ics: calendarFileContentValidator,
  }),
  v.object({
    status: v.literal("already_created"),
    eventId: v.string(),
    ics: calendarFileContentValidator,
  }),
  v.object({
    status: v.literal("fallback"),
    reason: v.union(v.literal("not_connected"), v.literal("unavailable")),
    ics: calendarFileContentValidator,
  }),
);

/** Resumen mínimo de una atención propia para las acciones de calendario. */
const appointmentCalendarSummaryValidator = v.object({
  appointmentId: v.string(),
  status: appointmentStatusUnion,
  startAt: v.number(),
  endAt: v.number(),
  modality: modalityUnion,
  calendarAdded: v.boolean(),
  calendarNeedsUpdate: v.boolean(),
});

/**
 * Lista acotada de atenciones del acompañamiento. Usa la misma autorización de
 * `appointment:read`; no expone profesional, sala, notas ni necesidades.
 */
export const listAccompanimentAppointments = query({
  args: { accompanimentId: v.string() },
  returns: v.array(appointmentCalendarSummaryValidator),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    return unwrapApiResult(
      await listAccompanimentAppointmentsUseCase(
        {
          auth: authorizationReader(ctx),
          appointments: appointmentListReader(ctx),
        },
        {
          tokenIdentifier: identity?.tokenIdentifier ?? null,
          accompanimentId: args.accompanimentId,
        },
      ),
    );
  },
});

/**
 * Descarga el `.ics` de una atención propia. Es la alternativa que no depende
 * de Google Calendar ni de un consentimiento adicional: funciona aunque la
 * cuenta no esté vinculada o el proveedor esté caído.
 */
export const getAppointmentCalendarFile = query({
  args: { appointmentId: v.string() },
  returns: appointmentCalendarFileValidator,
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    return unwrapApiResult(
      await getAppointmentCalendarFileUseCase(
        {
          loadAppointment: (input) =>
            loadCalendarAppointment(
              {
                auth: authorizationReader(ctx),
                appointments: appointmentCalendarReader(ctx),
              },
              input,
            ),
        },
        {
          tokenIdentifier: identity?.tokenIdentifier ?? null,
          appointmentId: args.appointmentId,
          timeZone: AGENDA_TIME_ZONE,
        },
      ),
    );
  },
});

/**
 * Indica si la sesión ya concedió el alcance mínimo de Calendar. Solo devuelve
 * un booleano: ni tokens ni la cuenta de Google.
 */
export const getCalendarConnection = query({
  args: {},
  returns: v.object({ connected: v.boolean() }),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    return unwrapApiResult(
      await getCalendarConnectionUseCase(
        {
          auth: authorizationReader(ctx),
          connection: googleCalendarConnectionReader(ctx),
        },
        { tokenIdentifier: identity?.tokenIdentifier ?? null },
      ),
    );
  },
});

/**
 * Agrega la atención al Google Calendar personal con una acción explícita.
 *
 * La acción no tiene acceso a la base: primero lee y autoriza la atención con
 * la query interna y luego llama al proveedor. Un fallo externo no revierte la
 * reserva: responde `fallback` con el `.ics` genérico. El identificador
 * determinista del evento evita duplicados en reintentos y dobles clics.
 */
export const addAppointmentToGoogleCalendar = action({
  args: { appointmentId: v.string() },
  returns: appointmentCalendarResultValidator,
  handler: async (ctx, args): Promise<AppointmentCalendarResult> => {
    const identity = await ctx.auth.getUserIdentity();
    const tokenIdentifier = identity?.tokenIdentifier ?? null;
    const appointment: CalendarAppointmentContext | null = await ctx.runQuery(
      internal.operations.calendar.loadAppointmentCalendarContext,
      { tokenIdentifier, appointmentId: args.appointmentId },
    );
    return unwrapApiResult(
      await addAppointmentToGoogleCalendarUseCase(
        {
          loadAppointment: async () => appointment,
          recordEvent: async (input) => {
            await ctx.runMutation(internal.operations.calendar.recordCalendarEventReference, input);
          },
          google: googleCalendarGateway(ctx),
          now: () => Date.now(),
        },
        {
          tokenIdentifier,
          appointmentId: args.appointmentId,
          timeZone: AGENDA_TIME_ZONE,
        },
      ),
    );
  },
});

/**
 * Agrega o reemplaza el enlace de Google Meet de una atención en línea
 * (TI2-142). Solo un profesional de la atención; el enlace debe usar `https`,
 * el dominio `meet.google.com` y un código de reunión, y no puede estar en otra
 * atención. Agregarlo o reemplazarlo avisa al Estudiante; repetir el mismo
 * enlace no escribe. `unauthorized` sin permiso o ante una atención ajena o
 * inexistente; `conflict` ante un enlace inválido o reutilizado, una atención
 * presencial o una que ya no está vigente.
 */
export const setOnlineAccessLink = mutation({
  args: {
    appointmentId: v.string(),
    link: v.string(),
    version: v.literal(APPOINTMENT_CONTRACT_VERSION),
  },
  returns: appointmentResultValidator,
  handler: async (ctx, { version: _version, appointmentId, link }) => {
    const identity = await ctx.auth.getUserIdentity();
    return unwrapApiResult(
      await setOnlineAccessLinkUseCase(
        {
          auth: authorizationReader(ctx),
          appointments: onlineAccessStore(ctx),
          notifications: notificationEventRecorder(ctx),
        },
        { tokenIdentifier: identity?.tokenIdentifier ?? null, appointmentId, link },
      ),
    );
  },
});

/** Estado del acceso en línea; `link` solo viaja cuando está disponible. */
const onlineAccessViewValidator = v.union(
  v.object({ status: v.literal("pending"), version: v.literal(APPOINTMENT_CONTRACT_VERSION) }),
  v.object({
    status: v.literal("available"),
    link: v.string(),
    version: v.literal(APPOINTMENT_CONTRACT_VERSION),
  }),
  v.object({
    status: v.literal("not_applicable"),
    version: v.literal(APPOINTMENT_CONTRACT_VERSION),
  }),
);

/**
 * Acceso en línea de una atención para sus participantes (TI2-142): el
 * Estudiante dueño y cada profesional, responsable o adicional. Los listados
 * de agenda nunca traen el enlace; quien no participa recibe `unauthorized`
 * sin saber si la atención existe ni si tiene enlace.
 */
export const getOnlineAccess = query({
  args: {
    appointmentId: v.string(),
    version: v.literal(APPOINTMENT_CONTRACT_VERSION),
  },
  returns: onlineAccessViewValidator,
  handler: async (ctx, { version: _version, appointmentId }) => {
    const identity = await ctx.auth.getUserIdentity();
    const view = unwrapApiResult(
      await getOnlineAccessUseCase(
        { auth: authorizationReader(ctx), appointments: onlineAccessReader(ctx) },
        { tokenIdentifier: identity?.tokenIdentifier ?? null, appointmentId },
      ),
    );
    return { ...view, version: APPOINTMENT_CONTRACT_VERSION };
  },
});
