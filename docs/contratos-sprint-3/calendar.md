# Contrato de Calendar de Sprint 3 — vínculo y desconexión (TI2-161)

Superficie que TI2-161 agrega al vínculo propio con Google Calendar: autorización con permiso mínimo, validación del retorno, estado publicado y desconexión con aviso. No implementa sincronización de eventos (TI2-162) ni pantalla (TI2-172): la reserva y el `.ics` por atención de TI2-122 siguen funcionando igual, con o sin vínculo.

Recorrido por capas: las reglas viven en `convex/domain/calendar/calendar_event.ts` (alcance mínimo) y `convex/domain/calendar/calendar_link.ts` (metadatos y estado por atención); los casos de uso, en `convex/application/calendar/calendar.ts` (por atención) y `convex/application/calendar/calendar_link.ts` (vínculo propio); la persistencia y el proveedor, en `convex/infrastructure/calendar/repository.ts` (`calendarConnections` y `calendarSync*`) y `convex/infrastructure/calendar/google_calendar.ts` (crear, actualizar y leer alcances); la API pública, en `convex/presentation/calendar.ts` (vínculo) y `convex/presentation/appointments.ts` (por atención, TI2-122).

## Vínculo propio

El inicio institucional y el consentimiento de Calendar son dos pasos distintos sobre la misma cuenta de Google: el inicio pide solo identidad (`openid`, `email`, `profile`) y el vínculo pide únicamente `https://www.googleapis.com/auth/calendar.events` mediante `linkSocial` con `calendar.events`. El guard `guardGoogleOAuth` bloquea el inicio por `google` y cualquier alcance del cliente fuera de ese contrato; el retorno se valida en el servidor comprobando que el alcance mínimo esté concedido antes de registrar metadatos. Rechazar la autorización responde `connected: false` sin error y nunca impide reservar, reagendar ni descargar el `.ics`.

Los tokens OAuth se guardan cifrados en reposo (`account.encryptOAuthTokens: true`) en el componente de autenticación y solo se usan en el servidor: Better Auth los renueva con el refresh token cuando están por expirar; un token ausente, revocado o sin refresh se traduce a `not_connected`, nunca a un error del proveedor. Ninguna respuesta pública devuelve tokens, referencias de cuenta, correos ni alcances. La referencia opaca a la cuenta se resuelve en el servidor desde el documento de cuenta de Better Auth y nunca llega del cliente.

## Operaciones públicas

Todas derivan la identidad con `ctx.auth.getUserIdentity()` y nunca aceptan `userId` ni actor como argumento: cada persona solo vincula o desconecta su propia cuenta. Estudiante y profesional con perfil vigente pueden vincular; cualquier sesión con perfil vigente puede consultar el estado.

| Operación | Tipo | Argumentos | Devuelve | Quién |
| --- | --- | --- | --- | --- |
| `presentation/calendar.getCalendarLinkStatus` | query | — | `{connected, linkedAt?, revokedAt?, staleEventsMayRemain}` | Cualquier sesión con perfil vigente |
| `presentation/calendar.confirmCalendarLink` | mutation | — | `{connected: true, linkedAt, status: "linked" \| "already_linked"}` o `{connected: false, status: "not_connected"}` | Titular con perfil vigente y alcance mínimo concedido |
| `presentation/calendar.disconnectCalendarLink` | mutation | — | `{disconnected, status: "unlinked" \| "already_unlinked" \| "not_found", revokedAt?, staleEventsMayRemain}` | Titular con perfil vigente |
| `presentation/appointments.getCalendarConnection` | query | — | `{connected}` | Cualquier sesión con perfil vigente (TI2-122, se conserva por compatibilidad) |

`connected` tiene una sola fuente: los alcances OAuth que Better Auth conserva para la cuenta `google`. La tabla `calendarConnections` guarda solo metadatos locales (`accountReference` opaca, `linkedAt`, `revokedAt`, `updatedAt`) con una fila por usuario y no declara «conectado»: una fila no afirma que la cuenta siga conectada. `staleEventsMayRemain` es verdadero solo tras una desconexión local (`revokedAt` presente) y la interfaz debe avisar que los eventos anteriores pueden quedar sin actualizar. Desconectar conserva la referencia y las fechas como trazabilidad y es idempotente (`already_unlinked`, `not_found`); no borra eventos ya creados y la revocación efectiva del acceso corresponde a Better Auth o a la revocación en la cuenta de Google.

## Respuestas y errores

Se usan solo los códigos del contrato común (`ConvexError({code, message})`) y los clientes distinguen por `code`, nunca por el texto. `unauthorized` (`No autorizado`) responde sin sesión, sin perfil o sin vigencia; `conflict` responde ante un instante inválido del servidor. Confirmar sin alcance mínimo no es un error: responde `connected: false` con `not_connected` para que la Web ofrezca volver a conectar o descargar el `.ics`. Ningún rechazo del vínculo cambia la reserva: un fallo de Google se respalda con el `.ics` vigente (`fallback` con `not_connected` o `unavailable`) sin detalles del proveedor.

## Compatibilidad

El cambio es aditivo: `presentation/appointments.*` no cambia de forma y la Web de TI2-122 sigue funcionando. La sincronización automática de reservas, cambios y cancelaciones es TI2-162 y la bandeja con vinculación es TI2-172; esta entrega no lee el calendario completo ni trae cambios desde Google hacia CERETI. RF-27 y RN-17 de `docs/sources/requerimientos/requerimientos.tex` quedan alineados con esa sincronización automática en lugar de la acción explícita por atención (ver sección siguiente de este contrato).

## Comprobación

`convex/application/calendar/calendar_link.test.ts` cubre el estado, la confirmación y la desconexión con dobles: sesión exigida, alcance mínimo, rechazo sin bloqueo, cuenta propia, idempotencia, aviso de eventos previos, códigos `unauthorized` y `conflict`, y ausencia de credenciales en las respuestas. `convex/tests/calendarLinkApi.test.ts` recorre el borde con datos ficticios: denegación sin sesión o sin vigencia, desconectado sin cuenta vinculada, confirmación rechazada sin error, desconexión propia e idempotente sin tocar la fila de otra persona, y sin credenciales en la respuesta. La verificación real con cuenta de prueba (conectar, confirmar, agregar, revocar y volver a conectar) sigue el guion de `docs/integraciones/google-calendar.md` y queda pendiente de evidencia en la PR.

## Pendientes

Sincronizar reservas, cambios y cancelaciones sin duplicar eventos (TI2-162) y construir la bandeja Web con preferencia push y vinculación (TI2-172). La recuperación de un evento borrado directamente en Google y la sincronización de cancelaciones siguen fuera de alcance.
