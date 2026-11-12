import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { v, type Infer } from "convex/values";
import {
  acceptRequest as acceptRequestUseCase,
  cancelRequest as cancelRequestUseCase,
  closeRequestWithoutAccompaniment as closeRequestWithoutAccompanimentUseCase,
  registerRequest,
  respondToInformationRequest as respondToInformationRequestUseCase,
  requestAdditionalInformation as requestAdditionalInformationUseCase,
  takeRequest as takeRequestUseCase,
} from "../application/requests/commands";
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
  requestStatusUnion,
} from "../infrastructure/validators";
import { acceptedAccompanimentValidator } from "./accompaniments";

/**
 * Borde de Presentación: solicitudes del Estudiante (TI2-9) y API pública de
 * mutations del Sprint 1 (TI2-26).
 *
 * Adaptador delgado: valida la entrada, resuelve la identidad en el servidor
 * con `ctx.auth.getUserIdentity()` y delega en Aplicación. Nunca acepta un
 * `userId` del cliente como prueba ni toca `ctx.db` directamente.
 *
 * Toda denegación responde con el mismo error genérico, sin exponer el
 * motivo. Opera con datos ficticios.
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
// Solo lo entrega `getRequest`, a quien ya puede leer la solicitud.
const requestDetailValidator = v.object({
  ...requestBaseFields,
  accessNeeds: v.string(),
  informationRequest: v.optional(v.string()),
  informationResponse: v.optional(v.string()),
  closureReason: v.optional(v.string()),
});

const requestPageValidator = paginationResultValidator(requestValidator);
const minimizedRequestPageValidator = paginationResultValidator(minimizedRequestValidator);

// Los handlers declaran el tipo del validador y no el que infiere TypeScript
// desde la fila: así Web y Mobile derivan los siete estados del contrato,
// incluido `referred`, y no solo los que hoy puede traer una fila.
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
    return await registerRequest(ctx, identity, args);
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
    return await listOwnRequestsUseCase(ctx, identity, args);
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
    return await getRequestDetailUseCase(ctx, identity, args);
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
    return await listAuthorizedRequestsUseCase(ctx, identity, args);
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
    return await listOpenRequestsUseCase(ctx, identity, args);
  },
});

/**
 * Toma una solicitud para revisión. Solo el propio Profesional con cuenta
 * vigente; una toma activa existente se rechaza.
 */
export const takeRequest = mutation({
  args: { requestId: v.id("requests") },
  returns: requestValidator,
  handler: async (ctx, args): Promise<PublicRequest> => {
    const identity = await ctx.auth.getUserIdentity();
    return await takeRequestUseCase(ctx, identity, args);
  },
});

/**
 * Pide información adicional al Estudiante sobre una solicitud en revisión.
 * Solo un Profesional con cuenta vigente; el motivo es obligatorio.
 */
export const requestAdditionalInformation = mutation({
  args: { requestId: v.id("requests"), reason: v.string() },
  returns: requestValidator,
  handler: async (ctx, args): Promise<PublicRequest> => {
    const identity = await ctx.auth.getUserIdentity();
    return await requestAdditionalInformationUseCase(ctx, identity, args);
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
    return await acceptRequestUseCase(ctx, identity, args);
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
    return await cancelRequestUseCase(ctx, identity, args);
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
    return await closeRequestWithoutAccompanimentUseCase(ctx, identity, args);
  },
});

/**
 * Responde a la información pedida (TI2-141). Solo el Estudiante dueño con
 * cuenta vigente y mientras la solicitud espera respuesta; la solicitud
 * vuelve a revisión.
 */
export const respondToInformationRequest = mutation({
  args: { requestId: v.id("requests"), response: v.string() },
  returns: requestValidator,
  handler: async (ctx, args): Promise<PublicRequest> => {
    const identity = await ctx.auth.getUserIdentity();
    return await respondToInformationRequestUseCase(ctx, identity, args);
  },
});
