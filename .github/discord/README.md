# Notificaciones de HoloNet

HoloNet publica en Discord las solicitudes de revisión individual, las revisiones humanas que solicitan cambios y las PR fusionadas a `main`. El workflow independiente usa Bun y la API REST de Discord; no requiere un proceso permanente ni webhooks. CI ejecuta las pruebas de interpretación, publicación y recuperación sin credenciales.

## Activación

1. Integra la PR en `main`. La publicación siempre ejecuta `.github/discord/notify.ts` desde esa rama; no se puede probar el envío de esta implementación antes de integrarla.
2. Verifica en Settings → Secrets and variables → Actions el secret existente `DISCORD_BOT_TOKEN` y la variable `DISCORD_CHANNEL_ID`, con valor `1559310191185629215`. El token solo se obtiene desde ese secret; no se necesitan credenciales nuevas.
3. Verifica que HoloNet pueda ver el canal, enviar mensajes y leer su historial. La lectura permite reconocer los avisos ya enviados y evitar duplicados. Para avisar merges necesita además el permiso de mencionar `@everyone`. Las preferencias personales de Discord pueden silenciar notificaciones.
4. Comprueba que Actions esté habilitado y que las políticas del repositorio permitan `pull_request_target`.

El archivo `users.json` mantiene los nueve pares GitHub → Discord. Conserva los IDs como cadenas, porque exceden la precisión segura de los números de JavaScript. La búsqueda ignora mayúsculas. Los usuarios desconocidos aparecen con su nombre de GitHub, sin mención, y producen una advertencia en el log. También se muestran los nombres de GitHub de quienes solicitan revisiones, cambios o realizan el merge.

## Pruebas y simulación

Desde la raíz:

```bash
bun test ./.github/discord
GITHUB_EVENT_NAME=pull_request_target GITHUB_EVENT_PATH=.github/discord/review-requested.json bun .github/discord/notify.ts --dry-run
```

La simulación imprime el mensaje y `allowed_mentions`, sin consultar Discord ni requerir token o canal. El ejemplo usa una URL de GitHub con el número de PR 92; para otra PR cambia el número y el enlace juntos. Para probar otros casos, guarda un payload real de GitHub en un JSON local y utiliza `GITHUB_EVENT_NAME=pull_request_review` o `pull_request_target`, según corresponda. No guardes credenciales en el payload.

Para una solicitud real después de integrar el workflow, abre una PR, selecciona `Juanfra272` en Reviewers y comprueba la ejecución de **Notificaciones HoloNet** en Actions. El mensaje debe mencionar únicamente a Juanfra en el canal configurado y enlazar la PR. Si ya estaba solicitado, retira la solicitud y vuelve a solicitarla: es un nuevo evento y publicará otro mensaje.

GitHub emite un evento por cada revisor individual solicitado; pedir varios revisores genera un mensaje por destinatario, sin mencionar nuevamente a los otros revisores en ese mensaje. Las solicitudes a equipos sin revisor individual se omiten. Las revisiones aprobadas, los comentarios y los cambios solicitados por cuentas de tipo `Bot`, nombres terminados en `[bot]` o Greptile se omiten.

## Recuperación de avisos

El aviso inmediato de cambios solicitados usa `pull_request_review`, cuyo contexto depende del merge de la PR. Un sondeo independiente desde `main` recupera los tres tipos de aviso, aunque falte el evento inmediato, haya conflictos o un workflow pendiente sea reemplazado por otro. Se programa cada cinco minutos; GitHub puede retrasar o descartar ejecuciones durante períodos de carga, por lo que esa frecuencia no garantiza un plazo de entrega. **Run workflow** en Actions ejecuta la misma recuperación manualmente.

El inicio está fijado en `recovery-start.json`: `2026-10-14T03:00:00Z`, que corresponde a las 00:00 del 14 de octubre de 2026 en Chile. No se notifican eventos anteriores y el inicio no avanza después de siete días. La recuperación consulta todas las PR abiertas y las cerradas desde ese inicio, incluyendo forks, con `pull-requests: read`. Recorre todas las páginas de su historial de GitHub y no depende de `updated_at` ni de ejecutar código de la PR.

Cada solicitud individual de revisión, solicitud humana de cambios y merge a `main` tiene una identidad propia. Una aprobación posterior conserva el hecho de que se pidieron cambios; si la revisión fue descartada, se recupera su estado original desde el evento de descarte. Retirar y volver a solicitar revisión a la misma persona genera dos acciones distintas. Los comentarios, aprobaciones, solicitudes a equipos, revisiones de bots y cierres sin merge no generan avisos.

Todos los envíos comparten el mismo grupo de concurrencia. El evento inmediato y el sondeo comprueban el historial del propio bot y usan el mismo identificador como `nonce`. Los mensajes nuevos incluyen el enlace del evento concreto; los de otras personas no cuentan como avisos enviados. Durante la transición se reconoce el formato antiguo asignando cada mensaje a una sola acción compatible, la más cercana anterior a su fecha. El formato antiguo no permite distinguir con certeza solicitudes idénticas realizadas casi al mismo tiempo; los identificadores nuevos eliminan esa ambigüedad.

Si Discord acepta un mensaje y se pierde la respuesta, el siguiente sondeo lo reconoce por su enlace. Si falla un envío, se siguen intentando los restantes, la ejecución falla y el próximo sondeo recupera lo pendiente. Los errores al leer GitHub o Discord detienen el envío antes de publicar a ciegas. Si se borró el último mensaje, la comprobación usa un mensaje existente del listado, cuando lo hay, para verificar el permiso de lectura.

El control de duplicados exige conservar los mensajes de HoloNet y el permiso de leer el historial. Si se borra un aviso, el sondeo puede volver a publicarlo. Eliminar todos los mensajes y conservar un ID de último mensaje inexistente puede impedir verificar la lectura; la ejecución falla antes de enviar. Los avisos antiguos se recuperan como hechos del historial; su enlace permite consultar el estado actual de la PR.

Para verificar la consulta real a GitHub sin publicar ni necesitar credenciales de Discord, configura `GITHUB_TOKEN` en el entorno y ejecuta:

```bash
GITHUB_EVENT_NAME=workflow_dispatch bun .github/discord/notify.ts --dry-run
```

Esta simulación lista los eventos candidatos y sus fechas. No consulta el historial de Discord, así que no afirma cuáles siguen sin enviarse. Las pruebas reproducen la solicitud real de la #111 y comprueban recuperación de los tres avisos, concurrencia mediante eventos omitidos, recorrido de todas las páginas, solicitudes repetidas, aprobaciones y descartes posteriores, reconocimiento del formato antiguo, permisos, borrado del último mensaje, fallos parciales y respuestas perdidas.

## Seguridad y límites

- `pull_request_target` escucha solo `review_requested` y `closed`. Ejecuta código confiable de `main`, nunca el head o el commit de merge de la PR. Los cierres sin merge y los merges a otras ramas se omiten. No se escucha `push`.
- `pull_request_review` escucha solo `submitted`. También descarga exclusivamente `main`. Los avisos inmediatos de cambios desde forks se omiten porque GitHub no proporciona el secret en esos eventos; el sondeo desde `main` sí los recupera. Las solicitudes de revisión y los merges usan `pull_request_target` y pueden notificarse para forks si las políticas de Actions lo permiten.
- El archivo de workflow de `pull_request_review` se evalúa en el contexto de merge de la PR. El checkout explícito de `main` protege la lógica ejecutada por esta integración; la capacidad de modificar workflows dentro del repositorio debe permanecer limitada a colaboradores confiables y sujeta a revisión. No habilites el envío de secrets a workflows de forks para superar la limitación anterior.
- El token se entrega solo al paso de publicación; no se instalan dependencias ni se ejecutan scripts de la PR. `GITHUB_TOKEN` tiene únicamente `contents: read` y `pull-requests: read`, y checkout no conserva sus credenciales. Los nombres se escapan y los enlaces se validan contra las URLs de PR de este repositorio. `allowed_mentions` autoriza solo al destinatario en revisiones y solo `everyone` en merges; las menciones a roles quedan bloqueadas.
- Discord recibe un `nonce` estable basado en la revisión, solicitud individual o PR fusionada, y `enforce_nonce: true`. Eso evita duplicados de reintentos durante los pocos minutos en que Discord recuerda el identificador. El historial permite reconocer envíos anteriores después de ese plazo. El trigger manual `workflow_dispatch` recupera los tres tipos de aviso.
- Los HTTP 429 respetan `retry_after`, con un máximo de 60 segundos por espera. Los HTTP 5xx usan esperas de uno y dos segundos. Hay como máximo tres intentos y cada petición tiene un timeout de 15 segundos. Las credenciales ausentes, los HTTP 4xx, los límites persistentes y los errores de red fallan con un diagnóstico sin token ni cuerpo de respuesta. Un error de red puede ocurrir después de que Discord acepte el mensaje; comprueba el canal antes de reintentar.
- GitHub normalmente no inicia otros workflows cuando el evento se genera mediante `GITHUB_TOKEN`. Las solicitudes reales para probar esta integración deben realizarse desde la interfaz de GitHub o con una cuenta humana.

Referencias: [eventos de GitHub Actions](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows), [seguridad de pull_request_target](https://docs.github.com/en/actions/reference/security/securely-using-pull_request_target), [mensajes y menciones de Discord](https://docs.discord.com/developers/resources/message) y [límites de frecuencia](https://docs.discord.com/developers/topics/rate-limits).
