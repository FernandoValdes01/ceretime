# Notificaciones de HoloNet

HoloNet publica en Discord las solicitudes de revisión individual, las revisiones humanas que solicitan cambios y las PR fusionadas a `main`. El workflow independiente usa Bun y la API REST de Discord; no requiere un proceso permanente ni webhooks. Los workflows existentes de CI no cambian.

## Activación

1. Integra la PR en `main`. La publicación siempre ejecuta `.github/discord/notify.ts` desde esa rama; no se puede probar el envío de esta implementación antes de integrarla.
2. Verifica en Settings → Secrets and variables → Actions el secret existente `DISCORD_BOT_TOKEN` y la variable `DISCORD_CHANNEL_ID`, con valor `1559310191185629215`. El token solo se obtiene desde ese secret; no se necesitan credenciales nuevas.
3. Verifica que HoloNet pueda ver el canal y enviar mensajes. Para avisar merges necesita además el permiso de mencionar `@everyone`. Las preferencias personales de Discord pueden silenciar notificaciones.
4. Comprueba que Actions esté habilitado y que las políticas del repositorio permitan `pull_request_target`.

El archivo `users.json` mantiene los nueve pares GitHub → Discord. Conserva los IDs como cadenas, porque exceden la precisión segura de los números de JavaScript. La búsqueda ignora mayúsculas. Los usuarios desconocidos aparecen con su nombre de GitHub, sin mención, y producen una advertencia en el log. También se muestran los nombres de GitHub de quienes solicitan revisiones, cambios o realizan el merge.

## Pruebas y simulación

Desde la raíz:

```bash
bun test ./.github/discord/notifications.test.ts
GITHUB_EVENT_NAME=pull_request_target GITHUB_EVENT_PATH=.github/discord/review-requested.json bun .github/discord/notify.ts --dry-run
```

La simulación imprime el mensaje y `allowed_mentions`, sin consultar Discord ni requerir token o canal. El ejemplo usa una URL de GitHub con el número de PR 92; para otra PR cambia el número y el enlace juntos. Para probar otros casos, guarda un payload real de GitHub en un JSON local y utiliza `GITHUB_EVENT_NAME=pull_request_review` o `pull_request_target`, según corresponda. No guardes credenciales en el payload.

Para una solicitud real después de integrar el workflow, abre una PR, selecciona `Juanfra272` en Reviewers y comprueba la ejecución de **Notificaciones HoloNet** en Actions. El mensaje debe mencionar únicamente a Juanfra en el canal configurado y enlazar la PR. Si ya estaba solicitado, retira la solicitud y vuelve a solicitarla: es un nuevo evento y publicará otro mensaje.

GitHub emite un evento por cada revisor individual solicitado; pedir varios revisores genera un mensaje por destinatario, sin mencionar nuevamente a los otros revisores en ese mensaje. Las solicitudes a equipos sin revisor individual se omiten. Las revisiones aprobadas, los comentarios y los cambios solicitados por cuentas de tipo `Bot`, nombres terminados en `[bot]` o Greptile se omiten.

## Seguridad y límites

- `pull_request_target` escucha solo `review_requested` y `closed`. Ejecuta código confiable de `main`, nunca el head o el commit de merge de la PR. Los cierres sin merge y los merges a otras ramas se omiten. No se escucha `push`.
- `pull_request_review` escucha solo `submitted`. También descarga exclusivamente `main`. Las solicitudes de cambios desde forks se omiten porque GitHub no proporciona el secret en esos eventos. Las solicitudes de revisión y los merges usan `pull_request_target` y pueden notificarse para forks si las políticas de Actions lo permiten.
- El archivo de workflow de `pull_request_review` se evalúa en el contexto de merge de la PR. El checkout explícito de `main` protege la lógica ejecutada por esta integración; la capacidad de modificar workflows dentro del repositorio debe permanecer limitada a colaboradores confiables y sujeta a revisión. No habilites el envío de secrets a workflows de forks para superar la limitación anterior.
- El token se entrega solo al paso de publicación; no se instalan dependencias ni se ejecutan scripts de la PR. `GITHUB_TOKEN` tiene únicamente `contents: read`, y checkout no conserva sus credenciales. Los nombres se escapan y los enlaces se validan contra las URLs de PR de este repositorio. `allowed_mentions` autoriza solo al destinatario en revisiones y solo `everyone` en merges; las menciones a roles quedan bloqueadas.
- Discord recibe un `nonce` basado en `GITHUB_RUN_ID` y `enforce_nonce: true`. Esto evita duplicados de reintentos durante los pocos minutos en que Discord recuerda el nonce; no evita duplicados de manera permanente. Volver a ejecutar manualmente un run después de ese plazo puede publicar otra vez. No hay trigger manual `workflow_dispatch`; la simulación es local. No repitas un run exitoso para probarlo.
- Los HTTP 429 respetan `retry_after`, con un máximo de 60 segundos por espera. Los HTTP 5xx usan esperas de uno y dos segundos. Hay como máximo tres intentos y cada petición tiene un timeout de 15 segundos. Las credenciales ausentes, los HTTP 4xx, los límites persistentes y los errores de red fallan con un diagnóstico sin token ni cuerpo de respuesta. Un error de red puede ocurrir después de que Discord acepte el mensaje; comprueba el canal antes de reintentar.
- GitHub normalmente no inicia otros workflows cuando el evento se genera mediante `GITHUB_TOKEN`. Las solicitudes reales para probar esta integración deben realizarse desde la interfaz de GitHub o con una cuenta humana.

Referencias: [eventos de GitHub Actions](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows), [seguridad de pull_request_target](https://docs.github.com/en/actions/reference/security/securely-using-pull_request_target), [mensajes y menciones de Discord](https://docs.discord.com/developers/resources/message) y [límites de frecuencia](https://docs.discord.com/developers/topics/rate-limits).
