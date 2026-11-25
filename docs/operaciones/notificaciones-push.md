# Notificaciones Web Push opcionales

Guía operativa para configurar, verificar y mantener el canal Web Push opcional fuera de sesión (TI2-160). Las claves privadas VAPID viven únicamente en las variables de entorno del deployment de Convex correspondiente y nunca se guardan en el repositorio.

## Despliegue en Vercel y Convex

La publicación de la aplicación web en Vercel y el despliegue de Convex son pasos separados. El service worker vive en `apps/web/public/push-sw.js` (publicado junto con la Web), mientras que el firmado VAPID, el cifrado `aes128gcm`, el despacho y el barrido de reintentos corren en Convex (`convex/operations/notifications.ts` y `convex/crons.ts`).

## Variables de entorno por deployment

Todas las variables están declaradas en `convex/convex.config.ts` y se cargan con `bunx convex env set` (agregando `--prod` al apuntar a producción):

| Variable            | Desarrollo / Producción                                                 | Propósito                                                                  |
| ------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `VAPID_PUBLIC_KEY`  | Clave pública P-256 sin comprimir en base64url (65 bytes)               | Se entrega al navegador mediante `getOwnPushStatus` para crear suscripción |
| `VAPID_PRIVATE_KEY` | Escalares privados P-256 (`d` de JWK) en base64url (solo secreto)       | Firma el JWT VAPID (`ES256`) en el servidor; nunca sale del backend        |
| `VAPID_SUBJECT`     | `mailto:<correo_institucional>` (ej. `mailto:wpeneipil2025@alu.uct.cl`) | Identifica al contacto técnico ante el servicio push del navegador         |

Si faltan las variables VAPID y una persona tiene suscripciones activas, los envíos push quedan registrados con `status: "failed"` y `errorCode: "not_configured"` y se vuelven a intentar cada 15 minutos sin perder el aviso ni deshacer el cambio original. Si la persona no activó push, no se crea fila de entrega push ni se intenta ningún envío.

## Generar y cargar claves VAPID

1. Genera un par P-256 en tu terminal local (no guardes la salida en el repositorio):

```powershell
bun -e 'const k = await crypto.subtle.generateKey({name:"ECDSA",namedCurve:"P-256"},true,["sign","verify"]); const pub = Buffer.from(await crypto.subtle.exportKey("raw",k.publicKey)).toString("base64url"); const priv = (await crypto.subtle.exportKey("jwk",k.privateKey)).d; console.log("VAPID_PUBLIC_KEY="+pub+"\nVAPID_PRIVATE_KEY="+priv);'
```

2. Carga las tres variables en Convex (agrega `--prod` en producción):

```powershell
bunx convex env set VAPID_PUBLIC_KEY "<clave_publica>"
bunx convex env set VAPID_PRIVATE_KEY "<clave_privada>"
bunx convex env set VAPID_SUBJECT "mailto:wpeneipil2025@alu.uct.cl"
```

## Suscripciones vencidas y entregas con resultado incierto (`delivery_uncertain`)

- **Suscripciones vencidas (`404` / `410`):** cuando el servicio push del navegador informa que un endpoint caducó o fue revocado, el despacho elimina automáticamente esa fila de `pushSubscriptions`.
- **Resultado incierto (`delivery_uncertain`):** al reservar una entrega push se retira `nextAttemptAt` y se deja provisionalmente en `delivery_uncertain` antes de invocar al servicio push; si se pierde la respuesta o se interrumpe la acción antes de guardar `sent`, el barrido automático no vuelve a enviarla para evitar avisos duplicados. El usuario conserva el aviso en su bandeja y recibe además el correo institucional.

## Comprobar en un navegador real

1. Con las variables VAPID cargadas en el deployment de desarrollo y las funciones subidas (`bunx convex dev --once`), levanta la Web local (`bun run --cwd apps/web dev`) y ábrela en un navegador con soporte Web Push (Chrome o Edge en `http://localhost:5173`).
2. Registra `/push-sw.js`, acepta el permiso de notificaciones, suscribe el navegador con `VAPID_PUBLIC_KEY` y guarda la suscripción mediante `presentation/notifications:activatePushSubscription`.
3. Dispara un aviso para ese usuario (por ejemplo, `presentation/requests:createRequest`) y verifica que aparezca la notificación del sistema con texto genérico (sin mencionar CERETI ni datos sensibles) y que `notificationDeliveries` registre `channel: "push"`, `status: "sent"`, `attempts: 1`.
