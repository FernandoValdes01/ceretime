import { v } from "convex/values";
import { saveFollowUpRecord as saveFollowUpRecordUseCase } from "../application/follow_up/commands";
import {
  getFollowUpRecord as getFollowUpRecordUseCase,
  listAccompanimentFollowUpRecords as listAccompanimentFollowUpRecordsUseCase,
} from "../application/follow_up/queries";
import { mutation, query } from "../_generated/server";
import type { FollowUpProjection } from "../domain/follow_up/follow_up";
import { authorizationReader } from "../infrastructure/accompaniments/repository";
import { appointmentAgendaReader } from "../infrastructure/appointments/repository";
import { followUpRecorder, followUpRecordReader } from "../infrastructure/follow_up/repository";
import {
  appointmentStatusUnion,
  followUpContractVersionLiteral,
  followUpResponsibleUnion,
  followUpTaskStatusUnion,
} from "../infrastructure/validators";
import { unwrapApiResult } from "./session";

/**
 * Borde de Presentación: registro de seguimiento de una atención (TI2-146).
 *
 * Adaptadores delgados bajo `api.presentation.follow_up`: validan la forma del
 * contrato v1, resuelven la identidad en el servidor con
 * `ctx.auth.getUserIdentity()` y delegan en los casos de uso de
 * `application/follow_up`. No tocan `ctx.db` ni deciden permisos: el
 * acompañamiento sale de la atención leída en el servidor y el autor, del
 * perfil de la sesión.
 *
 * Solo hay guardar y leer. El primer guardado confirma el registro y no
 * existen mutations de edición ni de eliminación. Los errores usan la
 * traducción compartida de TI2-88: `unauthorized` sin permiso o con una
 * atención o acompañamiento ajeno o inexistente, y `conflict` ante datos
 * inválidos o un registro ya confirmado con otro contenido.
 *
 * Los validadores de salida fijan las claves de cada vista: si una proyección
 * trajera la nota interna fuera de la vista `professional`, la respuesta
 * fallaría en vez de entregarla. Opera con datos ficticios.
 */

const version = followUpContractVersionLiteral;

const agreementValidator = v.object({ id: v.string(), description: v.string() });

const taskValidator = v.object({
  id: v.string(),
  description: v.string(),
  responsible: followUpResponsibleUnion,
  status: followUpTaskStatusUnion,
});

/** Claves compartidas por las vistas `professional` y `shared`. */
const sharedFollowUpFields = {
  appointmentId: v.string(),
  accompanimentId: v.string(),
  appointmentStatus: appointmentStatusUnion,
  agreements: v.array(agreementValidator),
  tasks: v.array(taskValidator),
  nextSteps: v.string(),
  suggestedNextAppointmentDate: v.optional(v.string()),
  version,
};

/** Proyección del registro: las claves de cada vista son el contrato con los clientes. */
const followUpProjectionValidator = v.union(
  v.object({
    ...sharedFollowUpFields,
    internalNote: v.optional(v.string()),
    view: v.literal("professional"),
  }),
  v.object({ ...sharedFollowUpFields, view: v.literal("shared") }),
  v.object({
    appointmentId: v.string(),
    appointmentStatus: appointmentStatusUnion,
    suggestedNextAppointmentDate: v.optional(v.string()),
    version,
    view: v.literal("minimized"),
  }),
);

/** La proyección del dominio es de solo lectura; los validadores esperan arreglos. */
function toPublicFollowUp(projection: FollowUpProjection) {
  if (projection.view === "minimized") return projection;
  return { ...projection, agreements: [...projection.agreements], tasks: [...projection.tasks] };
}

/**
 * Guarda y confirma el seguimiento de una atención realizada o con la
 * inasistencia registrada. Un reintento idéntico responde lo mismo sin
 * duplicar acuerdos ni tareas; otro contenido responde `conflict`.
 */
export const saveFollowUpRecord = mutation({
  args: {
    appointmentId: v.string(),
    agreements: v.array(agreementValidator),
    tasks: v.array(taskValidator),
    nextSteps: v.string(),
    suggestedNextAppointmentDate: v.optional(v.string()),
    internalNote: v.optional(v.string()),
    version,
  },
  returns: v.object({ appointmentId: v.string() }),
  handler: async (ctx, { version: _version, ...content }) => {
    const identity = await ctx.auth.getUserIdentity();
    return unwrapApiResult(
      await saveFollowUpRecordUseCase(
        {
          auth: authorizationReader(ctx),
          appointments: appointmentAgendaReader(ctx),
          recorder: followUpRecorder(ctx),
        },
        { ...content, tokenIdentifier: identity?.tokenIdentifier ?? null },
      ),
    );
  },
});

/** Seguimiento de una atención con la vista del rol, o `null` si aún no tiene. */
export const getFollowUpRecord = query({
  args: { appointmentId: v.string(), version },
  returns: v.union(followUpProjectionValidator, v.null()),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    const projection = unwrapApiResult(
      await getFollowUpRecordUseCase(
        {
          auth: authorizationReader(ctx),
          appointments: appointmentAgendaReader(ctx),
          followUp: followUpRecordReader(ctx),
        },
        { appointmentId: args.appointmentId, tokenIdentifier: identity?.tokenIdentifier ?? null },
      ),
    );
    return projection === null ? null : toPublicFollowUp(projection);
  },
});

/**
 * Historial de seguimiento de un acompañamiento, de la atención más reciente a
 * la más antigua. Pagina atenciones: una página puede traer menos registros
 * que `limit` y aun así tener más con `nextCursor`.
 */
export const listAccompanimentFollowUpRecords = query({
  args: {
    accompanimentId: v.string(),
    limit: v.number(),
    cursor: v.optional(v.string()),
    version,
  },
  returns: v.object({
    items: v.array(followUpProjectionValidator),
    hasMore: v.boolean(),
    nextCursor: v.union(v.string(), v.null()),
    version,
  }),
  handler: async (ctx, { version: _version, ...request }) => {
    const identity = await ctx.auth.getUserIdentity();
    const result = unwrapApiResult(
      await listAccompanimentFollowUpRecordsUseCase(
        {
          auth: authorizationReader(ctx),
          appointments: appointmentAgendaReader(ctx),
          followUp: followUpRecordReader(ctx),
        },
        { ...request, tokenIdentifier: identity?.tokenIdentifier ?? null },
      ),
    );
    return { ...result, items: result.items.map(toPublicFollowUp) };
  },
});
