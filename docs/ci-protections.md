# Protecciones de CI para `main`

El workflow `.github/workflows/ci.yml` conserva las validaciones y los despliegues. R2D2 ejecuta la revisión formal en `.github/workflows/ai-code-review.yml`. Ambos flujos son obligatorios para integrar en `main`, junto con la aprobación humana.

## Configuración efectiva de GitHub

La consulta de `GET /repos/FernandoValdes01/ceretime/rulesets/22399696` del 06/10/2026 confirmó que `protectedmain` exige estos checks, con `strict_required_status_checks_policy: true`:

- `Lint y formato`
- `Validación Mobile`
- `Validación Web`
- `Verificación Backend`
- `R2D2 Review 5/5`

Los cuatro primeros pertenecen a GitHub Actions. R2D2 está asociado a la GitHub App con `integration_id: 5164648`. Deben estar configurados `R2D2_APP_ID` y `R2D2_APP_PRIVATE_KEY`, según [el registro de la App](ci-r2d2-app.md). Un status con el mismo nombre publicado por GitHub Actions mediante el token alternativo no satisface ese requisito de identidad. El reviewer nunca aprueba ni integra una PR. La aprobación humana sigue siendo obligatoria.

El ruleset exige una aprobación, descarta aprobaciones antiguas y exige aprobación del último push. Conserva dos actores de bypass y permite squash y merge. `required_review_thread_resolution` permanece desactivado. Conviene activarlo desde Settings → Rules → Rulesets → protectedmain → Require a pull request before merging → Require conversation resolution before merging, una vez acordado cómo resolver cada hilo. No se cambió ninguna regla mediante API. Para exigir exclusivamente Squash and Merge, configura también los métodos permitidos en el ruleset y en Settings → General → Pull Requests.

## Activación y vigencia

La revisión se activa en PR internas con cualquier base mediante `opened`, `reopened`, `synchronize`, `ready_for_review` y `edited` cuando cambia la base. Draft y forks se omiten. Un cambio de título o descripción no cancela una revisión en curso ni consume una nueva revisión. La concurrency identifica la PR; ejecuciones automáticas y manuales de la misma PR se sustituyen.

El checkout utiliza el SHA head capturado, con historial y `persist-credentials: false`. El diff es `baseSHA...headSHA`, contra el merge-base de la base inmediata. La revisión formal compara head, SHA y nombre de base en preparación, análisis y antes de publicar. También valida la discusión y la coherencia de informe y outputs. Una ejecución obsoleta no puede publicar un resultado vigente. Cambiar la base requiere una nueva revisión aunque el head conserve su SHA.

## Renombres, contexto y evidencia

Antes de seleccionar contexto, los patches omitidos o recortados se reconstruyen desde Git incluyendo ambas rutas de los renombres. Un renombre puro lleva `change.oldPath`, `change.newPath` y `contentChanged: false`, sin hunk inventado. El contenido histórico propio se recupera desde la ruta anterior. También se incluyen consumidores que todavía importen esa ruta.

El contexto conserva imports, funciones modificadas, declaraciones relacionadas, contratos y tests dentro del presupuesto. `baseComplete` y `headComplete` solo son verdaderos cuando existe contenido completo. Los estados distinguen `present`, `absent`, `not_yet_created`, `deleted` y `unavailable`; los motivos explican la lectura. Un archivo que no existía o que fue eliminado no equivale a un fallo de lectura. Un extracto de contenido existente tiene estado `present` y completitud falsa.

El modelo solicita evidencia mediante `evidenceRequests`, con `path`, `symbol` o `fragment`, `side` y `reason`. El motor valida rutas relativas, recupera declaraciones desde los commits capturados y vuelve a analizar únicamente el bloque afectado. Cada bloque admite dos rondas de recuperación, hasta ocho solicitudes y 16.000 caracteres recuperados por ronda; cada fragmento con imports ocupa como máximo 4.000 caracteres. Las declaraciones largas se paginan con cursores validados; si el contexto recuperado no cabe, se divide únicamente el bloque afectado conservando sus líneas, contratos y hallazgos anteriores. El bloque y la llamada siguen respetando sus presupuestos globales. Una declaración que supera el presupuesto total, está ausente o no está disponible mantiene su solicitud pendiente y comunica el motivo en `evidenceRecovery`. El modelo puede indicar expresamente que no es necesaria mediante `evidenceResolutions` con estado `not_needed` y justificación concreta; omitir la solicitud en otra respuesta no la resuelve. No se ejecutan comandos propuestos por el modelo.

Las evaluaciones que necesitaron recuperación no se guardan en la memoria incremental: evita reutilizarlas sin comprobar las nuevas dependencias. La memoria restante conserva firma, vencimiento de 24 horas e identidad de política, implementación y contexto. Los archivos omitidos y el contenido recuperado no se presentan como código auditado indiscriminadamente.

Cada candidato pasa por una comprobación independiente de entrada, resultado actual, resultado esperado, traza y evidencia contraria. Las citas deben existir en el contexto vigente. Las hipótesis y preferencias se omiten. El contexto y esta comprobación mejoran la precisión, pero siguen usando un modelo y no garantizan detectar todos los defectos. Las regresiones de PR #73 conservan los defectos de colisión de agregados y cancelación con agregados, y refutan que ordenar bloques cambie IDs ya asignados de forma estable.

Los hallazgos inline exigen una línea del diff. Un renombre sin líneas modificadas puede producir un hallazgo general de la PR, con la misma comprobación de evidencia y el SHA exacto. No se inventa una coordenada para publicar el defecto. Los hallazgos generales aparecen en una review `COMMENT`; una ejecución nueva sobre el mismo SHA actualiza esa review. Una comprobación completa sin hallazgos generales marca la review anterior como sustituida y conserva su evidencia como histórica. Los hilos inline conservan sus raíces y respuestas humanas.

## Resultados y bloqueos

| Resultado completo | Score | Risk |
| --- | --- | --- |
| Sin hallazgos | 5/5 | low |
| Defecto funcional menor | 4/5 | low |
| Advertencia funcional | 3/5 | medium |
| Problema importante | 2/5 | high |
| Problema crítico | 1/5 | high |

Si falta evidencia, respuesta válida o cobertura, el comentario muestra "Revisión incompleta" y no asigna una nota de calidad. `qualityScore` es nulo; el cero del resumen interno permanece exclusivamente por compatibilidad del protocolo. El status sigue en failure y bloquea la integración. Procesar 13/13 bloques no demuestra una revisión completa si alguno carece de evidencia: el check indica el progreso y la causa concreta. El informe separa defectos verificados, solicitudes de evidencia, limitaciones, problemas del plan e incidentes del revisor. Un incidente del proveedor no demuestra un defecto del código.

El status `R2D2 Review 5/5` solo pasa con revisión vigente, cobertura completa, cero hallazgos y riesgo low. Una PR sin unidades elegibles no consulta al proveedor y dice "Sin cambios que requieran análisis con IA". Los cuatro checks de CI y la aprobación humana siguen verificándose independientemente.

## Resolver una revisión incompleta

Consulta primero el informe y los logs. Si falta un contrato, revisa la solicitud estructurada y sus límites. Si falló OpenRouter o el runner, espera su recuperación o corrige la configuración del reviewer. No modifiques código funcional válido para resolver un incidente del revisor ni fabriques un status aprobado.

En Actions → AI Code Review → Run workflow, usa `main` como referencia del workflow e introduce el número de la PR interna abierta y lista para revisión. El flujo consulta sus head y base actuales y conserva las comprobaciones de vigencia. Funciona aunque no haya hallazgos inline ni un hilo de conversación. Alternativa desde CLI:

```sh
gh workflow run ai-code-review.yml --ref main -f pr_number=85
```

[GitHub exige que el trigger esté en la rama predeterminada](https://docs.github.com/actions/managing-workflow-runs/manually-running-a-workflow). Este mecanismo estará disponible tras integrar el workflow. Una PR Draft sigue omitiéndose, incluso en ejecución manual. Re-run jobs repite el objetivo original y no sustituye una ejecución formal nueva si cambiaron head o base. El workflow manual captura el objetivo vigente sin commits artificiales.

Desactivar AI Code Review no elimina su required check y puede mantener el bloqueo. Un bypass excepcional exige la decisión del actor autorizado y la evidencia del incidente; no se cambia el ruleset ni se integra desde el reviewer. Después, comprueba las validaciones de `main` y cualquier resultado pendiente. Si una corrección del reviewer debe integrarse por estar bloqueada por el propio reviewer, documenta esa dependencia y el mecanismo de recuperación acordado; no publiques resultados simulados.

## Pruebas y límites

`bun test ./.github/ai-review-score.test.ts` incluye las suites de contexto, renombres, comprobación, memoria, conversación y flujo formal. Usa Git temporal y respuestas controladas; no constituye una inferencia real de OpenRouter. La PR permanece Draft durante esta entrega, por lo que la revisión remota se omite. Registra por separado los runs reales de CI y los tests locales del reviewer.

La configuración `.pr-reviewer.yml` fija presupuestos de bloques, entrada, salida y llamadas. La recuperación y la comprobación de candidatos comparten el límite global de llamadas. Los reintentos HTTP 429 respetan la espera del proveedor y los límites de tiempo. Los costos dependen del uso real de OpenRouter; el informe muestra tokens medidos cuando están disponibles y no inventa una factura. La conversación no modifica el status formal.
