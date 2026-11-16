import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { v, type Infer } from "convex/values";
import {
  acceptRequest as acceptRequestUseCase,
  cancelRequest as cancelRequestUseCase,
  closeRequestWithoutAccompaniment as closeRequestWithoutAccompanimentUseCase,
  registerRequest,
  requestAdditionalInformation as requestAdditionalInformationUseCase,
  takeRequest as takeRequestUseCase,
} from "../application/requests/commands";
import {
  recordReferralAcceptance as recordReferralAcceptanceUseCase,
  recordReferralContact as recordReferralContactUseCase,
  referRequest as referRequestUseCase,
  registerOfficialRequest as registerOfficialRequestUseCase,
} from "../application/requests/referrals";
import { respondToInformationRequest as respondToInformationRequestUseCase } from "../application/requests/respond";
import {
  listAuthorizedRequestsUseCase,
  listOpenRequestsUseCase,
  listOwnRequestsUseCase,
  getRequestDetailUseCase,
} from "../application/requests/queries";
import { mutation, query } from "../_generated/server";
import {
  accessNeedSelectionValidator,
  generalAvailabilityValidator,
  modalityUnion,
  requestProvenanceChannelUnion,
  requestStatusUnion,
} from "../infrastructure/validators";
import { accompanimentOpener } from "../infrastructure/accompaniments/repository";
import {
  activeProfessionalReader,
  activeRequestViewerReader,
  activeStudentByEmailReader,
  activeStudentReader,
  requestReader,
  requestStore,
} from "../infrastructure/requests/repository";
import { acceptedAccompanimentValidator } from "./accompaniments";
import { unwrapApiResult } from "./session";

/**
 * Borde de Presentación: solicitudes del Estudiante (TI2-9) y API pública de
 * mutations del Sprint 1 (TI2-26).
 *
 * Adaptador delgado: valida la entrada, resuelve la identidad en el servidor
 * con `ctx.auth.getUserIdentity()` y delega en Aplicación. Nunca acepta un
 * `userId` del cliente como prueba ni toca `ctx.db` directamente.
 *
 * Toda operación compone los adaptadores de Infraestructura con su `ctx` y
 * traduce el `ApiResult` de Aplicación con `unwrapApiResult` (TI2-181): la
 * denegación llega como `{ code: "unauthorized" }`, sin exponer el motivo, y
 * los rechazos con su código del contrato común. Opera con datos ficticios.
 *
 * TI2-26: `createRequest`, `takeRequest`, `requestAdditionalInformation` y
 * `acceptRequest` son la escritura pública del Sprint 1; la habilitación de
 * cuentas y la concesión de accesos siguen en las vías internas guardadas
 * (`internal.operations.accounts`, `internal.operations.assignments`) y el
 * Sprint 1 no usa `action` (sin integraciones que lo requieran: OAuth corre
 * por las rutas HTTP de Better Auth).
 *
 * TI2-141: suma la cancelación y el cierre sin acompañamiento, y el estado
 * de toda respuesta puede ser cualquiera de los siete del contrato
 * (`requestStatusUnion`).
 *
 * TI2-143: suma el registro por canal oficial, el contacto y la aceptación
 * de una derivación de entrada y la derivación de salida. Ninguna envía
 * avisos ni se comunica con otra unidad: eso ocurre fuera de la aplicación.
 */

const requestBaseFields = {
  _id: v.id("requests"),
  studentId: v.id("users"),
  status: requestStatusUnion,
  createdAt: v.number(),
};

const requestValidator = v.object({
  ...requestBaseFields,
  accessNeeds: v.string(),
});

const minimizedRequestValidator = v.object(requestBaseFields);

// Detalle (TI2-141): suma los textos del intercambio y la razón de cierre.
// Solo lo entrega `getRequest`, a quien ya puede leer la solicitud. TI2-143
// suma el canal de procedencia y las derivaciones, sin identificadores de
// personal. El canal siempre viaja, pero se declara opcional: Mobile reutiliza
// el tipo del detalle para los elementos de un listado, y un campo obligatorio
// nuevo deja de compilar ahí.
const requestDetailValidator = v.object({
  ...requestBaseFields,
  accessNeeds: v.string(),
  informationRequest: v.optional(v.string()),
  informationResponse: v.optional(v.string()),
  closureReason: v.optional(v.string()),
  provenanceChannel: v.optional(requestProvenanceChannelUnion),
  incomingReferral: v.optional(
    v.object({
      originUnit: v.string(),
      referredAt: v.number(),
      contactedAt: v.optional(v.number()),
      acceptedAt: v.optional(v.number()),
    }),
  ),
  outgoingReferral: v.optional(
    v.object({
      destinationUnit: v.string(),
      referredAt: v.number(),
      reason: v.string(),
    }),
  ),
});

const requestPageValidator = paginationResultValidator(requestValidator);
const minimizedRequestPageValidator = paginationResultValidator(minimizedRequestValidator);

// Los handlers declaran el tipo del validador y no el que infiere TypeScript
// desde la fila: así Web y Mobile derivan los siete estados del contrato
// aunque el tipo de la fila cambie.
type PublicRequest = Infer<typeof requestValidator>;
type PublicRequestDetail = Infer<typeof requestDetailValidator>;
type PublicRequestPage = Infer<typeof requestPageValidator>;
type PublicMinimizedRequestPage = Infer<typeof minimizedRequestPageValidator>;

/**
 * Argumentos del envío (TI2-141). Convex exige un objeto, así que las dos
 * formas comparten campos opcionales y Aplicación decide cuál llegó por la
 * forma de `accessNeeds`: lista en la completa (`AccompanimentRequestContent`)
 * o texto en la anterior. Sin RUT, diagnóstico, certificados ni área interna:
 * el validador rechaza cualquier campo extra.
 */
const createRequestArgs = {
  accessNeeds: v.optional(v.union(v.string(), v.array(accessNeedSelectionValidator))),
  needSummary: v.optional(v.string()),
  expectedOutcome: v.optional(v.string()),
  otherAccessNeed: v.optional(v.string()),
  modalityPreference: v.optional(modalityUnion),
  generalAvailability: v.optional(generalAvailabilityValidator),
  preferredAccessibleInformationChannel: v.optional(v.string()),
  idempotencyKey: v.optional(v.string()),
};

/**
 * Registra la solicitud del Estudiante en estado `received`. Solo una
 * cuenta de Estudiante habilitada y vigente puede registrar; otro rol o una
 * cuenta sin vigencia recibe denegación. Con la forma completa, repetir el
 * envío con la misma `idempotencyKey` devuelve la misma solicitud sin crear
 * otra.
 */
export const createRequest = mutation({
  args: createRequestArgs,
  returns: requestValidator,
  handler: async (ctx, args): Promise<PublicRequest> => {
    const identity = await ctx.auth.getUserIdentity();
    return unwrapApiResult(
      await registerRequest(
        { students: activeStudentReader(ctx), requests: requestStore(ctx), now: Date.now },
        { tokenIdentifier: identity?.tokenIdentifier ?? null, submission: args },
      ),
    );
  },
});

/**
 * Lista las solicitudes propias del Estudiante, paginado.
 * Cualquier otro rol recibe denegación.
 */
export const listOwnRequests = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: requestPageValidator,
  handler: async (ctx, args): Promise<PublicRequestPage> => {
    const identity = await ctx.auth.getUserIdentity();
    return unwrapApiResult(
      await listOwnRequestsUseCase(
        { students: activeStudentReader(ctx), requests: requestReader(ctx) },
        { tokenIdentifier: identity?.tokenIdentifier ?? null, ...args },
      ),
    );
  },
});

/**
 * Detalle de una solicitud propia o tomada (TI2-10).
 *
 * El Estudiante solo detalla sus solicitudes y el Profesional solo las que
 * tomó; el resto recibe la denegación genérica sin revelar existencia. La
 * bandeja minimizada sigue siendo la única vía de descubrimiento.
 */
export const getRequest = query({
  args: { requestId: v.id("requests") },
  returns: requestDetailValidator,
  handler: async (ctx, args): Promise<PublicRequestDetail> => {
    const identity = await ctx.auth.getUserIdentity();
    return unwrapApiResult(
      await getRequestDetailUseCase(
        { viewers: activeRequestViewerReader(ctx), requests: requestReader(ctx) },
        { tokenIdentifier: identity?.tokenIdentifier ?? null, ...args },
      ),
    );
  },
});

/**
 * Lista las solicitudes tomadas por el Profesional, paginado. Sin toma
 * activa no hay acceso. Cualquier otro rol recibe denegación.
 */
export const listAuthorizedRequests = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: requestPageValidator,
  handler: async (ctx, args): Promise<PublicRequestPage> => {
    const identity = await ctx.auth.getUserIdentity();
    return unwrapApiResult(
      await listAuthorizedRequestsUseCase(
        { professionals: activeProfessionalReader(ctx), requests: requestReader(ctx) },
        { tokenIdentifier: identity?.tokenIdentifier ?? null, ...args },
      ),
    );
  },
});

/**
 * Bandeja de triage para el Profesional, paginado y con vista minimizada
 * (sin `accessNeeds`). Solo descubrir, no autoriza a operar. Cualquier otro
 * rol recibe denegación.
 */
export const listOpenRequests = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: minimizedRequestPageValidator,
  handler: async (ctx, args): Promise<PublicMinimizedRequestPage> => {
    const identity = await ctx.auth.getUserIdentity();
    return unwrapApiResult(
      await listOpenRequestsUseCase(
        { professionals: activeProfessionalReader(ctx), requests: requestReader(ctx) },
        { tokenIdentifier: identity?.tokenIdentifier ?? null, ...args },
      ),
    );
  },
});

/**
 * Toma una solicitud para revisión. Solo el propio Profesional con cuenta
 * vigente; una solicitud que ya no está recibida, o ya tomada, responde
 * `conflict` (TI2-181).
 */
export const takeRequest = mutation({
  args: { requestId: v.id("requests") },
  returns: requestValidator,
  handler: async (ctx, args): Promise<PublicRequest> => {
    const identity = await ctx.auth.getUserIdentity();
    return unwrapApiResult(
      await takeRequestUseCase(
        {
          professionals: activeProfessionalReader(ctx),
          requests: requestStore(ctx),
          now: Date.now,
        },
        { tokenIdentifier: identity?.tokenIdentifier ?? null, ...args },
      ),
    );
  },
});

/**
 * Pide información adicional al Estudiante sobre una solicitud en revisión.
 * Solo un Profesional con toma activa y cuenta vigente; el motivo es
 * obligatorio.
 */
export const requestAdditionalInformation = mutation({
  args: { requestId: v.id("requests"), reason: v.string() },
  returns: requestValidator,
  handler: async (ctx, args): Promise<PublicRequest> => {
    const identity = await ctx.auth.getUserIdentity();
    return unwrapApiResult(
      await requestAdditionalInformationUseCase(
        {
          professionals: activeProfessionalReader(ctx),
          requests: requestStore(ctx),
          now: Date.now,
        },
        { tokenIdentifier: identity?.tokenIdentifier ?? null, ...args },
      ),
    );
  },
});

/**
 * Acepta la solicitud y abre exactamente un acompañamiento (TI2-24).
 * Solo el Profesional con toma activa y cuenta vigente; el objetivo es
 * obligatorio. Repetir la aceptación se rechaza sin duplicar.
 */
export const acceptRequest = mutation({
  args: { requestId: v.id("requests"), objective: v.string() },
  returns: acceptedAccompanimentValidator,
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    return unwrapApiResult(
      await acceptRequestUseCase(
        {
          professionals: activeProfessionalReader(ctx),
          requests: requestStore(ctx),
          accompaniments: accompanimentOpener(ctx),
          now: Date.now,
        },
        { tokenIdentifier: identity?.tokenIdentifier ?? null, ...args },
      ),
    );
  },
});

/**
 * Cancela la solicitud propia (TI2-141). Solo el Estudiante dueño con cuenta
 * vigente y mientras siga abierta; el motivo es obligatorio. Una solicitud
 * ajena o inexistente recibe la misma denegación.
 */
export const cancelRequest = mutation({
  args: { requestId: v.id("requests"), reason: v.string() },
  returns: requestValidator,
  handler: async (ctx, args): Promise<PublicRequest> => {
    const identity = await ctx.auth.getUserIdentity();
    return unwrapApiResult(
      await cancelRequestUseCase(
        { students: activeStudentReader(ctx), requests: requestStore(ctx), now: Date.now },
        { tokenIdentifier: identity?.tokenIdentifier ?? null, ...args },
      ),
    );
  },
});

/**
 * Cierra la solicitud sin abrir acompañamiento (TI2-141). Solo el Profesional
 * con toma activa y cuenta vigente; la razón es obligatoria y es la que lee
 * el Estudiante.
 */
export const closeRequestWithoutAccompaniment = mutation({
  args: { requestId: v.id("requests"), reason: v.string() },
  returns: requestValidator,
  handler: async (ctx, args): Promise<PublicRequest> => {
    const identity = await ctx.auth.getUserIdentity();
    return unwrapApiResult(
      await closeRequestWithoutAccompanimentUseCase(
        {
          professionals: activeProfessionalReader(ctx),
          requests: requestStore(ctx),
          now: Date.now,
        },
        { tokenIdentifier: identity?.tokenIdentifier ?? null, ...args },
      ),
    );
  },
});

/**
 * Responde a la información pedida (TI2-141). Solo el Estudiante dueño con
 * cuenta vigente y mientras la solicitud espera respuesta; la solicitud
 * vuelve a revisión. Compone los adaptadores de los puertos con el mismo
 * `ctx`: la operación sigue siendo una sola mutation.
 */
export const respondToInformationRequest = mutation({
  args: { requestId: v.id("requests"), response: v.string() },
  returns: requestValidator,
  handler: async (ctx, args): Promise<PublicRequest> => {
    const identity = await ctx.auth.getUserIdentity();
    return unwrapApiResult(
      await respondToInformationRequestUseCase(
        { students: activeStudentReader(ctx), requests: requestStore(ctx), now: Date.now },
        { tokenIdentifier: identity?.tokenIdentifier ?? null, ...args },
      ),
    );
  },
});

/**
 * Registra una solicitud recibida por canal oficial (TI2-143), a nombre del
 * Estudiante indicado por su correo institucional. Solo un Profesional con
 * cuenta vigente. El contenido sigue la forma completa de `createRequest`,
 * con su clave de idempotencia. `receivedAt` es cuándo la recibió CERETI y,
 * si falta, es el momento del registro. Con `originUnit` queda además como
 * derivación de entrada.
 */
export const registerOfficialRequest = mutation({
  args: {
    ...createRequestArgs,
    studentEmail: v.string(),
    receivedAt: v.optional(v.number()),
    originUnit: v.optional(v.string()),
  },
  returns: requestValidator,
  handler: async (ctx, args): Promise<PublicRequest> => {
    const identity = await ctx.auth.getUserIdentity();
    const { studentEmail, receivedAt, originUnit, ...submission } = args;
    return unwrapApiResult(
      await registerOfficialRequestUseCase(
        {
          professionals: activeProfessionalReader(ctx),
          students: activeStudentByEmailReader(ctx),
          requests: requestStore(ctx),
          now: Date.now,
        },
        {
          tokenIdentifier: identity?.tokenIdentifier ?? null,
          studentEmail,
          submission,
          ...(receivedAt === undefined ? {} : { receivedAt }),
          ...(originUnit === undefined ? {} : { originUnit }),
        },
      ),
    );
  },
});

/**
 * Registra el contacto de CERETI con el estudiante por una derivación de
 * entrada (TI2-143). Solo el Profesional con toma activa y cuenta vigente;
 * se registra una sola vez.
 */
export const recordReferralContact = mutation({
  args: { requestId: v.id("requests") },
  returns: requestValidator,
  handler: async (ctx, args): Promise<PublicRequest> => {
    const identity = await ctx.auth.getUserIdentity();
    return unwrapApiResult(
      await recordReferralContactUseCase(
        {
          professionals: activeProfessionalReader(ctx),
          requests: requestStore(ctx),
          now: Date.now,
        },
        { tokenIdentifier: identity?.tokenIdentifier ?? null, ...args },
      ),
    );
  },
});

/**
 * Registra la aceptación del estudiante de una derivación de entrada
 * (TI2-143), después del contacto. Solo el Profesional con toma activa y
 * cuenta vigente. Sin ella, `acceptRequest` no abre el acompañamiento.
 */
export const recordReferralAcceptance = mutation({
  args: { requestId: v.id("requests") },
  returns: requestValidator,
  handler: async (ctx, args): Promise<PublicRequest> => {
    const identity = await ctx.auth.getUserIdentity();
    return unwrapApiResult(
      await recordReferralAcceptanceUseCase(
        {
          professionals: activeProfessionalReader(ctx),
          requests: requestStore(ctx),
          now: Date.now,
        },
        { tokenIdentifier: identity?.tokenIdentifier ?? null, ...args },
      ),
    );
  },
});

/**
 * Deriva la solicitud a otra unidad (TI2-143). Solo el Profesional con toma
 * activa y cuenta vigente. Pide el nombre de la unidad de destino y la razón
 * que lee el estudiante, sin destinatarios ni antecedentes. La solicitud
 * queda `referred` y no abre acompañamiento.
 */
export const referRequest = mutation({
  args: { requestId: v.id("requests"), destinationUnit: v.string(), reason: v.string() },
  returns: requestValidator,
  handler: async (ctx, args): Promise<PublicRequest> => {
    const identity = await ctx.auth.getUserIdentity();
    return unwrapApiResult(
      await referRequestUseCase(
        {
          professionals: activeProfessionalReader(ctx),
          requests: requestStore(ctx),
          now: Date.now,
        },
        { tokenIdentifier: identity?.tokenIdentifier ?? null, ...args },
      ),
    );
  },
});
