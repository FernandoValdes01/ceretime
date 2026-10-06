# Corrección de evidencia y cobertura de R2D2

Este cambio amplía la auditoría de CI/R2D2 dentro de la rama y PR de TI4-50 por instrucción del responsable. No modifica código funcional de Web, Mobile ni Backend. La PR permanece Draft; no se modifica `main` ni el ruleset.

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
| `bun test ./.github/ai-review-score.test.ts` | 137 pruebas verdes, incluye suites nuevas              |
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

La recuperación puede consumir llamadas adicionales, dentro del presupuesto global. Cada bloque admite dos rondas y hasta ocho solicitudes por ronda, 4.000 caracteres por declaración con imports y 16.000 recuperados por ronda. Los bloques recuperados no se guardan en la memoria incremental para evitar reutilizar conclusiones sin comprobar dependencias recién solicitadas. Una declaración mayor que el presupuesto conserva evidencia pendiente. La comprobación de causalidad sigue dependiendo del modelo; las pruebas controladas no prueban el comportamiento de una inferencia real.

El trigger manual debe estar integrado en la rama predeterminada antes de que GitHub lo habilite. La PR sigue Draft y la revisión remota de IA se omite; no se consume OpenRouter para esta entrega ni se afirma haber obtenido una revisión real 5/5. Los runs reales de CI se enlazan en la descripción de la PR. Consulta [protecciones de CI](../docs/ci-protections.md) para ejecutar de nuevo una revisión formal sin hallazgos inline.

La consulta del ruleset confirmó cinco checks obligatorios y asociación del status R2D2 con la App `5164648`. No se modifican bypass, métodos de merge, resolución obligatoria de hilos, secretos, modelo, categorías de defectos ni los cuatro nombres de CI. La recuperación de un bloqueo del reviewer se documenta; no se fabrica un status aprobado ni se integra la PR automáticamente.
