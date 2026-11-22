import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { v, type Infer } from "convex/values";
import {
  listOwnNotifications as listOwnNotificationsUseCase,
  markNotificationRead as markNotificationReadUseCase,
  openNotification as openNotificationUseCase,
} from "../application/notifications/inbox";
import { mutation, query } from "../_generated/server";
import { authorizationReader } from "../infrastructure/accompaniments/repository";
import { appointmentAgendaReader } from "../infrastructure/appointments/repository";
import {
  notificationInboxReader,
  notificationReadMarker,
} from "../infrastructure/notifications/repository";
import { activeRequestViewerReader, requestReader } from "../infrastructure/requests/repository";
import {
  appointmentNotificationEventKindUnion,
  notificationContractVersionLiteral,
  notificationReadStatusUnion,
  requestNotificationEventKindUnion,
} from "../infrastructure/validators";
import { unwrapApiResult } from "./session";

/**
 * Borde de Presentación: bandeja de avisos (TI2-154).
 *
 * Adaptador delgado: resuelve la identidad en el servidor con
 * `ctx.auth.getUserIdentity()`, compone los adaptadores con el mismo `ctx` y
 * delega en `convex/application/notifications/inbox.ts`. Nunca recibe un
 * destinatario del cliente. Toda denegación llega como `{ code:
 * "unauthorized" }`, sin distinguir un aviso ajeno de uno inexistente ni de
 * uno cuyo recurso ya no se puede leer. Sin correo, push ni pantallas.
 */

const notificationBaseFields = {
  id: v.id("notificationEvents"),
  recipientId: v.id("users"),
  occurredAt: v.number(),
  readStatus: notificationReadStatusUnion,
  readAt: v.optional(v.number()),
  version: notificationContractVersionLiteral,
};

/**
 * Aviso propio: clase, referencia a exactamente un recurso, instante y
 * lectura. No lleva títulos, motivos, notas ni datos del recurso: el
 * contenido se lee en el recurso, con su propio permiso. La referencia usa
 * el tipo de cada contrato: `appointmentId` como texto, como en la agenda, y
 * `requestId` como `Id<"requests">`, como en las solicitudes.
 */
const notificationValidator = v.union(
  v.object({
    ...notificationBaseFields,
    kind: appointmentNotificationEventKindUnion,
    appointmentId: v.string(),
  }),
  v.object({
    ...notificationBaseFields,
    kind: requestNotificationEventKindUnion,
    requestId: v.id("requests"),
  }),
);

const notificationPageValidator = paginationResultValidator(notificationValidator);

// Aplicación entrega los identificadores como texto, porque no conoce Convex;
// salen de filas de `notificationEvents`, `users`, `appointments` y `requests`,
// y `returns` vuelve a validar cada uno antes de responder. Por eso el handler
// declara el tipo del validador.
type PublicNotification = Infer<typeof notificationValidator>;
type PublicNotificationPage = Infer<typeof notificationPageValidator>;

/**
 * Avisos propios, del más reciente al más antiguo. Sin `readStatus` trae
 * leídos y pendientes; con él, solo esos. A lo sumo 50 por página.
 */
export const listOwnNotifications = query({
  args: {
    paginationOpts: paginationOptsValidator,
    readStatus: v.optional(notificationReadStatusUnion),
  },
  returns: notificationPageValidator,
  handler: async (ctx, args): Promise<PublicNotificationPage> => {
    const identity = await ctx.auth.getUserIdentity();
    return unwrapApiResult(
      await listOwnNotificationsUseCase(
        { auth: authorizationReader(ctx), notifications: notificationInboxReader(ctx) },
        {
          tokenIdentifier: identity?.tokenIdentifier ?? null,
          paginationOpts: args.paginationOpts,
          ...(args.readStatus === undefined ? {} : { readStatus: args.readStatus }),
        },
      ),
    ) as PublicNotificationPage;
  },
});

/**
 * Abre un aviso propio y lo entrega solo si quien llama todavía puede leer su
 * recurso: con la respuesta, el cliente navega al detalle de la atención o de
 * la solicitud. No lo marca como leído.
 */
export const openNotification = query({
  args: { notificationId: v.id("notificationEvents") },
  returns: notificationValidator,
  handler: async (ctx, args): Promise<PublicNotification> => {
    const identity = await ctx.auth.getUserIdentity();
    return unwrapApiResult(
      await openNotificationUseCase(
        {
          auth: authorizationReader(ctx),
          notifications: notificationInboxReader(ctx),
          appointments: appointmentAgendaReader(ctx),
          requests: { viewers: activeRequestViewerReader(ctx), requests: requestReader(ctx) },
        },
        { tokenIdentifier: identity?.tokenIdentifier ?? null, notificationId: args.notificationId },
      ),
    ) as PublicNotification;
  },
});

/** Marca como leído un aviso propio; repetirlo conserva el instante original. */
export const markNotificationRead = mutation({
  args: { notificationId: v.id("notificationEvents") },
  returns: v.object({
    id: v.id("notificationEvents"),
    readStatus: v.literal("read"),
    readAt: v.number(),
  }),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    const marked = unwrapApiResult(
      await markNotificationReadUseCase(
        {
          auth: authorizationReader(ctx),
          notifications: notificationReadMarker(ctx),
          now: Date.now,
        },
        { tokenIdentifier: identity?.tokenIdentifier ?? null, notificationId: args.notificationId },
      ),
    );
    return { ...marked, id: args.notificationId };
  },
});
