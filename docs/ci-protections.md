# Protecciones de CI para `main`

El workflow `.github/workflows/ci.yml` conserva los cuatro jobs de validación y los despliegues de TI4-38. AI Review corre en un workflow independiente y es informativo.

## Configuración efectiva de GitHub

La consulta de `GET /repos/FernandoValdes01/ceretime/rulesets/22399696` y `GET /repos/FernandoValdes01/ceretime/rules/branches/main` del 01/10/2026 confirmó que `protectedmain` está activo y exige únicamente los cuatro resultados de GitHub Actions, con `strict_required_status_checks_policy: true`.

- `Lint y formato`
- `Validación Mobile`
- `Validación Web`
- `Verificación Backend`

Ni el antiguo status de Greptile ni `R2D2 Review 5/5` son required checks. No agregues AI Review al ruleset: una evaluación del modelo nunca autoriza merge. La configuración consultada exige una aprobación humana, descarta aprobaciones obsoletas y requiere aprobación del último push. Permite squash y merge, y tiene dos usuarios con bypass configurado; este registro describe lo consultado, no modifica esas reglas. Antes de integrar, vuelve a comprobar las reglas efectivas y la revisión humana TI4.

## Reviewer, acceso y credenciales

`.github/workflows/ai-code-review.yml` usa [AI Code Reviewer](https://github.com/mara-werils/ai-code-reviewer/tree/2f6bb8c98d791de5b84dc425eacadcf0a7052fcf), fijado al SHA `2f6bb8c98d791de5b84dc425eacadcf0a7052fcf`, con Groq y `openai/gpt-oss-120b`. Se ejecuta para PR internas hacia `main` en `opened`, `reopened`, `synchronize` y `ready_for_review`. Draft omite el job y no consume una review. Las PR de forks también lo omiten porque no reciben el secret ni permisos de escritura; necesitan revisión humana y una validación autorizada desde una rama interna.

El workflow concede solo `contents: read` para descargar el código, `pull-requests: write` para comentarios inline y reviews de tipo `COMMENT`, y `statuses: write` para el status del commit. No aprueba PR, no integra código ni escribe en el producto. El checkout usa el SHA head del evento y `persist-credentials: false`. No se instala una dependencia de runtime en Web, Mobile ni Backend.

`GROQ_API_KEY` debe existir como secret de GitHub Actions y se entrega solo a `ai_review` y al step de evaluación de confianza. Nunca incluyas su valor en código, documentos, comentarios o logs. La presencia del nombre del secret no demuestra que la clave sea válida: eso requiere una llamada real al proveedor. La identidad opcional de R2D2 usa `R2D2_APP_ID` y `R2D2_APP_PRIVATE_KEY`; los [pasos de registro](ci-r2d2-app.md) explican sus permisos mínimos y su configuración sin versionar claves.

La App instalada `R2D2-reviewer` ya publicó una [review real como `r2d2-reviewer[bot]`](https://github.com/FernandoValdes01/ceretime/pull/74#pullrequestreview-5393646415), con su avatar y los statuses del SHA probado creados por esa identidad. El [intento 2 de validación](https://github.com/FernandoValdes01/ceretime/actions/runs/36950538385/attempts/2) completó también la revocación del token. Las publicaciones históricas mantienen el autor original de GitHub Actions.

El código elegible de la PR sale del repositorio hacia la API de Groq. El adaptador filtra `ignore_paths` antes de construir los bloques. Solo usa la Action fijada cuando todo el cambio elegible cabe en una llamada, no hay archivos ignorados y no se excede su límite de archivos; en el resto de los casos usa la ruta por bloques sin ejecutar además la Action. Esto evita reenviar el diff parcial o contenido ignorado. Los patrones son exclusiones de revisión, no un reemplazo de la prevención de secretos. El proyecto sigue trabajando con datos ficticios según el [ADR del prototipo](adr/0001-prototipo-sin-datos-reales.md). La configuración no activa RAG ni una base de datos del repositorio.

## Confidence Score, riesgo y hallazgos

El modelo evalúa solo el cambio recibido con la rúbrica de `.pr-reviewer.yml`, entregada como archivo e input explícito. El adaptador `.github/ai-review-score.cjs` valida y normaliza sus outputs, sin calcular una nota aleatoria ni copiar el reviewer. Se solicita una única línea física, necesaria por el escritor de outputs de esta versión de la Action:

```text
Confidence Score: 5/5; Risk: low; Reviewed commit: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa; Hallazgos: 0; Resumen: No se detectan problemas relevantes.
```

El comentario de resumen muestra el nombre R2D2 y utiliza el avatar de la App, el score destacado como N/5, una tabla de riesgo, hallazgos y estado, el título del commit enlazado, el resumen y el SHA completo en los datos de ejecución plegados. La presentación no usa negritas y elimina el pie publicitario del upstream. Los hallazgos concretos quedan inline cuando tienen una línea válida en el diff; su prosa se ordena sin modificar código ni bloques de sugerencias. El máximo solicitado es cinco y cero hallazgos es válido. `Hallazgos` cuenta los comentarios aceptados por el motor, no sustituye la comprobación de que GitHub haya publicado cada comentario inline.

La prueba real mostró que esta combinación puede devolver solo prosa aun recibiendo el contrato. Cuando ocurre, `.github/ai-review-confidence.cjs` pide al mismo modelo de Groq una evaluación JSON separada del diff y las observaciones. Exige un entero 0–5 y una explicación, y conserva el riesgo, conteo y SHA de la ejecución. No convierte prosa en una nota inventada. El diff temporal se guarda bajo `.git/` únicamente en el runner. Un fallo o JSON inválido de esta evaluación publica failure y 0/5. La review normalizada muestra una sola explicación; los outputs originales siguen disponibles en el run.

| Score | Interpretación |
| --- | --- |
| 5/5 | No se detectan problemas relevantes. Para dar success debe haber cero hallazgos y riesgo low. |
| 4/5 | El cambio parece correcto, con observaciones menores o riesgo bajo. |
| 3/5 | Hay problemas relevantes que deberían revisarse antes de integrar. |
| 2/5 | Hay problemas importantes de corrección, integración, arquitectura o seguridad. |
| 1/5 | Hay problemas graves que probablemente rompan comportamiento o controles importantes. |
| 0/5 | La revisión no es válida por fallo técnico, ausencia, formato inválido o cobertura incompleta. |

`Risk: low|medium|high` es la evaluación de riesgo del modelo y debe coincidir con el output `risk_level`. Si no existe un output de riesgo válido, el informe usa `high` como señal conservadora de incertidumbre, no como un hallazgo de seguridad. Los valores duplicados, scores fuera de rango, SHA inválidos y cantidades o riesgos inconsistentes se rechazan. La rúbrica es estable, pero una inferencia del modelo puede variar y no prueba que el código esté libre de errores.

Confidence Score NO significa autorización para hacer merge. CI y la revisión humana correspondiente siguen siendo obligatorias; los hallazgos inline usan reviews `COMMENT` y el resumen se publica como comentario de PR, nunca como `APPROVE`.

## Status y asociación al SHA

El contexto estable del commit status es `R2D2 Review 5/5`. Se publica exclusivamente sobre `github.event.pull_request.head.sha`, nunca sobre `github.sha` del merge temporal. El resumen vive en un único comentario de PR identificado por un marcador estable y la identidad que lo publica. Se crea una vez y se actualiza en los siguientes commits o reintentos. Muestra el título del commit obtenido de GitHub, enlazado a su SHA; el SHA completo permanece en los detalles. Los hallazgos inline conservan el `commit_id` de la review original. El comentario de PR no tiene `commit_id`: su asociación se verifica con el SHA explícito y el status del commit.

| Condición | Estado y resultado |
| --- | --- |
| Review válida, actual y 5/5 | `success`: `R2D2 Review 5/5 para el commit actual.` |
| Review válida y score inferior a 5 | `failure` informativo, con el score y solicitud de revisión humana. |
| Sin review o sin output summary | `failure`: `Falta la revisión de IA para este commit.` |
| SHA revisado distinto del actual | `failure`: `La revisión de IA no corresponde al commit actual.` |
| Fallo de Groq o de la Action | `failure`: `La revisión automática no pudo completarse.` |
| Salida inválida o cobertura incompleta | `failure`, score normalizado 0/5 y causa explícita. |

Cada ejecución vigente publica primero un failure por review ausente. Un commit nuevo tiene su propio status y no hereda el success del anterior; puede faltar el status durante la espera del runner y esa ausencia nunca demuestra una review válida. La concurrency por número de PR cancela ejecuciones anteriores. El adaptador vuelve a leer el head antes de publicar la review y justo antes del status final. Una ejecución antigua solo puede escribir en su SHA original, incluso si el head cambia después de la consulta: jamás marca como válido un commit nuevo. Las ejecuciones canceladas no publican el resultado final.

No se reutilizan outputs de otra ejecución, comentarios humanos ni notas del bot anterior. Después de actualizar el comentario de resumen y antes de su status final, el adaptador retira los resúmenes publicitarios redundantes publicados por esa misma identidad. Conserva comentarios humanos y otros resultados de Actions. Los cuerpos anteriores de reviews de IA se ocultan sin eliminar hallazgos inline ni asociaciones al commit; cada identidad modifica solo sus propias publicaciones. El comentario único y el status del SHA son la evidencia verificable. Si falla la publicación en GitHub, revisa el job y sus logs: la falta de status o un failure inicial no equivale a éxito.

## Costos y límites

La configuración está prevista para el plan gratuito de Groq, sin contratar un servicio pagado. No se ha consultado la facturación de la cuenta. Su [documentación de límites](https://console.groq.com/docs/rate-limits) consultada para esta configuración indica para `openai/gpt-oss-120b` 30 solicitudes/minuto, 1.000/día, 8.000 tokens/minuto y 200.000/día. Los límites se comparten por organización y cualquiera puede agotarse primero. Confirma los valores efectivos en la consola de la cuenta: pueden cambiar. Un exceso produce HTTP 429; la Action aplica reintentos limitados, pero no garantiza superar una cuota agotada.

La versión fijada [recorta el diff](https://github.com/mara-werils/ai-code-reviewer/blob/2f6bb8c98d791de5b84dc425eacadcf0a7052fcf/src/review/engine.py) a `max_diff_size`. Ese valor de 10.000 caracteres se conserva como tamaño de la ruta de una llamada, no como límite de cobertura de la PR. `.github/ai-review-chunks.cjs` agrupa archivos pequeños, conserva hunks completos cuando caben y divide los hunks grandes por líneas, manteniendo coordenadas explícitas LEFT/RIGHT. El plan usa todos los archivos elegibles paginados; verifica los conteos de líneas de cada patch y recupera patches omitidos o truncados mediante Git local sobre los SHA exactos de base y head. Un archivo binario no ignorado o una línea individual que no cabe deja una causa técnica explícita de cobertura incompleta.

Cada bloque recibe el SHA y el mismo contexto relevante de CERETIME, seguridad, arquitectura y criterios de revisión, sin repetir el diff completo ni la descripción de la PR. La agregación es local: elimina repeticiones por archivo/línea/lado o por texto equivalente del mismo archivo, conserva los cinco hallazgos más importantes y toma el menor score de los bloques y el mayor riesgo. La gravedad de cualquier hallazgo puede reducir el score y elevar el riesgo, incluso si queda fuera de los cinco publicados: critical limita el score a 1, important a 2, warning a 3 y suggestion a 4. Solo hay un resumen final R2D2; las respuestas de bloques no se publican como comentarios resumen.

La configuración `chunking` de `.pr-reviewer.yml` limita cada bloque a unos 10.000 caracteres de patch y metadatos, cada request completa a 18.000 caracteres, el plan a 28 bloques y la ejecución a 32 llamadas, incluidos reintentos. Cada llamada permite hasta 1.200 tokens de salida, usa razonamiento low y tiene timeout de 45 segundos. Hay una pausa mínima de 65 segundos entre llamadas para reducir picos dentro de la ventana de tokens por minuto. Para errores normales o respuestas inválidas se mantienen dos intentos; ante HTTP 429 puede haber hasta tres intentos por bloque, siempre dentro del máximo total de 32 llamadas. La espera respeta `retry-after` y la pausa progresiva. Si falta esa cabecera, utiliza la espera indicada por el error y, como respaldo, el tiempo de recuperación del tipo de límite afectado. Las cabeceras de otras cuotas no anulan un `retry-after` válido. Una respuesta correcta con pocos tokens disponibles puede aumentar la pausa siguiente. Se permiten como máximo tres minutos por recuperación y diez minutos acumulados de espera adaptativa, configurados mediante `maxRateLimitWaitMs`. Si Groq pide esperar más, la revisión queda incompleta con una causa de cuota explícita; no vuelve a consultar antes de la recuperación indicada ni oculta un fallo de cuota como respuesta inválida. La ejecución de Actions tiene un límite de 55 minutos. Estos presupuestos se pueden ajustar hacia abajo; aumentar los topes requiere cambiar también los máximos del módulo y revisar el costo. No son una garantía de precio ni de disponibilidad dentro de la cuota compartida de Groq.

`coverage = complete` requiere respuestas válidas de todos los bloques elegibles. El tamaño total por sí solo no fuerza 0/5. Patches no recuperables, respuestas inválidas tras reintentar, llamadas fallidas, cambio del head o agotamiento del presupuesto producen incomplete y 0/5 con la causa y los bloques procesados. Una PR con solo archivos ignorados no consume llamadas y queda sin evaluación válida; no se inventa una nota. La ruta corta conserva la Action fijada y su normalización; su número de llamadas depende además del resumen automático del upstream.

El output `cost_usd` es una estimación de la Action y no incluye la evaluación separada de confianza. Su tabla de precios no incluye este modelo y usa un valor de respaldo; no representa el consumo facturado ni certifica gratuidad. En la ruta corta, la Action puede consumir dos solicitudes, además de los reintentos limitados. Su evaluación de confianza separada usa hasta tres intentos, timeout de 30 segundos por solicitud y espera limitada por `retry-after` entre errores transitorios. La ruta por bloques usa exclusivamente los presupuestos descritos arriba y no ejecuta esa revisión parcial adicional. Comprueba uso, límites y plan en Groq antes de considerar cambios de capacidad. Esta integración no cambia planes ni permite compras automáticas.

## Validación real y reversión

Usa la misma PR de TI4-45. Mientras sea Draft, verifica que el job se omita. Después de los checks locales, pásala a Ready for review para la prueba autorizada. La asignación del reviewer humano quedó aplazada por instrucción del responsable de esta tarea; esto no elimina la aprobación humana necesaria antes de integrar. Comprueba un run real: Groq responde, se usa `openai/gpt-oss-120b`, aparecen resumen y campos estructurados, los hallazgos existentes quedan inline y el SHA del informe, `commit_id` y el status coinciden con el head actual. Si el diff excede cobertura, el resultado correcto es 0/5 con limitación explícita, no success. Un failure por proveedor no demuestra una review real válida.

Envía después un commit necesario para la migración en esa misma PR: comprueba que la review previa no valide el SHA nuevo, que aparezca el failure inicial y que la nueva ejecución publique evidencia para el head nuevo. Conserva enlaces a ambos runs y verifica que CI funcione independientemente. La ejecución anterior no debe producir success para el SHA nuevo. Hasta obtener esta evidencia y CI verde, TI4-45 no está terminada.

Si Groq falla, una persona con acceso puede desactivar temporalmente solo `AI Code Review` en Actions. Conserva los cuatro checks required y la revisión humana; informa la ausencia de IA sin fabricar una nota. Para reactivar, habilita el workflow y envía un commit o vuelve a Ready for review desde Draft. Para retirar cambios de código, revierte el commit de integración mediante otra PR revisada, sin modificar directamente `main`.

La [PR #74](https://github.com/FernandoValdes01/ceretime/pull/74) comprobó el job omitido en [Draft](https://github.com/FernandoValdes01/ceretime/actions/runs/36946199638), respuestas reales de Groq y comentarios inline en las primeras ejecuciones. El [run 36948163361](https://github.com/FernandoValdes01/ceretime/actions/runs/36948163361) publicó los campos normalizados sobre `fd04410a5c68a4e3cf2dbed4ce109c05e9845657`, con `commit_id` coincidente y failure informativo 0/5 por cobertura incompleta. Ese SHA recibió primero failure por ausencia de review y después el resultado de su propia ejecución. Los [cuatro jobs de CI](https://github.com/FernandoValdes01/ceretime/actions/runs/36948163433) pasaron independientemente. Esta evidencia confirma llamadas reales y publicación; no certifica una revisión completa de esta PR extensa ni un success remoto 5/5. El caso 5/5 y las carreras entre ejecuciones están cubiertos por tests locales.

Tras comprobar la alternativa se retiraron `.github/workflows/greptile-score.yml` y `.github/greptile-score.test.ts` en esta misma PR. También se desactivó mediante API el workflow remoto `Sincronizar check de Greptile`, comprobando `disabled_manually`, para impedir nuevas publicaciones mientras la migración espera integración. Su configuración se puede recuperar del padre de la migración si el equipo decide restaurarla; no añadas un gate de IA requerido para revertir. Desinstalar o deshabilitar la GitHub App anterior requiere comprobar permisos y suscripción desde Settings → Integrations. Retirar sus archivos del repositorio no desinstala esa App. La consulta de instalaciones con la credencial disponible respondió 403; ese paso administrativo queda pendiente para una persona con acceso.

## Prueba visible de la escala

Cada ejecución incluye una tabla de casos controlados de 0/5 a 5/5 en el resumen de GitHub Actions. Usa el mismo evaluador del status y comprueba que solo 5/5 produce success. No llama a Groq ni publica comentarios o statuses simulados. Permite verificar la escala aunque la PR real permanezca en 0/5 por cobertura incompleta. El comentario de la review omite el recordatorio de aprobación humana; las protecciones y la revisión humana siguen vigentes.

El comentario distingue la justificación de confianza de las observaciones originales. Muestra qué cambiar y por qué, los hallazgos agregados, los bloques procesados y la cantidad de llamadas. Ante cobertura incompleta informa la causa concreta. El 0/5 técnico no califica negativamente el código ni convierte cero hallazgos parciales en una certificación. El chunking está preparado y probado localmente; una ejecución real de esta ruta contra Groq queda pendiente de publicar el cambio autorizado y probarlo en GitHub. Las evidencias históricas anteriores validan la integración previa, no esta nueva ruta.

Cobertura completa significa que todos los patches elegibles recibieron una respuesta válida, no que el modelo detectará todos los problemas. Los bloques conservan el contexto de arquitectura, pero no contienen simultáneamente todo el cambio; las incompatibilidades entre bloques requieren especial atención humana. La revisión humana TI4 y los cuatro jobs de CI siguen siendo obligatorios e independientes del score.

El agrupamiento aprovecha también el espacio libre de bloques anteriores: ubica cada archivo o hunk en el bloque más lleno que todavía pueda contenerlo. Esto evita agotar los 28 bloques por fragmentación, sin aumentar el tamaño por llamada ni el presupuesto de Groq. Conserva todos los contenidos y coordenadas; una PR que realmente exceda el presupuesto sigue declarando cobertura incompleta.

Una PR de 25 bloques requiere aproximadamente 26 minutos solo de pausas mínimas, además del tiempo de respuesta y las esperas de recuperación. El ritmo más lento mantiene todos los archivos y bloques elegibles; no omite partes del diff para evitar HTTP 429. Los límites diarios y el consumo de otras PR o conversaciones de la misma organización pueden impedir completar una revisión incluso con estas pausas. En ese caso espera a que se libere la cuota y ejecuta nuevamente la revisión sobre el SHA actual.

El diagnóstico de HTTP 429 extrae únicamente el tipo de límite (TPM, TPD, RPM o RPD), límite, cantidad utilizada, cantidad solicitada y espera necesaria. Estos datos aparecen en los logs y en la causa de cobertura incompleta. No imprime el cuerpo de error del proveedor, identificadores de organización, credenciales ni contenido del código. Distingue cuotas diarias de límites por minuto y solicitudes que por sí solas excedan el máximo por minuto; estas últimas requieren dividir el bloque, no aumentar la espera.
