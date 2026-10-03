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

`.github/workflows/ai-code-review.yml` ejecuta un único motor local con Groq y `openai/gpt-oss-120b`, configurados en `.github/ai-review-provider.cjs`. Se activa en PR internas hacia `main` mediante `opened`, `reopened`, `synchronize` y `ready_for_review`. Omite Draft y forks. El checkout utiliza el SHA head del evento, descarga el historial y conserva `persist-credentials: false`.

Los permisos siguen siendo `contents: read`, `pull-requests: write` y `statuses: write`. El motor publica comentarios y reviews `COMMENT`, nunca aprobaciones, commits o merges. `GROQ_API_KEY` se entrega únicamente al step que consulta al modelo; la conversación tiene su propio workflow. La identidad opcional usa `R2D2_APP_ID` y `R2D2_APP_PRIVATE_KEY`, según [el registro de la App](ci-r2d2-app.md). No se cambian secrets, planes de pago ni los cuatro checks requeridos.

## Alcance y selección

El alcance es el diff de la PR contra el merge-base de los SHA exactos de `main` y HEAD. La API de archivos se pagina y los patches ausentes o truncados de archivos elegibles se recuperan con `git diff baseSHA...headSHA`. El contenido de `main` se considera válido: un defecto preexistente solo se reporta si el cambio lo empeora o depende directamente de él, con una explicación causal concreta. Los archivos sin cambios sirven como contexto dirigido, no como objetivos de una auditoría adicional.

`.github/ai-review-selection.cjs` excluye binarios, lockfiles, generado, artefactos y documentación ajena a contratos. `CONTEXT.md`, `DESIGN.md`, los ADR y `docs/contracts/` siguen siendo revisables; las rutas se configuran en `selection.contract_docs`. Una imagen no impide revisar el código de la misma PR. JSON y YAML se comparan por su estructura y valores cuando el parser los admite; cambios de orden o formato sin cambio funcional se omiten. `package.json` se limita a nombre, versión, dependencias, scripts, exports, resolución, herramientas, build y publicación. Las configuraciones desconocidas o inválidas se revisan con instrucciones específicas.

En JS/TS sencillo se omiten cambios exclusivos de sangría y espacios al final de línea. Los saltos de línea, literales, templates y lenguajes sensibles a espacios se conservan. Otros cambios de formato pueden seguir requiriendo análisis cuando no es posible demostrar equivalencia; el modelo tiene prohibido comentarlos como hallazgos.

## Revisión incremental y conversación

Los hunks conservan unidades independientes y se agrupan para aprovechar cada llamada. La memoria firmada permite reutilizar unidades intactas entre commits de la misma PR. La identidad de política incluye proveedor, modelo, base, instrucciones, propósito de la PR, límites e implementación. Cada unidad incluye el patch, el archivo completo mediante su huella, el entorno funcional, dependencias y consumidores relacionados, y la discusión relevante. Un cambio en un helper del mismo archivo, una dependencia, un contrato, la explicación humana o `main` invalida las conclusiones afectadas. La invalidación es conservadora: un cambio dentro de un archivo puede exigir revisar otra vez varios de sus hunks aunque solo uno haya cambiado.

La cobertura sigue abarcando todo `main...HEAD`, combinando unidades vigentes y nuevas evaluaciones. En `synchronize` se envían solamente unidades pendientes, sin reenviar las recuperadas aunque hayan cambiado de bloque. Las declaraciones y referencias directamente relacionadas se envían en fragmentos acotados de base y head. Las huellas completas permanecen locales y no consumen contexto del modelo.

Las respuestas humanas y las decisiones formales se recuperan desde los hilos de GitHub. Cada hallazgo anterior se asigna a una sola comprobación con el hallazgo original, la explicación humana, el fragmento original y el cambio relacionado. Se actualizan las coordenadas de líneas y las rutas tras un cambio de nombre; un fallo de recuperación se distingue de una eliminación comprobada. Si la corrección revierte todo el hunk y el archivo sale del diff, una unidad de seguimiento comprueba solo ese hallazgo, sin volver a auditar `main`.

El modelo debe mantener, retirar o resolver cada hallazgo, o indicar que falta contexto. Mantener exige evidencia anclada al diff vigente; resolver no se acepta con evidencia incompleta. La publicación conserva la raíz y las respuestas humanas, registra el resultado formal en el mismo hilo y evita duplicarlo al reintentar. La conversación inmediata no cambia el status: su decisión se verifica en la siguiente revisión formal. Las coordenadas originales del comentario permanecen asociadas a su commit; la actualización muestra el SHA y la ubicación comprobados.

## Confidence Score, riesgo y publicación

El modelo devuelve únicamente hallazgos estructurados y resoluciones, sin decidir la nota. Cada hallazgo exige coordenada modificada, identidad estable, cambio que causa el problema, impacto funcional y corrección. Estilo, preferencias, formato y asuntos cubiertos por CI quedan excluidos. La nota y el riesgo se calculan localmente con todos los hallazgos aceptados; el resumen publica hasta cinco, ordenados por gravedad.

| Resultado | Score | Risk |
| --- | --- | --- |
| Cobertura completa, sin hallazgos | 5/5 | low |
| Defecto funcional menor | 4/5 | low |
| Advertencia funcional | 3/5 | medium |
| Problema importante | 2/5 | high |
| Problema crítico | 1/5 | high |
| Falta evidencia, cobertura o respuesta válida | 0/5 | Riesgo de los hallazgos parciales |

Una PR sin unidades elegibles no consulta al proveedor y obtiene un resultado válido que dice expresamente "Sin cambios que requieran análisis con IA". No se presenta como fallo técnico ni como análisis de los archivos omitidos. Las limitaciones técnicas no se convierten en defectos del código. Una resolución contradictoria o pendiente deja cobertura incompleta. No existe una segunda inferencia para normalizar prosa o calcular confianza.

El contexto del status permanece `R2D2 Review 5/5`. Cada ejecución vigente publica primero failure por review ausente; el resultado final se asocia exclusivamente a su head SHA. Antes de publicar se verifican head, base, discusión y coherencia entre informe y outputs. Un cambio concurrente invalida la evaluación y una ejecución antigua jamás publica success sobre otro commit. La concurrency por PR cancela ejecuciones anteriores. El resumen mantiene un único comentario; los hilos conservan su historia. Un fallo de publicación queda como failure. Ninguna nota reemplaza CI ni la aprobación humana TI4.

## Costos y límites

La configuración mantiene el perfil gratuito de Groq y su pausa de 65 segundos. No se ha cambiado la cuenta ni su facturación. Los límites efectivos deben comprobarse en la consola del proveedor.

`chunking` limita cada unidad agrupada a 12.000 caracteres de patch y contexto, cada request a 18.000 caracteres, el plan a 32 bloques y la ejecución a 32 llamadas con reintentos. La salida formal permite 2.400 tokens por llamada y el timeout es 45 segundos. Los errores normales o JSON inválido tienen dos intentos; HTTP 429 permite hasta tres. La espera respeta `retry-after`, el tipo de cuota y sus tiempos de recuperación, con un máximo de tres minutos por pausa y diez minutos de recuperación acumulada. El job tiene 55 minutos. Un bloque que exceda por sí solo la cuota exige dividir contenido; esperar no lo arregla.

La memoria vence a las 24 horas y se conserva bajo `.git/ai-review-memory` mediante `actions/cache` fijada por SHA. Las claves están separadas por repositorio, PR y política; no incluyen el head para permitir reutilización entre commits. Solo guarda evaluaciones estructuradas, coordenadas relativas, fecha y firma; no guarda patches, requests ni credenciales. Una entrada inválida, alterada o vencida provoca una nueva consulta. Un intento incompleto conserva progreso válido sin declarar cobertura completa.

El resumen muestra llamadas, unidades reutilizadas, archivos omitidos y tokens reales de entrada, salida y caché cuando el proveedor devuelve usage. La conversación registra sus propias llamadas y tokens en su run. No se inventa un costo USD ni se suman consumos históricos de unidades recuperadas. Los precios y estimaciones históricas están en [costo de reviews](ci-review-costs.md); no describen una factura actual.

## Validación real y reversión

Usa la misma PR de TI4-45. Mientras sea Draft, verifica que el job se omita. Después de los checks locales, pásala a Ready for review para la prueba autorizada. La asignación del reviewer humano quedó aplazada por instrucción del responsable de esta tarea; esto no elimina la aprobación humana necesaria antes de integrar. Comprueba un run real: Groq responde, se usa `openai/gpt-oss-120b`, aparecen resumen y campos estructurados, los hallazgos existentes quedan inline y el SHA del informe, `commit_id` y el status coinciden con el head actual. Si el diff excede cobertura, el resultado correcto es 0/5 con limitación explícita, no success. Un failure por proveedor no demuestra una review real válida.

Envía después un commit necesario para la migración en esa misma PR: comprueba que la review previa no valide el SHA nuevo, que aparezca el failure inicial y que la nueva ejecución publique evidencia para el head nuevo. Conserva enlaces a ambos runs y verifica que CI funcione independientemente. La ejecución anterior no debe producir success para el SHA nuevo. Hasta obtener esta evidencia y CI verde, TI4-45 no está terminada.

Si Groq falla, una persona con acceso puede desactivar temporalmente solo `AI Code Review` en Actions. Conserva los cuatro checks required y la revisión humana; informa la ausencia de IA sin fabricar una nota. Para reactivar, habilita el workflow y envía un commit o vuelve a Ready for review desde Draft. Para retirar cambios de código, revierte el commit de integración mediante otra PR revisada, sin modificar directamente `main`.

La [PR #74](https://github.com/FernandoValdes01/ceretime/pull/74) comprobó el job omitido en [Draft](https://github.com/FernandoValdes01/ceretime/actions/runs/36946199638), respuestas reales de Groq y comentarios inline en las primeras ejecuciones. El [run 36948163361](https://github.com/FernandoValdes01/ceretime/actions/runs/36948163361) publicó los campos normalizados sobre `fd04410a5c68a4e3cf2dbed4ce109c05e9845657`, con `commit_id` coincidente y failure informativo 0/5 por cobertura incompleta. Ese SHA recibió primero failure por ausencia de review y después el resultado de su propia ejecución. Los [cuatro jobs de CI](https://github.com/FernandoValdes01/ceretime/actions/runs/36948163433) pasaron independientemente. Esta evidencia confirma llamadas reales y publicación; no certifica una revisión completa de esta PR extensa ni un success remoto 5/5. El caso 5/5 y las carreras entre ejecuciones están cubiertos por tests locales.

Tras comprobar la alternativa se retiraron `.github/workflows/greptile-score.yml` y `.github/greptile-score.test.ts` en esta misma PR. También se desactivó mediante API el workflow remoto `Sincronizar check de Greptile`, comprobando `disabled_manually`, para impedir nuevas publicaciones mientras la migración espera integración. Su configuración se puede recuperar del padre de la migración si el equipo decide restaurarla; no añadas un gate de IA requerido para revertir. Desinstalar o deshabilitar la GitHub App anterior requiere comprobar permisos y suscripción desde Settings → Integrations. Retirar sus archivos del repositorio no desinstala esa App. La consulta de instalaciones con la credencial disponible respondió 403; ese paso administrativo queda pendiente para una persona con acceso.

## Prueba visible de la escala

Cada ejecución incluye una tabla de casos controlados de 0/5 a 5/5 en el resumen de GitHub Actions. Usa el mismo evaluador del status y comprueba que solo 5/5 produce success. No llama a Groq ni publica comentarios o statuses simulados. Permite verificar la escala aunque la PR real permanezca en 0/5 por cobertura incompleta. El comentario de la review omite el recordatorio de aprobación humana; las protecciones y la revisión humana siguen vigentes.

El resumen informa hallazgos, bloques procesados, unidades reutilizadas y llamadas. Ante cobertura incompleta indica la causa concreta: 0/5 no califica negativamente el código ni certifica las partes pendientes. Los fragmentos relacionados mejoran la revisión de contratos, pero no garantizan que el modelo detecte todas las incompatibilidades. CI y la revisión humana TI4 siguen siendo obligatorios.

La prueba local ejecuta los módulos reales con Git temporal y APIs simuladas. Cubre selección semántica, binarios, revisión sin IA, invalidación de caché, cambios de base, respuestas humanas seguidas de correcciones, ajuste de coordenadas LEFT/RIGHT, renombres y conservación de hilos. Las evidencias remotas anteriores validan la integración histórica; una ejecución real de este flujo incremental queda pendiente de publicar y probar el cambio. No se ha migrado a OpenRouter ni DeepSeek.
