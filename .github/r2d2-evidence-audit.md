# Corrección de evidencia y cobertura de R2D2

Este cambio amplía la auditoría de CI/R2D2 dentro de la rama y PR de TI4-50 por instrucción del responsable. No modifica código funcional de Web, Mobile ni Backend. La PR está abierta para revisión por instrucción del responsable; no se modifica `main` ni el ruleset.

## Reproducción y causas

La primera ejecución de `bun test ./.github/ai-review-renames.test.ts` produjo tres fallos: un renombre puro generaba `@@ -0,0 +0,0 @@`, su contexto histórico propio estaba vacío y una revisión de 13/13 bloques con evidencia pendiente decía que faltaban bloques. La suite actual conserva esos casos como regresiones verdes.

| Área           | Causa                                                                       | Corrección                                                                             |
| -------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Renombres      | Un cambio de ruta se representaba como hunk vacío; publicación exigía línea | Rutas anterior/nueva explícitas y hallazgo general verificado sin coordenada inventada |
| Histórico      | El contexto propio buscaba la ruta nueva en la base                         | Lectura desde `previous_filename` y `basePath` explícito                               |
| Disponibilidad | Una lectura nula se marcaba completa                                        | Estados y motivos separados; solo contenido presente puede ser completo                |
| Patch          | Se recuperaba después de seleccionar declaraciones                          | Recuperación desde Git antes de contexto, con ambas rutas del renombre                 |
| Contexto       | Un extracto insuficiente solo admitía limitación textual                    | Solicitudes estructuradas, recuperación acotada y nuevo análisis del bloque            |
| Reporte        | La falta de evidencia se presentaba como nota cero y falta de bloques       | Revisión incompleta sin nota de calidad; progreso y causa concreta en el check         |
| Operación      | Repetir formalmente dependía de un cambio o de un hilo inline               | `workflow_dispatch` con número de PR y captura de head/base actuales                   |
| Protección     | Documentación informativa anterior al ruleset vigente                       | Documentación de cinco checks obligatorios, identidad de App y recuperación            |

Dos revisiones independientes detectaron además una pérdida de solicitudes tras recuperación parcial y un hallazgo general que permanecía vigente después de un resultado completo sin defectos. Se reprodujeron con tests que fallaron antes de corregirlos. Ahora `evidenceRecovery` comunica los resultados ausentes o no disponibles; las solicitudes permanecen pendientes hasta recuperarse o recibir una resolución explícita y justificada. Las reviews generales anteriores se marcan como sustituidas y conservan su evidencia histórica. Ambas revisiones confirmaron el cierre de estos hallazgos.

Estos son errores del reviewer y de documentación operativa. No son fallos externos de runners ni defectos del producto. No se alteran tests del producto para compensar infraestructura externa.

## Archivos

- Contexto y recuperación: `.github/ai-review-context.cjs`, `.github/ai-review-evidence.cjs`, `.github/ai-review-confidence.cjs`.
- Plan, evaluación y publicación: `.github/ai-review-chunks.cjs`, `.github/ai-review-verification.cjs`, `.github/ai-review-score.cjs`, `.github/ai-review-target.cjs`, `.github/ai-review-memory.cjs`, `.github/ai-review-presentation.cjs`.
- Operación y demostraciones: `.github/workflows/ai-code-review.yml`, `.github/ai-review-scale.cjs`, `.github/ai-review-demo.cjs`.
- Regresiones: `.github/ai-review-renames.test.ts`, `.github/ai-review-flow.test.ts`, `.github/ai-review-score.test.ts`.
- Documentación: `.github/ci-audit.md`, este informe, `docs/ci-protections.md`, `docs/ci-r2d2-app.md`, `docs/agents/pull-requests.md`, `docs/ci-build-validation.md`, `docs/vercel-deployment.md`.

## Validación local

| Comando                                      | Resultado                                              |
| -------------------------------------------- | ------------------------------------------------------ |
| `bun install --frozen-lockfile`              | Sin cambios en dependencias ni lockfile                |
| `bun run lint`                               | Verde                                                  |
| `bun run format:check`                       | Verde, después de `bun run format`                     |
| `bun test ./.github/ci-publication.test.ts`  | 22 pruebas verdes                                      |
| `bun test ./.github/ai-review-score.test.ts` | 156 pruebas verdes, incluye suites nuevas              |
| `bun run test:convex`                        | 351 pruebas verdes                                     |
| `bun run test:web`                           | 87 pruebas verdes                                      |
| `bun run --cwd apps/mobile typecheck`        | Verde                                                  |
| `bun run --cwd apps/mobile test`             | 154 pruebas verdes                                     |
| `bun run --cwd apps/web build`               | Verde                                                  |
| `node .github/ai-review-scale.cjs`           | Protocolo y escala comprobados sin publicación externa |
| `node .github/ai-review-demo.cjs`            | Demostración local comprobada sin proveedor real       |

Las regresiones nuevas cubren renombres puros y con modificaciones, imports rotos por mudanza, histórico en ruta anterior, patches ausentes y recortados, función modificada lejos del inicio del archivo, disponibilidad, recuperación de un contrato omitido, recuperación parcial, solicitud imposible o demasiado grande, límites y resolución explícita de evidencia. También cubren publicación general verificada, sustitución de una review anterior, mensajes coherentes con 13/13 bloques y despacho formal que rechaza una base distinta. Las regresiones anteriores de PR #73 permanecen verdes: dos defectos reales conservados y falso positivo de sort/IDs refutado.

CSpell se ejecuta sobre los archivos modificados. Bun 1.4 no resuelve el binario al combinar los dos paquetes de `bunx`; se usa `npx --yes --package cspell --package @cspell/dict-es-es cspell lint --no-progress` con la misma configuración y diccionario. No se agregan palabras comunes al diccionario para ocultar errores.

## Impacto, riesgos y límites

Las comprobaciones centrales se ejecutan sobre módulos reales y Git temporal: un resultado obsoleto no publica success, una solicitud pendiente no desaparece silenciosamente y un hallazgo general anterior deja de presentarse como vigente al sustituirse. La conservación del protocolo permite mantener el nombre required `R2D2 Review 5/5`; la calidad de una revisión incompleta se representa separadamente mediante `qualityScore: null`.

La recuperación puede consumir llamadas adicionales, dentro del presupuesto global. Cada bloque admite tres rondas y hasta ocho solicitudes por ronda, 4.000 caracteres por fragmento con imports y 16.000 recuperados por ronda. El plan admite hasta 48 bloques y 80 llamadas, con límites menores para los intentos de un usuario. Los bloques que recuperan evidencia durante su evaluación no se guardan en la memoria incremental para evitar reutilizar conclusiones sin comprobar dependencias recién solicitadas. Una declaración mayor que el presupuesto conserva evidencia pendiente. La comprobación de causalidad sigue dependiendo del modelo; las pruebas controladas no prueban el comportamiento de una inferencia real.

El trigger manual debe estar integrado en la rama predeterminada antes de que GitHub lo habilite. La PR está abierta y recibe revisiones reales mediante sus eventos habituales. La ejecución descrita abajo quedó incompleta; los resultados posteriores se registran en la PR, sin certificar anticipadamente 5/5. Los runs reales de CI se enlazan en la descripción de la PR. Consulta [protecciones de CI](../docs/ci-protections.md) para ejecutar de nuevo una revisión formal sin hallazgos inline.

La consulta del ruleset confirmó cinco checks obligatorios y asociación del status R2D2 con la App `5164648`. No se modifican bypass, métodos de merge, resolución obligatoria de hilos, secretos, modelo, categorías de defectos ni los cuatro nombres de CI. La recuperación de un bloqueo del reviewer se documenta; no se fabrica un status aprobado ni se integra la PR automáticamente.

## Comprobación real después de abrir la PR

La [ejecución 37471196981](https://github.com/FernandoValdes01/ceretime/actions/runs/37471196981), sobre `58b241e`, procesó 19/19 bloques y realizó 25 llamadas, pero dejó once solicitudes pendientes y un incidente de verificación. El resultado correcto fue «revisión incompleta», sin nota de calidad ni hallazgos publicados. Los cuatro checks de CI y Preview pasaron en la [ejecución 37471197014](https://github.com/FernandoValdes01/ceretime/actions/runs/37471197014). Esto demuestra un bloqueo del reviewer; no demuestra un defecto del producto ni una caída del runner.

La recuperación exigía símbolos exactos, por lo que solicitudes como `reviewPlan (cuerpo completo)` o varios identificadores juntos no se resolvían. Además, una declaración de 19.648 caracteres superaba el fragmento de 4.000; el presupuesto de recuperación contaba coordenadas internas que no se enviaban al modelo y no reservaba espacio en bloques llenos. Una reproducción local mostró 45.834 caracteres iniciales y 63.589 después de recuperar evidencia, frente al límite de 48.000. Las capturas XML del emulador se trataban como código y provocaban solicitudes ajenas a su propósito.

La corrección admite identificadores compuestos y descripciones anteriores, conserva pendientes los símbolos realmente ausentes, permite fragmentos literales de tests y pasos de workflows y pagina declaraciones con cursores validados. Se mantienen tres rondas de recuperación, hasta ocho solicitudes, fragmentos de 4.000 y 16.000 caracteres recuperados por ronda. Se eliminan coordenadas internas y extractos idénticos de ambas solicitudes de inferencia; los contratos del bloque se comparten también al verificar citas. Si la evidencia no cabe, solo se divide el bloque afectado, conservando todas las líneas y coordenadas del diff, los contratos propios y recuperados que corresponden a cada cambio, los resultados en memoria y la ubicación de hilos anteriores. Los límites quedan en 48 bloques y 80 llamadas; si no cabe una partición segura, el resultado sigue incompleto.

La evidencia recuperada se asocia al cambio que la pidió mediante `forPath` y no se repite en cambios independientes. Si un bloque no cumple el protocolo después de los intentos acotados, queda incompleto y se procesan los bloques restantes.

Los XML y patches bajo `docs/evidence/` se excluyen como artefactos de demostración. Los manifiestos Android, recursos XML y contratos XML siguen siendo revisables. Los errores de presupuesto, JSON, tiempo y HTTP del proveedor se distinguen en el diagnóstico; no se atribuye automáticamente un fallo local al proveedor. No se modifican la escala, las severidades, la verificación independiente ni los casos positivos de PR #73 para obtener una aprobación.

Las nuevas regresiones cubren símbolos compuestos, símbolos ausentes, declaraciones paginadas, continuidad del cursor, presupuesto del payload público, un bloque lleno que debe dividirse sin perder coordenadas ni resultados en memoria, hilos trasladados a su fragmento, pasos de workflow y diagnóstico de límites locales. La nueva ejecución real debe comprobarse sobre el siguiente commit; este informe no certifica anticipadamente 5/5.

## Segunda ejecución y precisión del verificador

La [ejecución 37528210216](https://github.com/FernandoValdes01/ceretime/actions/runs/37528210216), sobre `fcf95c1`, demostró la partición real de un bloque y procesó 18/18 bloques en 26 llamadas. No hubo incidentes del proveedor. La [CI 37528210378](https://github.com/FernandoValdes01/ceretime/actions/runs/37528210378) pasó los cuatro checks y Preview; Production se omitió. La revisión siguió incompleta por limitaciones libres que no pedían recuperación y publicó tres observaciones incorrectas, confirmadas como falsos positivos por dos revisiones independientes.

El proveedor sí expone `loading`, `ready` y `saving`; rechazar una actualización con `false` mientras está ocupado es el contrato documentado en `apps/mobile/docs/ti4-50.md`. El presupuesto mide texto transmitido: reservar los imports al calcular la capacidad y contabilizarlos después no es doble conteo. Finalmente, `headComplete` describe el archivo entero, mientras `declarationComplete` y el cursor describen la recuperación solicitada. Las regresiones ejecutables comprueban la suma exacta del payload y una declaración completa con archivo parcial y cero solicitudes pendientes. No se cambia este comportamiento correcto para satisfacer las observaciones del modelo.

La confirmación de un defecto exige ahora `expectedContract`, con ruta, cita exacta y regla vigente, e `impactTrace`, con el efecto observable posterior. La verificación debe comprobar el consumidor del valor y distinguir una obligación existente de una preferencia nueva. El protocolo firmado cambia de versión y los candidatos sin ese fundamento no se publican. Las dos detecciones verdaderas y la refutación del sort de PR #73 siguen comprobándose con el verificador real y fuentes citadas.

Las limitaciones libres se resuelven únicamente contra nombres únicos del AST y rutas existentes en el vecindario de imports y contexto del módulo, acotado a 32 archivos. Se transforman en solicitudes estructuradas sin otra llamada al proveedor; las limitaciones originales permanecen hasta que el siguiente análisis las resuelva, incluida cualquier ambigüedad o contexto externo. La recuperación de un archivo entero también se pagina y respeta los mismos límites. No se eleva el score, se omiten categorías ni se cambia el comportamiento funcional de Mobile.

La [ejecución 37532897184](https://github.com/FernandoValdes01/ceretime/actions/runs/37532897184), sobre `d89843d`, terminó correctamente como workflow, pero el status requerido quedó incompleto en 12/25 bloques tras 32 llamadas. La causa fue una configuración duplicada: `.github/ai-review-chunks.cjs` se amplió a 64, mientras `.pr-reviewer.yml` seguía limitando el plan a 32. Este run no produjo hallazgos y no certifica 5/5. El siguiente commit alinea ambos límites y agrega una prueba que verifica la configuración efectiva; aún debe validarse con una nueva ejecución real.

La [ejecución 37533917208](https://github.com/FernandoValdes01/ceretime/actions/runs/37533917208), sobre `ccbb4a4`, usó el límite configurado de 64 llamadas y procesó 23/26 bloques antes de agotarlo. CI y Preview pasaron; R2D2 omitió el score y mantuvo el status requerido en fallo por cobertura incompleta. Las solicitudes pendientes concentradas en la propiedad `complete` no correspondían a declaraciones independientes, por lo que la recuperación por AST no devolvía el helper que la define o consume. La siguiente regresión verifica recuperación hasta esos helpers y la nueva ejecución aún debe validar la cobertura completa.

La [ejecución 37535070344](https://github.com/FernandoValdes01/ceretime/actions/runs/37535070344), sobre `437fb88`, procesó los 26 bloques en 52 llamadas y CI/Preview pasaron. R2D2 terminó incompleta porque `validateAssessment` imponía que las limitaciones no superaran la cantidad de archivos del bloque; las respuestas con varias limitaciones concretas sobre un archivo se clasificaban como protocolo inválido. El límite ahora es 16 por bloque, sin omitir entradas, y hay una regresión para comprobar múltiples limitaciones en un único archivo y el tope absoluto.

La [ejecución 37536153197](https://github.com/FernandoValdes01/ceretime/actions/runs/37536153197), sobre `0c3ba3c`, procesó 30/30 bloques en 44 llamadas y CI/Preview pasaron. La cobertura quedó incompleta porque solicitudes legítimas aún necesitaban tests específicos y páginas adicionales de `reviewPlan`/`publishFindings`; algunos bloques tampoco podían dividirse al alcanzar el límite de 32. El ajuste siguiente aumenta el límite a 48 bloques/80 llamadas, permite tres rondas y recupera el test más pequeño que coincide con solicitudes descriptivas como `describe/update/read-failed`. La siguiente ejecución real debe confirmar si ese contexto acotado resuelve lo pendiente.

La [ejecución 37537894214](https://github.com/FernandoValdes01/ceretime/actions/runs/37537894214), sobre `469af4a`, procesó 26/26 bloques en 51 llamadas y los cuatro checks requeridos de CI más Preview pasaron. R2D2 siguió incompleta porque acumuló contexto de varias rondas y lo copió íntegro a cada partición del diff; algunos bloques superaron 48.000 caracteres y no admitieron una división segura. La partición ahora distribuye contratos recuperados entre bloques que caben, conserva todas las coordenadas y mantiene visibles las solicitudes pendientes para que cada bloque vuelva a pedir la evidencia que necesite. La siguiente ejecución real debe confirmar que se alcanza cobertura completa.

La [ejecución 37539543166](https://github.com/FernandoValdes01/ceretime/actions/runs/37539543166), sobre `5ea2274`, revisó 25/25 bloques en 33 llamadas sin incidentes de presupuesto; CI y Preview pasaron. Un bloque fue rechazado dos veces porque el modelo emitió una identidad con separadores fuera del alfabeto estable permitido. La validación ahora normaliza mayúsculas, tildes y separadores de `issue_key` a un slug estable y sigue rechazando un valor vacío; una regresión cubre ambos casos. La siguiente ejecución real confirmará la publicación final.
