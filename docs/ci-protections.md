# Protecciones de CI para `main`

El workflow `.github/workflows/ci.yml` conserva los cuatro jobs de validación y los despliegues de TI4-38. AI Review corre en un workflow independiente y es informativo.

## Configuración efectiva de GitHub

La consulta de `GET /repos/FernandoValdes01/ceretime/rulesets/22399696` y `GET /repos/FernandoValdes01/ceretime/rules/branches/main` del 01/10/2026 confirmó que `protectedmain` está activo y exige únicamente los cuatro resultados de GitHub Actions, con `strict_required_status_checks_policy: true`.

- `Lint y formato`
- `Validación Mobile`
- `Validación Web`
- `Verificación Backend`

Ni el antiguo status de Greptile ni `AI Review 5/5` son required checks. No agregues AI Review al ruleset: una evaluación del modelo nunca autoriza merge. La configuración consultada exige una aprobación humana, descarta aprobaciones obsoletas y requiere aprobación del último push. Permite squash y merge, y tiene dos usuarios con bypass configurado; este registro describe lo consultado, no modifica esas reglas. Antes de integrar, vuelve a comprobar las reglas efectivas y la revisión humana TI4.

## Reviewer, acceso y credenciales

`.github/workflows/ai-code-review.yml` usa [AI Code Reviewer](https://github.com/mara-werils/ai-code-reviewer/tree/2f6bb8c98d791de5b84dc425eacadcf0a7052fcf), fijado al SHA `2f6bb8c98d791de5b84dc425eacadcf0a7052fcf`, con Groq y `openai/gpt-oss-120b`. Se ejecuta para PR internas hacia `main` en `opened`, `reopened`, `synchronize` y `ready_for_review`. Draft omite el job y no consume una review. Las PR de forks también lo omiten porque no reciben el secret ni permisos de escritura; necesitan revisión humana y una validación autorizada desde una rama interna.

El workflow concede solo `contents: read` para descargar el código, `pull-requests: write` para comentarios inline y reviews de tipo `COMMENT`, y `statuses: write` para el status del commit. No aprueba PR, no integra código ni escribe en el producto. El checkout usa el SHA head del evento y `persist-credentials: false`. No se instala una dependencia de runtime en Web, Mobile ni Backend.

`GROQ_API_KEY` debe existir como secret de GitHub Actions y se entrega solo a `ai_review` y al step de evaluación de confianza. Nunca incluyas su valor en código, documentos, comentarios o logs. La presencia del nombre del secret no demuestra que la clave sea válida: eso requiere una llamada real al proveedor.

El código de la PR y su descripción salen del repositorio hacia la API de Groq. La Action se ejecuta en un contenedor del runner y usa GitHub para leer el diff y publicar resultados. Esta versión recibe el diff bruto antes de recortarlo: `ignore_paths` limita los archivos que pueden recibir comentarios y las instrucciones piden ignorarlos, pero no es una garantía de que su contenido no se envíe al proveedor. No uses estos patrones para proteger secretos. El proyecto sigue trabajando con datos ficticios según el [ADR del prototipo](adr/0001-prototipo-sin-datos-reales.md). La configuración no activa RAG ni una base de datos del repositorio.

## Confidence Score, riesgo y hallazgos

El modelo evalúa solo el cambio recibido con la rúbrica de `.pr-reviewer.yml`, entregada como archivo e input explícito. El adaptador `.github/ai-review-score.cjs` valida y normaliza sus outputs, sin calcular una nota aleatoria ni copiar el reviewer. Se solicita una única línea física, necesaria por el escritor de outputs de esta versión de la Action:

```text
Confidence Score: 5/5; Risk: low; Reviewed commit: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa; Hallazgos: 0; Resumen: No se detectan problemas relevantes.
```

La review publicada muestra cada campo por separado, el SHA completo, el modelo, el resumen y el enlace al run. Los hallazgos concretos quedan inline cuando tienen una línea válida en el diff. El máximo solicitado es cinco y cero hallazgos es válido. `Hallazgos` cuenta los comentarios aceptados por el motor, no sustituye la comprobación de que GitHub haya publicado cada comentario inline.

La prueba real mostró que esta combinación puede devolver solo prosa aun recibiendo el contrato. Cuando ocurre, `.github/ai-review-confidence.cjs` pide al mismo modelo de Groq una evaluación JSON separada del diff y las observaciones. Exige un entero 0–5 y una explicación, y conserva el riesgo, conteo y SHA de la ejecución. No convierte prosa en una nota inventada. El diff temporal se guarda bajo `.git/` únicamente en el runner. Un fallo o JSON inválido de esta evaluación publica failure y 0/5. La review normalizada conserva también el resumen original de la Action.

| Score | Interpretación |
| --- | --- |
| 5/5 | No se detectan problemas relevantes. Para dar success debe haber cero hallazgos y riesgo low. |
| 4/5 | El cambio parece correcto, con observaciones menores o riesgo bajo. |
| 3/5 | Hay problemas relevantes que deberían revisarse antes de integrar. |
| 2/5 | Hay problemas importantes de corrección, integración, arquitectura o seguridad. |
| 1/5 | Hay problemas graves que probablemente rompan comportamiento o controles importantes. |
| 0/5 | La revisión no es válida por fallo técnico, ausencia, formato inválido o cobertura incompleta. |

`Risk: low|medium|high` es la evaluación de riesgo del modelo y debe coincidir con el output `risk_level`. Si no existe un output de riesgo válido, el informe usa `high` como señal conservadora de incertidumbre, no como un hallazgo de seguridad. Los valores duplicados, scores fuera de rango, SHA inválidos y cantidades o riesgos inconsistentes se rechazan. La rúbrica es estable, pero una inferencia del modelo puede variar y no prueba que el código esté libre de errores.

Confidence Score NO significa autorización para hacer merge. CI y la revisión humana correspondiente siguen siendo obligatorias; el reviewer siempre publica `COMMENT`, nunca `APPROVE`.

## Status y asociación al SHA

El contexto estable del commit status es `AI Review 5/5`. Se publica exclusivamente sobre `github.event.pull_request.head.sha`, nunca sobre `github.sha` del merge temporal. La review normalizada también queda asociada mediante `commit_id` cuando se crea; si la Action ya publicó una review inline sobre ese SHA, se actualiza su cuerpo conservando los comentarios.

| Condición | Estado y resultado |
| --- | --- |
| Review válida, actual y 5/5 | `success`: `AI Review 5/5 para el commit actual.` |
| Review válida y score inferior a 5 | `failure` informativo, con el score y solicitud de revisión humana. |
| Sin review o sin output summary | `failure`: `Falta la revisión de IA para este commit.` |
| SHA revisado distinto del actual | `failure`: `La revisión de IA no corresponde al commit actual.` |
| Fallo de Groq o de la Action | `failure`: `La revisión automática no pudo completarse.` |
| Salida inválida o cobertura incompleta | `failure`, score normalizado 0/5 y causa explícita. |

Cada ejecución vigente publica primero un failure por review ausente. Un commit nuevo tiene su propio status y no hereda el success del anterior; puede faltar el status durante la espera del runner y esa ausencia nunca demuestra una review válida. La concurrency por número de PR cancela ejecuciones anteriores. El adaptador vuelve a leer el head antes de publicar la review y justo antes del status final. Una ejecución antigua solo puede escribir en su SHA original, incluso si el head cambia después de la consulta: jamás marca como válido un commit nuevo. Las ejecuciones canceladas no publican el resultado final.

No se reutilizan outputs de otra ejecución, comentarios humanos ni notas del bot anterior. El resumen original que la Action publica como comentario puede coexistir con la review normalizada; esta última y el status del SHA son la evidencia verificable. Si falla la publicación en GitHub, revisa el job y sus logs: la falta de status o un failure inicial no equivale a éxito.

## Costos y límites

La configuración está prevista para el plan gratuito de Groq, sin contratar un servicio pagado. No se ha consultado la facturación de la cuenta. Su [documentación de límites](https://console.groq.com/docs/rate-limits) consultada para esta configuración indica para `openai/gpt-oss-120b` 30 solicitudes/minuto, 1.000/día, 8.000 tokens/minuto y 200.000/día. Los límites se comparten por organización y cualquiera puede agotarse primero. Confirma los valores efectivos en la consola de la cuenta: pueden cambiar. Un exceso produce HTTP 429; la Action aplica reintentos limitados, pero no garantiza superar una cuota agotada.

La versión fijada [recorta el diff](https://github.com/mara-werils/ai-code-reviewer/blob/2f6bb8c98d791de5b84dc425eacadcf0a7052fcf/src/review/engine.py) a `max_diff_size` y limita archivos. Se mantienen 10.000 caracteres y 50 archivos para reducir consumo. El adaptador detecta cuando el diff bruto supera esos límites y fuerza 0/5 aunque el modelo devuelva 5/5: una evaluación parcial no obtiene success. El reviewer todavía puede publicar observaciones de la porción recibida. Una PR que modifica únicamente archivos ignorados no obtiene una nota válida del modelo y también queda en failure. Estos límites son conservadores; no garantizan que todas las solicitudes entren en la cuota de tokens.

El output `cost_usd` es una estimación de la Action y no incluye la evaluación separada de confianza. Su tabla de precios no incluye este modelo y usa un valor de respaldo; no representa el consumo facturado ni certifica gratuidad. Una review puede consumir dos solicitudes, además de los reintentos limitados. La evaluación de confianza usa hasta tres intentos, timeout de 30 segundos por solicitud y espera limitada por `retry-after` entre errores transitorios. Comprueba uso, límites y plan en Groq antes de considerar cambios de capacidad. Esta integración no cambia planes ni permite compras automáticas.

## Validación real y reversión

Usa la misma PR de TI4-45. Mientras sea Draft, verifica que el job se omita. Después de los checks locales, pásala a Ready for review para la prueba autorizada. La asignación del reviewer humano quedó aplazada por instrucción del responsable de esta tarea; esto no elimina la aprobación humana necesaria antes de integrar. Comprueba un run real: Groq responde, se usa `openai/gpt-oss-120b`, aparecen resumen y campos estructurados, los hallazgos existentes quedan inline y el SHA del informe, `commit_id` y el status coinciden con el head actual. Si el diff excede cobertura, el resultado correcto es 0/5 con limitación explícita, no success. Un failure por proveedor no demuestra una review real válida.

Envía después un commit necesario para la migración en esa misma PR: comprueba que la review previa no valide el SHA nuevo, que aparezca el failure inicial y que la nueva ejecución publique evidencia para el head nuevo. Conserva enlaces a ambos runs y verifica que CI funcione independientemente. La ejecución anterior no debe producir success para el SHA nuevo. Hasta obtener esta evidencia y CI verde, TI4-45 no está terminada.

Si Groq falla, una persona con acceso puede desactivar temporalmente solo `AI Code Review` en Actions. Conserva los cuatro checks required y la revisión humana; informa la ausencia de IA sin fabricar una nota. Para reactivar, habilita el workflow y envía un commit o vuelve a Ready for review desde Draft. Para retirar cambios de código, revierte el commit de integración mediante otra PR revisada, sin modificar directamente `main`.

La [PR #74](https://github.com/FernandoValdes01/ceretime/pull/74) comprobó el job omitido en [Draft](https://github.com/FernandoValdes01/ceretime/actions/runs/36946199638), respuestas reales de Groq y comentarios inline en las primeras ejecuciones. El [run 36948163361](https://github.com/FernandoValdes01/ceretime/actions/runs/36948163361) publicó los campos normalizados sobre `fd04410a5c68a4e3cf2dbed4ce109c05e9845657`, con `commit_id` coincidente y failure informativo 0/5 por cobertura incompleta. Ese SHA recibió primero failure por ausencia de review y después el resultado de su propia ejecución. Los [cuatro jobs de CI](https://github.com/FernandoValdes01/ceretime/actions/runs/36948163433) pasaron independientemente. Esta evidencia confirma llamadas reales y publicación; no certifica una revisión completa de esta PR extensa ni un success remoto 5/5. El caso 5/5 y las carreras entre ejecuciones están cubiertos por tests locales.

Tras comprobar la alternativa se retiraron `.github/workflows/greptile-score.yml` y `.github/greptile-score.test.ts` en esta misma PR. Su configuración se puede recuperar del padre de la migración si el equipo decide restaurarla; no añadas un gate de IA requerido para revertir. El workflow antiguo de la rama predeterminada todavía puede reaccionar a eventos hasta integrar la migración. Desinstalar o deshabilitar la GitHub App anterior requiere comprobar permisos y suscripción desde Settings → Integrations. Retirar sus archivos del repositorio no desinstala esa App. La consulta de instalaciones con la credencial disponible respondió 403; ese paso administrativo queda pendiente para una persona con acceso.
