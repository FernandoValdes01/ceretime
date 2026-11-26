import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { v, type Infer } from "convex/values";
import {
  extendPrivacyRequestDeadline as extendPrivacyRequestDeadlineUseCase,
  recordPrivacyResponseDelivery as recordPrivacyResponseDeliveryUseCase,
  resolvePrivacyRequest as resolvePrivacyRequestUseCase,
  startPrivacyRequestReview as startPrivacyRequestReviewUseCase,
  submitPrivacyRequest as submitPrivacyRequestUseCase,
} from "../application/privacy/commands";
import {
  getPrivacyRequest as getPrivacyRequestUseCase,
  listOwnPrivacyRequests as listOwnPrivacyRequestsUseCase,
  listPrivacyRequests as listPrivacyRequestsUseCase,
} from "../application/privacy/queries";
import { mutation, query } from "../_generated/server";
import {
  privacyProfileReader,
  privacyRequestReader,
  privacyRequestStore,
} from "../infrastructure/privacy/repository";
import {
  privacyRequestChannelUnion,
  privacyRequestContractVersionLiteral,
  privacyRequestKindUnion,
  privacyRequestStatusUnion,
  privacyResponseDeliveryChannelUnion,
  privacyResponseOutcomeUnion,
  privacyResponseRuleUnion,
  roleUnion,
} from "../infrastructure/validators";
import { unwrapApiResult } from "./session";

/**
 * Borde de Presentación: solicitudes de derechos de privacidad (TI2-167).
 *
 * Adaptadores delgados bajo `api.presentation.privacy`: validan la forma del
 * contrato v1, resuelven la identidad en el servidor con
 * `ctx.auth.getUserIdentity()` y delegan en `application/privacy`. No tocan
 * `ctx.db` ni deciden permisos: el titular y el responsable salen del perfil
 * de la sesión.
 *
 * El Estudiante presenta y consulta solo sus solicitudes. El Administrador es
 * el responsable provisional de revisar, resolver, prorrogar y dejar
 * constancia del envío. Toda denegación llega como `unauthorized`, sin
 * distinguir una solicitud ajena de una inexistente. Los campos corregibles
 * responden `privacy_request_fields_invalid`; lo que depende del estado
 * responde `conflict`.
 *
 * La aprobación deja la resolución fundada y el efecto reconocido por el
 * procedimiento; la ejecución material sobre datos reales sigue pendiente de
 * decisión institucional. Una denegación conserva los datos. Nada de esta
 * superficie se presenta como política aprobada por la UCT.
 *
 * Opera con datos ficticios.
 */

const version = privacyRequestContractVersionLiteral;

const extensionValidator = v.object({
  days: v.number(),
  extendedUntilDate: v.string(),
  extendedUntilAt: v.number(),
  extendedAt: v.number(),
  reason: v.string(),
});

const responseValidator = v.object({
  outcome: privacyResponseOutcomeUnion,
  reasons: v.string(),
  respondedAt: v.number(),
  temporaryBlockUntil: v.optional(v.number()),
});

const deliveryReceiptValidator = v.object({
  channel: privacyResponseDeliveryChannelUnion,
  sentAt: v.number(),
  reference: v.string(),
  agencyClaimDueDate: v.string(),
  agencyClaimDueAt: v.number(),
});

const effectValidator = v.union(v.literal("authorized"), v.literal("preserved"));

/** Claves comunes a la vista del titular y a la del responsable. */
const privacyRequestBaseFields = {
  id: v.id("privacyRequests"),
  kind: privacyRequestKindUnion,
  status: privacyRequestStatusUnion,
  channel: privacyRequestChannelUnion,
  receivedAt: v.number(),
  receivedDate: v.string(),
  initialDueDate: v.string(),
  initialDueAt: v.number(),
  dueAt: v.number(),
  responseRule: privacyResponseRuleUnion,
  timeZone: v.string(),
  extension: v.optional(extensionValidator),
  statusReason: v.optional(v.string()),
  withdrawnAt: v.optional(v.number()),
  response: v.optional(responseValidator),
  deliveryReceipt: v.optional(deliveryReceiptValidator),
  effect: v.optional(effectValidator),
  version,
};

/** Vista del titular: su propia solicitud, sin identificadores de personal. */
const ownPrivacyRequestValidator = v.object({
  ...privacyRequestBaseFields,
  view: v.literal("own"),
});

/** Vista del responsable: suma quién presentó la solicitud y quién la atiende. */
const reviewPrivacyRequestValidator = v.object({
  ...privacyRequestBaseFields,
  view: v.literal("review"),
  requesterId: v.id("users"),
  requesterRole: roleUnion,
  responsibleId: v.optional(v.id("users")),
});

const privacyRequestValidator = v.union(ownPrivacyRequestValidator, reviewPrivacyRequestValidator);

const ownPageValidator = paginationResultValidator(ownPrivacyRequestValidator);
const reviewPageValidator = paginationResultValidator(reviewPrivacyRequestValidator);

type PublicOwnPrivacyRequest = Infer<typeof ownPrivacyRequestValidator>;
type PublicReviewPrivacyRequest = Infer<typeof reviewPrivacyRequestValidator>;
type PublicPrivacyRequest = Infer<typeof privacyRequestValidator>;
type PublicOwnPage = Infer<typeof ownPageValidator>;
type PublicReviewPage = Infer<typeof reviewPageValidator>;

/**
 * Presenta una solicitud propia y devuelve su acuse de recibo: instante de
 * recepción, plazo inicial y vencimiento exclusivo. Solo el Estudiante y solo
 * por los derechos habilitados en esta entrega.
 */
export const submitPrivacyRequest = mutation({
  args: { kind: privacyRequestKindUnion, version },
  returns: ownPrivacyRequestValidator,
  handler: async (ctx, args): Promise<PublicOwnPrivacyRequest> => {
    const identity = await ctx.auth.getUserIdentity();
    return unwrapApiResult(
      await submitPrivacyRequestUseCase(
        {
          profiles: privacyProfileReader(ctx),
          requests: privacyRequestStore(ctx),
          now: Date.now,
        },
        { tokenIdentifier: identity?.tokenIdentifier ?? null, kind: args.kind },
      ),
    );
  },
});

/** Solicitudes propias, de la más reciente a la más antigua. */
export const listOwnPrivacyRequests = query({
  args: { paginationOpts: paginationOptsValidator, version },
  returns: ownPageValidator,
  handler: async (ctx, args): Promise<PublicOwnPage> => {
    const identity = await ctx.auth.getUserIdentity();
    return unwrapApiResult(
      await listOwnPrivacyRequestsUseCase(
        { profiles: privacyProfileReader(ctx), requests: privacyRequestReader(ctx) },
        {
          tokenIdentifier: identity?.tokenIdentifier ?? null,
          paginationOpts: args.paginationOpts,
        },
      ),
    );
  },
});

/** Una solicitud propia, o cualquiera para el Administrador responsable. */
export const getPrivacyRequest = query({
  args: { requestId: v.id("privacyRequests"), version },
  returns: privacyRequestValidator,
  handler: async (ctx, args): Promise<PublicPrivacyRequest> => {
    const identity = await ctx.auth.getUserIdentity();
    return unwrapApiResult(
      await getPrivacyRequestUseCase(
        { profiles: privacyProfileReader(ctx), requests: privacyRequestReader(ctx) },
        { tokenIdentifier: identity?.tokenIdentifier ?? null, requestId: args.requestId },
      ),
    );
  },
});

/** Cola de revisión del Administrador, ordenada por vencimiento efectivo. */
export const listPrivacyRequests = query({
  args: {
    paginationOpts: paginationOptsValidator,
    status: v.optional(privacyRequestStatusUnion),
    version,
  },
  returns: reviewPageValidator,
  handler: async (ctx, args): Promise<PublicReviewPage> => {
    const identity = await ctx.auth.getUserIdentity();
    return unwrapApiResult(
      await listPrivacyRequestsUseCase(
        { profiles: privacyProfileReader(ctx), requests: privacyRequestReader(ctx) },
        {
          tokenIdentifier: identity?.tokenIdentifier ?? null,
          paginationOpts: args.paginationOpts,
          ...(args.status === undefined ? {} : { status: args.status }),
        },
      ),
    );
  },
});

/** Toma la solicitud para revisión: `received` pasa a `in_review`. */
export const startPrivacyRequestReview = mutation({
  args: { requestId: v.id("privacyRequests"), version },
  returns: reviewPrivacyRequestValidator,
  handler: async (ctx, args): Promise<PublicReviewPrivacyRequest> => {
    const identity = await ctx.auth.getUserIdentity();
    return unwrapApiResult(
      await startPrivacyRequestReviewUseCase(
        {
          profiles: privacyProfileReader(ctx),
          requests: privacyRequestStore(ctx),
          now: Date.now,
        },
        { tokenIdentifier: identity?.tokenIdentifier ?? null, requestId: args.requestId },
      ),
    );
  },
});

/**
 * Resuelve la solicitud con una respuesta fundada. Una concesión de bloqueo
 * exige `temporaryBlockUntil`; una denegación no lo lleva y conserva los datos.
 */
export const resolvePrivacyRequest = mutation({
  args: {
    requestId: v.id("privacyRequests"),
    outcome: privacyResponseOutcomeUnion,
    reasons: v.string(),
    temporaryBlockUntil: v.optional(v.number()),
    version,
  },
  returns: reviewPrivacyRequestValidator,
  handler: async (ctx, args): Promise<PublicReviewPrivacyRequest> => {
    const identity = await ctx.auth.getUserIdentity();
    return unwrapApiResult(
      await resolvePrivacyRequestUseCase(
        {
          profiles: privacyProfileReader(ctx),
          requests: privacyRequestStore(ctx),
          now: Date.now,
        },
        {
          tokenIdentifier: identity?.tokenIdentifier ?? null,
          requestId: args.requestId,
          outcome: args.outcome,
          reasons: args.reasons,
          ...(args.temporaryBlockUntil === undefined
            ? {}
            : { temporaryBlockUntil: args.temporaryBlockUntil }),
        },
      ),
    );
  },
});

/** Aplica la única prórroga de hasta 30 días corridos, con su motivo. */
export const extendPrivacyRequestDeadline = mutation({
  args: {
    requestId: v.id("privacyRequests"),
    days: v.number(),
    reason: v.string(),
    version,
  },
  returns: reviewPrivacyRequestValidator,
  handler: async (ctx, args): Promise<PublicReviewPrivacyRequest> => {
    const identity = await ctx.auth.getUserIdentity();
    return unwrapApiResult(
      await extendPrivacyRequestDeadlineUseCase(
        {
          profiles: privacyProfileReader(ctx),
          requests: privacyRequestStore(ctx),
          now: Date.now,
        },
        {
          tokenIdentifier: identity?.tokenIdentifier ?? null,
          requestId: args.requestId,
          days: args.days,
          reason: args.reason,
        },
      ),
    );
  },
});

/**
 * Registra la constancia inmutable de envío de la respuesta y devuelve la
 * solicitud con el plazo de 30 días hábiles para reclamar ante la Agencia.
 */
export const recordPrivacyResponseDelivery = mutation({
  args: {
    requestId: v.id("privacyRequests"),
    channel: privacyResponseDeliveryChannelUnion,
    reference: v.string(),
    version,
  },
  returns: reviewPrivacyRequestValidator,
  handler: async (ctx, args): Promise<PublicReviewPrivacyRequest> => {
    const identity = await ctx.auth.getUserIdentity();
    return unwrapApiResult(
      await recordPrivacyResponseDeliveryUseCase(
        {
          profiles: privacyProfileReader(ctx),
          requests: privacyRequestStore(ctx),
          now: Date.now,
        },
        {
          tokenIdentifier: identity?.tokenIdentifier ?? null,
          requestId: args.requestId,
          channel: args.channel,
          reference: args.reference,
        },
      ),
    );
  },
});
