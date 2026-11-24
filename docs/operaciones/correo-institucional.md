# Envío de avisos por correo institucional

Guía operativa para configurar, mantener y verificar el despacho de avisos por correo institucional mediante la API de Gmail (TI2-159). Los secretos y tokens de actualización viven únicamente en las variables de entorno del deployment de Convex correspondiente y nunca se guardan en el repositorio.

## Despliegue en Vercel y Convex

La publicación de la aplicación web en Vercel y el despliegue del backend de Convex son pasos separados. El envío de avisos por correo ocurre íntegramente en Convex (`convex/operations/notifications.ts` y `convex/crons.ts`), por lo que requiere tener las variables cargadas en el deployment de Convex y las funciones desplegadas (`bunx convex dev --once` en desarrollo o `bunx convex deploy` en producción); publicar en Vercel no actualiza las variables ni los cron jobs de Convex.

## Variables de entorno por deployment

Todas las variables están declaradas en `convex/convex.config.ts` y se configuran con `bunx convex env set` (agregando `--prod` al apuntar a producción):

| Variable                     | Desarrollo                                                             | Producción                                                           | Propósito                                                                                    |
| ---------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `GOOGLE_CLIENT_ID`           | Cliente OAuth del proyecto Google Cloud de CERETIME                    | Mismo cliente OAuth configurado para el entorno de producción        | Identifica el cliente que canjea el token de actualización                                   |
| `GOOGLE_CLIENT_SECRET`       | Secreto del mismo cliente OAuth                                        | Secreto del mismo cliente OAuth                                      | Autentica el canje del token ante `oauth2.googleapis.com/token`                              |
| `GMAIL_SENDER_ADDRESS`       | Cuenta institucional remitente autorizada (`wpeneipil2025@alu.uct.cl`) | Cuenta institucional remitente autorizada para el entorno            | Encabezado `From` del correo (sin nombre visible que mencione CERETI)                        |
| `GMAIL_SENDER_REFRESH_TOKEN` | Token de actualización OAuth con alcance `gmail.send`                  | Token de actualización OAuth vigente para el entorno                 | Permite obtener un token de acceso en cada despacho                                          |
| `EMAIL_ALLOWED_RECIPIENTS`   | Lista separada por comas con buzones de prueba autorizados             | Sin definir (vacía), para permitir cualquier destinatario registrado | En desarrollo impide envíos reales a correos ficticios; obligatorio con semillas habilitadas |
| `TEST_SEEDS_ENABLED`         | `"true"` solo si se usan semillas ficticias                            | Ausente (nunca habilitar en producción)                              | Si vale `"true"` y `EMAIL_ALLOWED_RECIPIENTS` está vacío, el remitente bloquea todo envío    |

Cuando `GMAIL_SENDER_ADDRESS` o `GMAIL_SENDER_REFRESH_TOKEN` faltan, los avisos no se pierden ni deshacen el cambio que los originó: quedan registrados en `notificationDeliveries` con `status: "failed"` y `errorCode: "not_configured"` y se vuelven a intentar cada 15 minutos hasta que se configuren las variables.

## Autorizar la cuenta remitente con `gmail.send`

1. En Google Cloud Console, selecciona el proyecto de CERETIME y verifica en **APIs y servicios → Biblioteca** que **Gmail API** esté habilitada.
2. En **Google Auth Platform → Acceso a datos** (o **Pantalla de consentimiento de OAuth → Alcances**), agrega únicamente el permiso mínimo `https://www.googleapis.com/auth/gmail.send` (no agregues permisos de lectura del buzón).
3. En **Público / Usuarios de prueba**, verifica que la cuenta institucional remitente (`wpeneipil2025@alu.uct.cl`) esté agregada mientras la aplicación siga en modo de prueba.
4. En **Clientes / Credenciales**, abre el cliente OAuth correspondiente a `GOOGLE_CLIENT_ID` y verifica que `https://developers.google.com/oauthplayground` figure en las URIs de redirección autorizadas.
5. Abre [OAuth 2.0 Playground](https://developers.google.com/oauthplayground/), haz clic en el ícono de configuración, marca **Use your own OAuth credentials**, pega `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET`, y confirma `Access type: Offline` y `Force prompt: Consent screen`.
6. En el paso 1 ingresa `https://www.googleapis.com/auth/gmail.send`, pulsa **Authorize APIs**, inicia sesión con la cuenta remitente institucional y aprueba el permiso.
7. En el paso 2 pulsa **Exchange authorization code for tokens** y copia el valor de `refresh_token`.
8. Carga las variables en el deployment correspondiente sin registrar el token en archivos ni en el chat:

```powershell
bunx convex env set GMAIL_SENDER_ADDRESS "wpeneipil2025@alu.uct.cl"
bunx convex env set GMAIL_SENDER_REFRESH_TOKEN "<refresh_token>"
bunx convex env set EMAIL_ALLOWED_RECIPIENTS "<correo_prueba_1>,<correo_prueba_2>"
```

En producción ejecuta los dos primeros comandos agregando `--prod` y deja `EMAIL_ALLOWED_RECIPIENTS` sin definir para que los avisos lleguen a los usuarios institucionales registrados.

## Mantenimiento y renovación del remitente

- **Responsable:** el responsable de TI2-159 (`wpeneipil2025@alu.uct.cl`) mantiene la autorización de la cuenta remitente y la renueva antes de cada demostración mientras la aplicación de Google Cloud permanezca en modo de prueba.
- **Vencimiento cada 7 días:** en modo de prueba Google revoca el `refresh_token` a los 7 días. Cuando vence, los envíos fallan con `errorCode: "not_authorized"` y quedan programados para reintento cada 15 minutos sin agotar el límite de reintentos del proveedor ni perder el aviso.
- **Cómo renovar:** repite los pasos 5 a 7 en OAuth 2.0 Playground con la cuenta remitente y actualiza `GMAIL_SENDER_REFRESH_TOKEN` con `bunx convex env set` (o `--prod`). El siguiente barrido del cron despachará automáticamente los avisos pendientes.

## Comprobar que el aviso llega y queda registrado

1. En desarrollo, confirma que `EMAIL_ALLOWED_RECIPIENTS` incluya tu buzón de prueba y que exista un usuario de prueba en `users` con ese correo (sin usar datos personales de terceros ni exponerlos en el repositorio).
2. Dispara una acción que genere un aviso (por ejemplo, `presentation/requests:createRequest` con una solicitud ficticia o una reserva de atención).
3. Verifica en el dashboard de Convex o por CLI que se crearon el evento y la entrega en estado `sent`:

```powershell
bunx convex data notificationEvents --limit 5 --format json
bunx convex data notificationDeliveries --limit 5 --format json
```

4. Comprueba en el buzón de prueba que el correo llegó desde `GMAIL_SENDER_ADDRESS` con asunto y cuerpo genéricos (por ejemplo, «Tienes una actualización pendiente» y «Revisa las novedades en la aplicación.»), sin mencionar CERETI, profesional, necesidades ni tipo de acompañamiento.

## Resolver entregas con resultado incierto (`delivery_uncertain`)

Una entrega queda en `status: "failed"` con `errorCode: "delivery_uncertain"` y sin `nextAttemptAt` cuando se pierde la respuesta después de llamar a Gmail o cuando la acción se interrumpe entre la confirmación de Gmail y el registro de `sent`. Ese estado retira la entrega del barrido automático para impedir un segundo correo duplicado.

- **Quién revisa estos casos:** el responsable de mantenimiento del remitente institucional (responsable de TI2-159, `wpeneipil2025@alu.uct.cl`) o quien opere el correo en producción.
- **Cómo detectarlos:** en el dashboard de Convex abre la tabla `notificationDeliveries` y filtra por `status = "failed"` y `errorCode = "delivery_uncertain"`, o consulta por CLI (agregando `--prod` en producción):

```powershell
bunx convex data notificationDeliveries --limit 50 --format json
```

- **Cómo verificar en el buzón remitente antes de decidir si se reenvía:**
  1. Toma el `eventId` de la fila en `notificationDeliveries`, busca el evento en `notificationEvents` para obtener `recipientId`, `kind` y `readAt`, y consulta el correo del destinatario en `users`.
  2. Abre la carpeta **Enviados** de la cuenta remitente (`GMAIL_SENDER_ADDRESS`) y busca correos enviados a ese destinatario alrededor de `lastAttemptAt` con el asunto genérico correspondiente.
  3. **Si el correo figura en Enviados:** no reenviar; el destinatario ya recibió el aviso.
  4. **Si el correo no figura en Enviados:** verifica si el aviso sigue pendiente (`readAt` ausente en `notificationEvents`) y coordina un reenvío manual o aviso por canal oficial sin crear otra fila en `notificationEvents`.
