# Google Calendar por atención y alternativa `.ics` (TI2-122)

Integración real con Google Calendar para que el Estudiante dueño de una atención la agregue a su calendario personal con una acción explícita, más una alternativa `.ics` que funciona sin conexión con Google.

El alcance es deliberadamente mínimo: se crea un evento por atención y se distingue si la referencia sigue vigente tras un reagendamiento; nunca se leen ni se listan calendarios. La reserva vive en Convex y el proveedor externo es solo un destino opcional; un fallo de Google no cancela, no mueve ni oculta la atención.

## Flujo de uso

1. La persona inicia sesión con su cuenta institucional. Ese inicio pide solo identidad (`openid`, `email`, `profile`).
2. En el detalle de su acompañamiento ve sus atenciones y el estado de la conexión con Google Calendar.
3. Si quiere crear el evento automáticamente, pulsa «Conectar Google Calendar». Es un consentimiento OAuth aparte que pide únicamente `https://www.googleapis.com/auth/calendar.events`.
4. Por cada atención en estado `scheduled` o `rescheduled`, pulsa «Agregar a Google Calendar». La acción crea el evento en el calendario primario de la cuenta vinculada.
5. Al reagendar una atención que ya tenía evento, la referencia conserva el horario anterior y queda obsoleta: el listado muestra la fecha nueva con «Evento de Google Calendar desactualizado» y no confirma la nueva fecha como agregada. No hay sincronización automática en esta entrega.
6. Por cada atención vigente, con o sin conexión, puede descargar el archivo `atencion-programada.ics` e importarlo en el calendario que prefiera. El archivo se pide al pulsar el botón, así refleja siempre el horario vigente.
7. Si el evento quedó con el horario anterior, la interfaz ofrece «Actualizar en Google Calendar». Esa acción usa `PATCH` sobre el mismo evento determinista y responde `updated`; si falla, responde `fallback` con el `.ics` vigente.
8. Si Google revoca el acceso, la acción responde `fallback` con `not_connected`; la interfaz muestra que la conexión se perdió y ofrece «Volver a conectar Google Calendar».

Solo las atenciones en estado `scheduled` o `rescheduled` admiten las dos acciones de calendario. Una atención cancelada, realizada o con inasistencia no se exporta como evento confirmado ni se crea en Google Calendar: la API responde `conflict` y la interfaz no muestra los botones.

Un acompañamiento cerrado muestra sus atenciones en solo lectura: no ofrece conexión ni acciones de calendario, pero conserva el historial visible.

## Contrato público compartido (Web y Mobile)

La superficie es la misma para ambas aplicaciones, sale de `api.presentation.appointments` y de los tipos generados en `convex/_generated`. No existe endpoint propio de Web ni de Mobile, ni una tabla paralela de reservas o calendario.

| Operación                                                  | Argumentos        | Devuelve                                                                                                                                   | Quién                                                                     |
| ---------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| `presentation/appointments.listAccompanimentAppointments`  | `accompanimentId` | Lista acotada (máximo 50, más reciente primero) de `{appointmentId, status, startAt, endAt, modality, calendarAdded, calendarNeedsUpdate}` | Estudiante dueño, Profesional o Practicante asignado                      |
| `presentation/appointments.getAppointmentCalendarFile`     | `appointmentId`   | `{fileName, content, alreadyAdded}`                                                                                                        | Solo el Estudiante dueño de una atención vigente en acompañamiento activo |
| `presentation/appointments.getCalendarConnection`          | —                 | `{connected: boolean}`                                                                                                                     | Cualquier sesión con perfil vigente                                       |
| `presentation/appointments.addAppointmentToGoogleCalendar` | `appointmentId`   | `{status: "created" \| "updated" \| "already_created", eventId, ics}` o `{status: "fallback", reason, ics}`                                | Solo el Estudiante dueño de una atención vigente en acompañamiento activo |

Reglas del contrato:

- `startAt` y `endAt` son instantes epoch en ms; la zona oficial de la agenda es `America/Santiago` (`AGENDA_TIME_ZONE`).
- `status` usa los literales de `APPOINTMENT_STATUS_VALUES`. Solo `scheduled` y `rescheduled` admiten acciones: el backend rechaza la descarga y la creación con `conflict` para el resto de los estados, y la interfaz oculta ambos botones.
- `calendarAdded` es `true` solo si la referencia guardada está sincronizada con `startsAt`/`endsAt` vigentes. `calendarNeedsUpdate` es `true` cuando existe un evento guardado pero conserva el horario anterior. `calendarEventId`, `calendarEventAddedAt`, `calendarEventStartsAt` y `calendarEventEndsAt` son persistencia interna y no se exponen como identificadores al cliente.
- Una referencia sin horario guardado se considera obsoleta: no responde `already_created` aunque exista `calendarEventId`, porque no hay evidencia de que el evento tenga la fecha vigente.
- `alreadyAdded` del `.ics` sigue la misma regla: solo es `true` para una referencia vigente.
- `ics` y la descarga usan `{fileName, content}` con el nombre `atencion-programada.ics`. El contenido es texto RFC 5545 con CRLF, escape y plegado a 75 octetos.
- `fallback.reason` solo distingue `not_connected` de `unavailable`. Nunca incluye la respuesta, encabezados, tokens ni el correo de Google.
- Toda denegación de autorización responde `ConvexError("No autorizado")`, sin revelar si la atención o el acompañamiento existen.
- Una cuenta inhabilitada, una atención ajena, una de otro acompañamiento, una de un acompañamiento cerrado o una identidad sin perfil reciben la misma denegación genérica.

Para Mobile, la integración consiste en consumir esas cuatro operaciones con el cliente Convex existente:

- `useQuery(api.presentation.appointments.listAccompanimentAppointments, { accompanimentId })` para el listado.
- `useQuery(api.presentation.appointments.getCalendarConnection, {})` para el estado de la conexión.
- `useAction(api.presentation.appointments.addAppointmentToGoogleCalendar, { appointmentId })` para la acción explícita.
- `useConvex().query(api.presentation.appointments.getAppointmentCalendarFile, { appointmentId })` para obtener el `.ics` bajo demanda y guardarlo o compartirlo con el mecanismo nativo de la aplicación.
- El consentimiento de Calendar se inicia con `authClient.linkSocial({ provider: "google", scopes: [CALENDAR_EVENTS_SCOPE], callbackURL, errorCallbackURL })`, igual que en Web. El valor `CALENDAR_EVENTS_SCOPE` se importa del Dominio compartido o se replica solo como constante documentada; no se inventa un scope distinto.

Mobile no necesita leer tokens, correo de Google ni el documento de cuenta: el backend resuelve la conexión, la creación y la actualización del evento. Si Mobile agrega su propia pantalla, debe conservar los estados de carga, vacío, error, éxito y solo lectura, distinguir `calendarNeedsUpdate` para ofrecer la actualización y no debe mostrar detalles del proveedor.

## Reagendamiento sin sincronización automática

- La mutación `rescheduleAppointment` no llama a Google y no programa sincronización en esta entrega.
- Al reagendar, la referencia guarda el horario anterior y queda obsoleta: `calendarAdded` pasa a `false` y `calendarNeedsUpdate` a `true`; el `.ics` refleja la fecha nueva y `alreadyAdded` pasa a `false`.
- Un fallo de Google no revierte el reagendamiento ni se propaga. La persona puede reintentar la actualización explícita o descargar el `.ics` vigente.
- La recuperación de un evento borrado directamente en Google y la sincronización de cancelaciones siguen fuera de alcance.

## Consentimiento OAuth separado

El inicio institucional y el consentimiento de Calendar son dos pasos distintos sobre la misma cuenta de Google:

- El inicio institucional sigue pidiendo solo `openid`, `email` y `profile`; el rechazo de dominios no institucionales ocurre en `databaseHooks` del backend.
- La conexión de Calendar usa `linkSocial` con el alcance `calendar.events` y vuelve a la ruta de la atención con `?calendar=connected` o `?calendar=error`.
- `accessType: "offline"` y `prompt: "select_account consent"` garantizan un refresh token para que la creación siga funcionando cuando el access token expire. El consentimiento de Calendar sigue siendo independiente porque su alcance solo viaja en la vinculación explícita.
- Los tokens OAuth se guardan cifrados en reposo (`account.encryptOAuthTokens: true`) en el componente de autenticación. No se registran, no se devuelven al cliente y no se incluyen en el `.ics`.
- Si la persona revoca el acceso desde su cuenta de Google, el backend recibe un fallo de token y responde `not_connected`; la interfaz muestra que la conexión se perdió, ofrece «Volver a conectar Google Calendar» y conserva el `.ics` de las atenciones vigentes. El estado almacenado puede seguir diciendo «conectado» hasta ese intento, porque los alcances guardados no cambian al revocar el token.
- Better Auth renueva el access token con el refresh token cuando está por expirar. Un refresh token ausente, revocado o inválido se traduce a `not_connected`, nunca a un error del proveedor.

## Configuración en Google Cloud

Todo ocurre en el mismo proyecto de Google Cloud asociado a `GOOGLE_CLIENT_ID` que ya usa el inicio institucional.

1. Habilita **Google Calendar API** en «APIs y servicios → Biblioteca». Sin esto, la creación responde `403 accessNotConfigured`.
2. En «APIs y servicios → Pantalla de consentimiento» agrega el alcance `https://www.googleapis.com/auth/calendar.events`. Es un alcance sensible: en modo prueba no requiere verificación, pero la pantalla debe declararlo.
3. Mantén los alcances de identidad (`openid`, `email`, `profile`) que ya usa el inicio institucional.
4. En «Credenciales → OAuth Client» confirma la URI de redirección exacta `https://<deployment>.convex.site/api/auth/callback/google`. Debe coincidir en esquema, mayúsculas y slash final; cualquier diferencia devuelve `redirect_uri_mismatch`.
5. Si la pantalla de consentimiento está en modo prueba, agrega la cuenta de Google de prueba como test user. Una cuenta fuera de la lista recibe `access_denied`.
6. Si el Workspace institucional bloquea aplicaciones de terceros, el administrador debe autorizarlas; el síntoma es `admin_policy_enforced`.
7. No se necesita ninguna variable de entorno nueva. La integración reutiliza las credenciales OAuth existentes.

## Variables de entorno

Solo nombres; ningún valor real pertenece al repositorio. Se configuran en el deployment de Convex con `convex env set`.

| Variable                      | Uso                                                      |
| ----------------------------- | -------------------------------------------------------- |
| `GOOGLE_CLIENT_ID`            | Cliente OAuth de Google, servidor                        |
| `GOOGLE_CLIENT_SECRET`        | Secreto OAuth, solo servidor                             |
| `BETTER_AUTH_SECRET`          | Firma de sesiones y cifrado de tokens, solo servidor     |
| `SITE_URL`                    | Origen de la Web para callbacks y orígenes confiables    |
| `CONVEX_SITE_URL`             | Base de `/api/auth/*` y redirect OAuth                   |
| `BETTER_AUTH_TRUSTED_ORIGINS` | Orígenes extra permitidos, separados por coma (opcional) |
| `VITE_CONVEX_URL`             | Cliente Convex en Web, pública                           |
| `VITE_CONVEX_SITE_URL`        | Base de `/api/auth/*` en Web, pública                    |

## Seguridad y privacidad

- El evento tiene título genérico `Atención programada`. No incluye CERETI, el nombre del Profesional, la modalidad, las necesidades de acceso, notas ni enlaces privados.
- El evento no lleva descripción, ubicación ni URL. Tampoco se agrega el correo de la cuenta.
- El `UID` del `.ics` y el `id` del evento de Google se derivan de forma determinista del identificador de la atención. Un reintento o un doble clic recibe `409` y se trata como éxito, sin duplicar. La actualización usa `PATCH` sobre ese mismo `id`; nunca crea un segundo evento.
- La referencia guarda el horario con el que se sincronizó el evento (`calendarEventStartsAt`/`calendarEventEndsAt`). Si difiere de `startsAt`/`endsAt`, el evento está desactualizado y no se responde `already_created`.
- El `.ics` usa instantes UTC (`DTSTART`, `DTEND`, `DTSTAMP`) y declara `X-WR-TIMEZONE:America/Santiago`; no incluye una tabla `VTIMEZONE` frágil.
- `DTSTAMP` sale del instante de creación de la atención, no del reloj de la consulta: dos descargas del mismo evento son idénticas.
- La reserva se conserva aunque falle el guardado de la referencia o la llamada a Google. El identificador determinista permite recuperar el evento en el siguiente intento.
- Los errores del proveedor se traducen a estados públicos (`not_connected`, `unavailable`) sin propagar cuerpos, encabezados ni credenciales.
- Una atención no vigente responde `conflict` tanto al pedir el `.ics` como al intentar crear el evento; nunca se genera un `STATUS:CONFIRMED` para una atención cancelada, realizada o con inasistencia.

## Verificación end-to-end

La verificación real requiere una cuenta de Google de prueba autorizada y el proyecto de Google Cloud configurado. Sin eso, la issue queda abierta y el bloqueo se reporta; los dobles y las pruebas de API no sustituyen la evidencia real.

1. Inicia sesión en Web con la cuenta institucional de prueba.
2. Abre un acompañamiento activo con al menos una atención `scheduled`.
3. Descarga el `.ics` y verifica que abre con el título genérico, la fecha, la duración y la zona correctas.
4. Pulsa «Conectar Google Calendar», elige la cuenta de prueba y aprueba solo el permiso de creación de eventos.
5. Verifica que la pantalla vuelve con el aviso de conexión y que el botón de agregar aparece.
6. Agrega la atención y confirma el evento en Google Calendar: título `Atención programada`, hora correcta en `America/Santiago`, sin descripción ni ubicación.
7. Pulsa de nuevo «Agregar» (o recarga y repite): debe responder que ya estaba agregada y no debe crear un segundo evento.
8. Cambia la fecha de la atención (agregar → reagendar → consultar): el listado muestra la fecha nueva, `calendarAdded` en `false` y «Evento de Google Calendar desactualizado»; el `.ics` trae la fecha nueva y `alreadyAdded` en `false`.
9. Con la pantalla del detalle abierta, cambia la fecha de la atención y verifica que el listado muestra la fecha nueva sin confirmar que está agregada.
10. Descarga el `.ics` después del reagendamiento: debe contener la fecha nueva. Si hubo `fallback`, usa el botón «Descargar .ics de respaldo» y confirma que también trae la fecha vigente, no la anterior.
11. Si aparece «Actualizar en Google Calendar», usa el botón y confirma que el evento existente se actualiza y responde `updated`.
12. Revoca el acceso de la aplicación desde la cuenta de Google e intenta agregar una atención: debe responder que la conexión se perdió y ofrecer «Volver a conectar Google Calendar», sin ocultar el `.ics`.
13. Pulsa «Volver a conectar Google Calendar», aprueba de nuevo el alcance y agrega una atención nueva: el evento debe crearse una sola vez.
14. Marca una atención como cancelada o realizada y confirma que no ofrece agregar ni descargar; la API debe responder `conflict` si se intenta por fuera de la interfaz.
15. Cierra el acompañamiento y confirma que las atenciones se ven en solo lectura, sin acciones de calendario.

## Diagnóstico de errores

| Síntoma                                           | Causa probable                                                                  | Acción                                                  |
| ------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `redirect_uri_mismatch`                           | La URI de callback no coincide exactamente con la registrada                    | Corregir la URI en Credenciales                         |
| `access_denied`                                   | La cuenta no es test user o la persona rechazó el consentimiento                | Agregar la cuenta o reintentar el consentimiento        |
| `admin_policy_enforced`                           | El Workspace bloquea aplicaciones de terceros                                   | Pedir autorización al administrador institucional       |
| `invalid_scope`                                   | El alcance `calendar.events` no está declarado en la pantalla de consentimiento | Agregarlo en la pantalla de consentimiento              |
| `403 accessNotConfigured`                         | Google Calendar API no está habilitada                                          | Habilitarla en la biblioteca del proyecto               |
| `403 insufficientPermissions`                     | La cuenta vinculada no concedió `calendar.events`                               | Volver a conectar Google Calendar desde el detalle      |
| La acción responde `fallback` con `not_connected` | No hay cuenta vinculada, falta el alcance o el token fue revocado               | Volver a conectar Google Calendar o descargar el `.ics` |
| La acción responde `fallback` con `unavailable`   | Google no respondió o devolvió un error no recuperable                          | Reintentar más tarde o descargar el `.ics`              |
| La acción o la descarga responden `conflict`      | La atención está cancelada, realizada o con inasistencia                        | No hay acción de calendario para ese estado             |

## Archivos de referencia

- `convex/domain/calendar/calendar_event.ts`: título, UID determinista, escape, plegado y conversión `.ics`.
- `convex/application/calendar/calendar.ts`: casos de uso, autorización, actualización explícita y respaldo.
- `convex/infrastructure/calendar/google_calendar.ts`: adaptador de Google (crear y actualizar) y lectura de alcances.
- `convex/operations/calendar.ts`: puente interno entre la acción y la base.
- `convex/presentation/appointments.ts`: API pública consumida por Web y Mobile.
- `apps/web/src/presentation/estudiante/student-appointments.tsx`: interfaz Web de conexión, descarga y acción.
- `apps/web/src/application/calendar/calendar-link.ts`: consentimiento separado de Calendar.
