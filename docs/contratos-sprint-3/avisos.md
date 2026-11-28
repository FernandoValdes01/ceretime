# Contrato Sprint 3 — Bandeja de avisos (TI2-154)

Superficie pública para que cada persona consulte sus avisos, distinga leídos de pendientes, los marque como leídos y llegue al recurso de un aviso solo si todavía tiene permiso. Los avisos nacen de los cambios de solicitudes, agenda y justificaciones (TI2-150, ver «Avisos» en `solicitudes.md` y «Avisos de la agenda» en `agenda.md`) y se guardan en `notificationEvents` (TI2-145). TI2-154 no agrega correo, push ni pantallas: son TI2-159, TI2-160 y TI2-172. La suscripción push propia, que sí es pública, se describe en «Notificaciones push (TI2-160)».

## Operaciones públicas

| Operación | Argumentos | Devuelve |
| --- | --- | --- |
| `presentation.notifications.listOwnNotifications` (query) | `paginationOpts`, `readStatus?` (`"pending"` o `"read"`) | Página de avisos propios, del más reciente al más antiguo |
| `presentation.notifications.openNotification` (query) | `notificationId` | El aviso, solo si quien llama todavía puede leer su recurso |
| `presentation.notifications.markNotificationRead` (mutation) | `notificationId` | `{id, readStatus: "read", readAt}` |

## Forma del aviso

Cada aviso referencia exactamente un recurso:

| Campo | Tipo | Regla |
| --- | --- | --- |
| `id` | `Id<"notificationEvents">` | Identificador del aviso |
| `kind` | Clase del aviso | Una clase `appointment_*` viaja con `appointmentId`; una clase `request_*`, con `requestId` |
| `appointmentId` | `string` | Atención del aviso, con el mismo tipo que la agenda. Una justificación referencia su atención |
| `requestId` | `Id<"requests">` | Solicitud del aviso, con el mismo tipo que las solicitudes |
| `recipientId` | `Id<"users">` | Siempre quien llama |
| `occurredAt` | `number` | Instante persistido del cambio, en milisegundos de época |
| `readStatus` | `"pending"` o `"read"` | Pendiente mientras no se marcó |
| `readAt` | `number`, opcional | Instante de la primera lectura; ausente si está pendiente |
| `version` | `"v1"` | Versión del contrato del evento (`NOTIFICATION_CONTRACT_VERSION`) |

El aviso no trae títulos, motivos, respuestas, explicaciones, notas, necesidades ni datos del recurso. El cliente compone el texto en sesión a partir de `kind` con `NOTIFICATION_EVENT_KIND_LABELS` del dominio, el mismo para Web y Mobile, y lee el contenido en el detalle del recurso, con su propio permiso. Fuera de sesión solo se usa el texto genérico de `toExternalNotification`.

## Reglas

- **Solo los propios.** El destinatario sale del perfil de la sesión, nunca de un argumento. Cualquier rol con cuenta habilitada y vigente tiene bandeja; sin sesión o con una cuenta que no está vigente, las tres operaciones responden `unauthorized`.
- **Ajeno igual que inexistente.** Abrir o marcar un aviso de otra persona responde el mismo `unauthorized` que uno inexistente, sin escribir nada.
- **Leídos y pendientes.** Sin `readStatus`, la página trae los dos. Con `"pending"`, solo los que no tienen `readAt`, incluidos los anteriores a TI2-145. Con `"read"`, solo los marcados. El orden es siempre por ocurrencia, del más reciente al más antiguo.
- **Página.** `numItems` se acota entre 1 y 50; un valor no finito responde `conflict`. El cursor es el `continueCursor` que entrega Convex en cada página.
- **Marcar es idempotente.** La primera marca guarda el instante del servidor; repetirla responde el mismo `readAt` sin cambiarlo. Marcar no exige permiso sobre el recurso: el aviso es de quien lo recibió.
- **Abrir exige el permiso vigente.** `openNotification` vuelve a evaluar, en ese momento, la misma regla que el detalle del recurso. Para una atención usa `findReadableAppointment` de `convex/application/appointments/queries.ts`, la regla de `getAppointment`, que autoriza con `authorizeAppointmentRead` de `convex/application/authorization/authorize.ts`. Para una solicitud usa `findReadableRequest` de `convex/application/requests/queries.ts`, la regla de `getRequest`: el Estudiante dueño, o el Profesional con toma activa. Quien perdió el permiso, por una asignación revocada, una toma retirada o un recurso inexistente, recibe `unauthorized` sin saber si el recurso existe. El aviso sigue en su bandeja con solo la clase y la referencia.
- **Abrir no marca.** Una consulta no escribe; el cliente llama a `markNotificationRead` cuando corresponda.

## Errores

| Código | Cuándo |
| --- | --- |
| `unauthorized` | Sin sesión o con cuenta no vigente; aviso ajeno o inexistente; recurso sin permiso vigente al abrir |
| `conflict` | `numItems` no finito al listar |

## Ejemplo

```ts
const page = useQuery(api.presentation.notifications.listOwnNotifications, {
  paginationOpts: { numItems: 20, cursor: null },
  readStatus: "pending",
});
const convex = useConvex();
const markRead = useMutation(api.presentation.notifications.markNotificationRead);

// Al elegir un aviso: si el permiso sigue vigente, se marca y se navega al recurso.
const notice = await convex.query(api.presentation.notifications.openNotification, {
  notificationId,
});
await markRead({ notificationId: notice.id });
```

## Comprobación

`convex/tests/notificationInboxApi.test.ts` recorre la API con datos ficticios y el reloj fijo: cada persona lista solo sus avisos, el aviso de otra persona no se abre ni se marca, la bandeja exige sesión y cuenta vigente, la marca es idempotente, el filtro separa leídos de pendientes, y abrir un aviso de atención o de solicitud se deniega al revocar la asignación o retirar la toma, igual que el detalle del recurso.

## Notificaciones push (TI2-160)

Canal opcional fuera de sesión. Cada persona activa o retira la suscripción del navegador que usa; el envío, el cifrado y los reintentos corren en el servidor. La configuración de claves VAPID por deployment está en `docs/operaciones/notificaciones-push.md`.

| Operación | Argumentos | Devuelve |
| --- | --- | --- |
| `presentation.notifications.getOwnPushStatus` (query) | — | `{enabled, subscriptionCount, vapidPublicKey}`; `vapidPublicKey` es `null` si el deployment no tiene `VAPID_PUBLIC_KEY` |
| `presentation.notifications.activatePushSubscription` (mutation) | `endpoint`, `p256dh`, `auth`, `expirationTime?` (los valores de `PushSubscription.toJSON()`) | `{created}`: `true` si la suscripción es nueva, `false` si actualizó una propia |
| `presentation.notifications.deactivatePushSubscription` (mutation) | `endpoint` | `{deleted}`: `false` si el endpoint no era una suscripción propia |

- **Solo las propias.** La persona sale de la sesión, nunca de un argumento. Sin sesión o con una cuenta que no está vigente, las tres responden `unauthorized`. Retirar un endpoint ajeno o inexistente responde `{deleted: false}` sin tocar nada.
- **Proveedores admitidos.** El endpoint debe ser `https`, sin credenciales ni puerto, y de un servicio push conocido (Google, Mozilla, Apple o Microsoft); otro origen responde `conflict` sin guardar. Así el servidor nunca firma con VAPID una solicitud hacia un destino arbitrario.
- **Tope.** Cada persona tiene a lo sumo `MAX_PUSH_SUBSCRIPTIONS_PER_USER` (20) suscripciones activas. Actualizar una propia siempre se permite; agregar la número 21 responde `conflict`.
- **Texto genérico.** La notificación usa solo el texto de `toExternalNotification`: no menciona a CERETI, la atención ni la solicitud.

| Código | Cuándo |
| --- | --- |
| `unauthorized` | Sin sesión o con cuenta no vigente |
| `conflict` | Endpoint de un proveedor no admitido, suscripción inválida o tope alcanzado al activar |

`convex/tests/pushNotificationDelivery.test.ts` cubre que sin suscripción no se envía nada, el envío cifrado y su reintento sin duplicar, el retiro automático ante `410`, la desactivación solo de lo propio, el resultado incierto y el rechazo de un origen ajeno y de la suscripción número 21.

## Impacto en los clientes

Es un módulo nuevo (`api.presentation.notifications`). No cambia ninguna operación existente. Mobile no consume ninguna de las dos, y una notificación nativa de Mobile no usaría Web Push.

Web lo consume desde TI2-172 en `/estudiante/avisos` y `/profesional/avisos`, los dos roles que reciben avisos. La bandeja filtra por `readStatus`; al abrir un aviso llama a `openNotification`, lo marca con `markNotificationRead` si estaba pendiente y navega al detalle de la atención o de la solicitud en el área de quien lo recibió; si marcarlo falla, navega igual y el aviso queda pendiente. Si el permiso ya no está vigente, muestra un aviso genérico, no navega y deja el aviso en la bandeja. La misma pantalla ofrece activar push en el navegador (`getOwnPushStatus`, `activatePushSubscription` y `deactivatePushSubscription`), que se dan por activos solo si el navegador está suscrito y `getOwnPushStatus` responde `enabled`, y vincular o desconectar Google Calendar (ver `calendar.md`).
