import type { PaginationOptions } from "convex/server";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { isTestProfessional } from "../../domain/accounts/enablement";
import { isActiveInRole } from "../../domain/authorization/permissions";
import type { IncomingReferral } from "../../domain/requests/referral";
import { toStoredAccessNeeds, type RequestSubmission } from "../../domain/requests/request";
import type { RequestStatusChange } from "../../domain/requests/transitions";
import { findProfileByTokenIdentifier } from "../accompaniments/repository";
import { findUserByEmail } from "../accounts/repository";

/**
 * Repositorio de solicitudes (TI2-9).
 *
 * Capa de Infraestructura: único lugar que toca `ctx.db` en el flujo de
 * solicitudes. No decide autorización: persiste/recupera con los índices
 * declarados en `convex/schema.ts`, y `activeStudentReader` filtra el perfil
 * con la regla de Dominio `isActiveInRole`.
 *
 * Opera con datos ficticios.
 */

/** Contexto con lectura de base de datos (consultas y mutaciones). */
type DbReader = QueryCtx | MutationCtx;

/**
 * Campos de la solicitud completa que se pueden fijar al recibirla (TI2-135).
 * Todos son opcionales: sin ellos la fila queda como las anteriores. La razón
 * de cierre y la derivación de salida no están porque se escriben al cerrar o
 * derivar (TI2-143), no al recibir.
 */
export type ReceivedRequestExtras = Pick<
  Doc<"requests">,
  | "needSummary"
  | "expectedOutcome"
  | "accessNeedSelections"
  | "otherAccessNeed"
  | "modalityPreference"
  | "generalAvailability"
  | "preferredAccessibleInformationChannel"
  | "provenance"
  | "incomingReferral"
>;

/**
 * Necesidades de acceso del envío: el texto unido suelto, o la lista
 * estructurada de la que el repositorio deriva ese texto con
 * `toStoredAccessNeeds`. Nunca las dos, para que no puedan contradecirse.
 */
type ReceivedRequestNeeds =
  | {
      readonly accessNeeds: string;
      readonly accessNeedSelections?: undefined;
      readonly otherAccessNeed?: undefined;
    }
  | {
      readonly accessNeedSelections: NonNullable<Doc<"requests">["accessNeedSelections"]>;
      readonly accessNeeds?: undefined;
      readonly otherAccessNeed?: string;
    };

export type ReceivedRequestInput = Omit<
  ReceivedRequestExtras,
  "accessNeedSelections" | "otherAccessNeed"
> &
  ReceivedRequestNeeds & {
    readonly studentId: Id<"users">;
  };

/**
 * Inserta una solicitud recibida del estudiante, con el texto unido de las
 * necesidades de acceso resuelto desde una sola fuente.
 */
export async function insertReceivedRequest(ctx: MutationCtx, input: ReceivedRequestInput) {
  // La fila se arma campo por campo, sin `...input`: un spread puede traer
  // campos que el esquema no declara sin que TypeScript lo revise.
  const {
    studentId,
    needSummary,
    expectedOutcome,
    accessNeedSelections,
    otherAccessNeed,
    modalityPreference,
    generalAvailability,
    preferredAccessibleInformationChannel,
    provenance,
    incomingReferral,
  } = input;
  const resolvedAccessNeeds =
    input.accessNeedSelections === undefined
      ? input.accessNeeds
      : storedAccessNeeds(input.accessNeedSelections, input.otherAccessNeed);
  return await ctx.db.insert("requests", {
    studentId,
    status: "received",
    accessNeeds: resolvedAccessNeeds,
    createdAt: Date.now(),
    ...(needSummary === undefined ? {} : { needSummary }),
    ...(expectedOutcome === undefined ? {} : { expectedOutcome }),
    ...(accessNeedSelections === undefined ? {} : { accessNeedSelections }),
    ...(otherAccessNeed === undefined ? {} : { otherAccessNeed }),
    ...(modalityPreference === undefined ? {} : { modalityPreference }),
    ...(generalAvailability === undefined ? {} : { generalAvailability }),
    ...(preferredAccessibleInformationChannel === undefined
      ? {}
      : { preferredAccessibleInformationChannel }),
    ...(provenance === undefined ? {} : { provenance }),
    ...(incomingReferral === undefined ? {} : { incomingReferral }),
  });
}

/** Texto unido de las condiciones de acceso, o error de dominio si no hay texto. */
function storedAccessNeeds(
  selections: NonNullable<Doc<"requests">["accessNeedSelections"]>,
  otherAccessNeed?: string,
): string {
  const result = toStoredAccessNeeds(selections, otherAccessNeed);
  if (result.status === "error") {
    throw new Error(result.error.message);
  }
  return result.data.accessNeeds;
}

/** Solicitud por id, o `null` si no existe. */
export async function getRequestById(
  ctx: DbReader,
  requestId: Id<"requests">,
): Promise<Doc<"requests"> | null> {
  return await ctx.db.get(requestId);
}

/**
 * Actualiza el estado de una solicitud con el destino que decidió la política.
 * Al derivar (TI2-143), la derivación de salida va en la misma escritura. La
 * razón del cierre sin acompañamiento queda solo en `logRequestTransition`,
 * dentro de la misma mutation, como en el MER (TI2-165).
 */
export async function setRequestStatus(
  ctx: MutationCtx,
  requestId: Id<"requests">,
  change: RequestStatusChange<Id<"users">>,
): Promise<void> {
  if (change.status === "referred") {
    await ctx.db.patch(requestId, {
      status: change.status,
      outgoingReferral: { ...change.outgoingReferral },
    });
  } else {
    await ctx.db.patch(requestId, { status: change.status });
  }
}

/** Guarda la derivación de entrada con el contacto o la aceptación ya aplicados (TI2-143). */
export async function setIncomingReferral(
  ctx: MutationCtx,
  requestId: Id<"requests">,
  referral: IncomingReferral<Id<"users">>,
): Promise<void> {
  await ctx.db.patch(requestId, { incomingReferral: { ...referral } });
}

/** Registra el cambio de estado con motivo, actor y fecha. */
export async function logRequestTransition(
  ctx: MutationCtx,
  input: {
    readonly requestId: Id<"requests">;
    readonly from: Doc<"requests">["status"];
    readonly to: Doc<"requests">["status"];
    readonly actorId: Id<"users">;
    readonly reason?: string;
    readonly occurredAt: number;
  },
): Promise<void> {
  await ctx.db.insert("requestTransitions", {
    requestId: input.requestId,
    from: input.from,
    to: input.to,
    actorId: input.actorId,
    ...(input.reason === undefined ? {} : { reason: input.reason }),
    occurredAt: input.occurredAt,
  });
}

/**
 * Contenido del envío completo en la forma de la fila. La lista del contrato
 * se persiste como `accessNeedSelections` (TI2-135), y de ella sale el texto
 * unido. El esquema tipa los arreglos como mutables; el dominio, de solo
 * lectura.
 */
function toReceivedContent(submission: RequestSubmission) {
  const { accessNeeds, generalAvailability, ...content } = submission;
  return {
    ...content,
    accessNeedSelections: [...accessNeeds],
    generalAvailability: {
      ...generalAvailability,
      preferredWeekdays: [...generalAvailability.preferredWeekdays],
    },
  };
}

/**
 * Lecturas y escrituras de una solicitud para los puertos de Aplicación
 * (TI2-141, TI2-181, TI2-143). Cumple `RequestReader`, `RequestRegistrar`,
 * `OfficialRequestRegistrar`, `RequestStatusWriter`,
 * `RequestTransitionRecorder`, `RequestReferralWriter`, `RequestTakeReader` y
 * `RequestTakeRecorder` por forma, sin importarlos; Presentación lo crea con
 * el `ctx` de la mutation, así todo queda en la misma transacción.
 */
export function requestStore(ctx: MutationCtx) {
  return {
    ...requestReader(ctx),
    setRequestStatus: (requestId: Id<"requests">, change: RequestStatusChange<Id<"users">>) =>
      setRequestStatus(ctx, requestId, change),
    logRequestTransition: (entry: Parameters<typeof logRequestTransition>[1]) =>
      logRequestTransition(ctx, entry),
    recordTake: async (requestId: Id<"requests">, professionalId: Id<"users">) => {
      await insertActiveTake(ctx, { requestId, userId: professionalId, grantedBy: professionalId });
      await markRequestTaken(ctx, requestId, professionalId);
    },
    registerComplete: (studentId: Id<"users">, submission: RequestSubmission, receivedAt: number) =>
      insertReceivedRequest(ctx, {
        ...toReceivedContent(submission),
        studentId,
        provenance: { channel: "student", receivedAt },
      }),
    registerOfficial: (input: {
      readonly studentId: Id<"users">;
      readonly submission: RequestSubmission;
      readonly registeredBy: Id<"users">;
      readonly receivedAt: number;
      readonly originUnit?: string;
    }) =>
      insertReceivedRequest(ctx, {
        ...toReceivedContent(input.submission),
        studentId: input.studentId,
        provenance: {
          channel: "official_channel",
          registeredBy: input.registeredBy,
          receivedAt: input.receivedAt,
        },
        ...(input.originUnit === undefined
          ? {}
          : { incomingReferral: { originUnit: input.originUnit, referredAt: input.receivedAt } }),
      }),
    setIncomingReferral: (requestId: Id<"requests">, referral: IncomingReferral<Id<"users">>) =>
      setIncomingReferral(ctx, requestId, referral),
    registerLegacy: (studentId: Id<"users">, accessNeeds: string) =>
      insertReceivedRequest(ctx, { studentId, accessNeeds }),
  };
}

/**
 * Estudiante de quien llama para el puerto `ActiveStudentReader` (TI2-141):
 * el perfil solo si tiene el rol Estudiante con cuenta habilitada y vigente.
 * Presentación lo crea con el `ctx` de la mutation, como `requestStore`.
 */
export function activeStudentReader(ctx: DbReader) {
  return {
    findActiveStudent: (tokenIdentifier: string | null) =>
      findActiveProfileInRole(ctx, tokenIdentifier, "student"),
  };
}

/**
 * Estudiante por correo para el puerto `ActiveStudentByEmailReader` (TI2-143):
 * el perfil solo si tiene el rol Estudiante con cuenta habilitada y vigente.
 * El correo llega ya normalizado desde Aplicación.
 */
export function activeStudentByEmailReader(ctx: DbReader) {
  return {
    findActiveStudentByEmail: async (email: string) => {
      const profile = await findUserByEmail(ctx, email);
      return profile !== null && isActiveInRole(profile, "student") ? profile : null;
    },
  };
}

/**
 * Lecturas de solicitudes para los puertos `RequestReader`, `RequestTakeReader`
 * y `RequestListReader` (TI2-181). Las consultas lo crean con su `ctx` y
 * `requestStore` lo reutiliza en las mutations.
 */
export function requestReader(ctx: DbReader) {
  return {
    getRequest: (requestId: Id<"requests">) => getRequestById(ctx, requestId),
    hasActiveTake: async (requestId: Id<"requests">, userId: Id<"users">) =>
      (await findActiveTake(ctx, requestId, userId)) !== null,
    listOwnedRequests: (studentId: Id<"users">, options: PaginationOptions) =>
      listOwnedRequests(ctx, studentId, options),
    listReceivedRequests: (options: PaginationOptions) =>
      listRequestsByStatus(ctx, "received", options),
    listActiveTakes: (userId: Id<"users">, options: PaginationOptions) =>
      listActiveTakes(ctx, userId, options),
    listRecentTransitions: (requestId: Id<"requests">) =>
      listRecentRequestTransitions(ctx, requestId),
  };
}

/**
 * Perfil de quien lee solicitudes para el puerto `ActiveRequestViewerReader`
 * (TI2-181): Estudiante o Profesional de personal con cuenta habilitada y
 * vigente. La cuenta de prueba jamás lee el detalle (TI2-140): aunque tenga
 * una toma escrita a mano, no recibe `accessNeeds`.
 */
export function activeRequestViewerReader(ctx: DbReader) {
  return {
    findActiveViewer: async (tokenIdentifier: string | null) => {
      if (tokenIdentifier === null) return null;
      const profile = await findProfileByTokenIdentifier(ctx, tokenIdentifier);
      if (profile === null) return null;
      // La misma regla de Dominio que `findActiveProfileInRole`, para cada rol que lee.
      if (isActiveInRole(profile, "student")) return { _id: profile._id, role: "student" as const };
      if (isActiveInRole(profile, "professional") && !isTestProfessional(profile)) {
        return { _id: profile._id, role: "professional" as const };
      }
      return null;
    },
  };
}

/**
 * Profesional de quien llama para el puerto `ActiveProfessionalReader`
 * (TI2-181), con la misma regla que `activeStudentReader` más el veto de
 * TI2-140: la cuenta de prueba jamás opera solicitudes (toma, aceptación,
 * respuesta, cierre ni bandejas), aunque esté habilitada y vigente.
 */
export function activeProfessionalReader(ctx: DbReader) {
  return {
    findActiveProfessional: async (tokenIdentifier: string | null) => {
      const profile = await findActiveProfileInRole(ctx, tokenIdentifier, "professional");
      return profile !== null && !isTestProfessional(profile) ? profile : null;
    },
  };
}

async function findActiveProfileInRole(
  ctx: DbReader,
  tokenIdentifier: string | null,
  role: Doc<"users">["role"],
): Promise<Doc<"users"> | null> {
  if (tokenIdentifier === null) return null;
  const profile = await findProfileByTokenIdentifier(ctx, tokenIdentifier);
  return profile !== null && isActiveInRole(profile, role) ? profile : null;
}

/** Tope de cambios recientes que se leen para armar el detalle. */
const RECENT_TRANSITIONS_LIMIT = 50;

/** Cambios de estado más recientes de la solicitud, del último al primero. */
export async function listRecentRequestTransitions(
  ctx: DbReader,
  requestId: Id<"requests">,
): Promise<Doc<"requestTransitions">[]> {
  return await ctx.db
    .query("requestTransitions")
    .withIndex("by_request", (q) => q.eq("requestId", requestId))
    .order("desc")
    .take(RECENT_TRANSITIONS_LIMIT);
}

/** Solicitudes propias del estudiante, paginadas. */
export async function listOwnedRequests(
  ctx: DbReader,
  studentId: Id<"users">,
  paginationOpts: PaginationOptions,
) {
  return await ctx.db
    .query("requests")
    .withIndex("by_student", (q) => q.eq("studentId", studentId))
    .paginate(paginationOpts);
}

/** Solicitudes en un estado dado, paginadas. */
export async function listRequestsByStatus(
  ctx: DbReader,
  status: Doc<"requests">["status"],
  paginationOpts: PaginationOptions,
) {
  return await ctx.db
    .query("requests")
    .withIndex("by_status", (q) => q.eq("status", status))
    .paginate(paginationOpts);
}

/** Tomas activas del usuario, paginadas por solicitud para duplicadas adyacentes. */
export async function listActiveTakes(
  ctx: DbReader,
  userId: Id<"users">,
  paginationOpts: PaginationOptions,
) {
  return await ctx.db
    .query("requestAssignments")
    .withIndex("by_user_and_status_and_request", (q) =>
      q.eq("userId", userId).eq("status", "active"),
    )
    .order("asc")
    .paginate(paginationOpts);
}

/** Toma activa exacta de la solicitud por el usuario, si existe. */
export async function findActiveTake(
  ctx: DbReader,
  requestId: Id<"requests">,
  userId: Id<"users">,
): Promise<Doc<"requestAssignments"> | null> {
  const rows = await ctx.db
    .query("requestAssignments")
    .withIndex("by_request_and_user_and_status", (q) =>
      q.eq("requestId", requestId).eq("userId", userId).eq("status", "active"),
    )
    .take(1);
  return rows[0] ?? null;
}

/** Crea la toma activa de la solicitud por el usuario. */
export async function insertActiveTake(
  ctx: MutationCtx,
  input: {
    readonly requestId: Id<"requests">;
    readonly userId: Id<"users">;
    readonly grantedBy: Id<"users">;
  },
) {
  return await ctx.db.insert("requestAssignments", {
    requestId: input.requestId,
    userId: input.userId,
    grantedBy: input.grantedBy,
    grantedAt: Date.now(),
    status: "active",
  });
}

/** Marca la solicitud como tomada por el usuario. */
export async function markRequestTaken(
  ctx: MutationCtx,
  requestId: Id<"requests">,
  userId: Id<"users">,
): Promise<void> {
  await ctx.db.patch(requestId, { takenBy: userId });
}
