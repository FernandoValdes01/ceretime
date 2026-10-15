# R2D2 y las PR apiladas

<!-- cspell:ignore talkback -->

Consulta realizada el 03/10/2026. R2D2 es el reviewer propio ejecutado por GitHub Actions; la App `r2d2-reviewer` aporta la identidad para publicar. La implementación se incorporó mediante [PR #74](https://github.com/FernandoValdes01/ceretime/pull/74). Esta revisión describe el comportamiento observado y los cambios necesarios; no modifica el reviewer.

## Qué ocurre hoy

El stack abierto contiene [PR #77](https://github.com/FernandoValdes01/ceretime/pull/77), [PR #78](https://github.com/FernandoValdes01/ceretime/pull/78) y [PR #81](https://github.com/FernandoValdes01/ceretime/pull/81). Sus bases inmediatas son `main`, `jmunoz/ti4-47-auditoria-talkback-solicitud-agenda` y `jmunoz/ti4-53-etiquetas-errores-formulario`, respectivamente. La API de #81 devuelve `stack.id: 1713219`, `stack.number: 79`, `stack.position: 3`, `stack.size: 3` y `stack.base.ref: main`: es un stack nativo registrado en GitHub.

En los stacks nativos, GitHub activa los workflows como si cada PR apuntara a la base del stack. Por ello, el filtro `pull_request.branches: [main]` permite ejecutar `AI Code Review` para las tres PR. Esta regla pertenece a la función de stacks de GitHub, actualmente en vista previa; no debe extrapolarse a ramas encadenadas sin metadatos de stack. Fuente: [referencia de stacks de GitHub](https://docs.github.com/en/pull-requests/reference/stacked-pull-requests#github-actions).

El problema está dentro del reviewer: `prepareReview` y `publishReview` descartan cualquier PR cuya `pr.base.ref` no sea `main`; `normalizeConfidence` también exige esa base en su comprobación de vigencia. En una PR superior del stack, esa propiedad identifica la rama inferior, aunque `pr.stack.base.ref` sea `main`. Un job terminado correctamente puede haber omitido la revisión por esta condición. Fuentes: [motor de preparación y publicación](https://github.com/FernandoValdes01/ceretime/blob/970fe7ce55638326343e664c1bad7b24b0df7a05/.github/ai-review-score.cjs) y [motor de confianza](https://github.com/FernandoValdes01/ceretime/blob/970fe7ce55638326343e664c1bad7b24b0df7a05/.github/ai-review-confidence.cjs).

La [ejecución 37156677136 de #81](https://github.com/FernandoValdes01/ceretime/actions/runs/37156677136) terminó con job correcto, pero su resumen indica 0/5, cero de tres bloques procesados y «El head cambió durante la revisión». La condición de vigencia también comprueba `base.ref`, por lo que ese mensaje no distingue un cambio de head de una base rechazada. El head consultado coincide con el revisado y la base actual es la rama de #78; esta evidencia no permite reconstruir con certeza cuándo se cambió la base durante la ejecución.

La conversación tiene restricciones equivalentes en el `if` del workflow y en `respondToInline`. Además, sus instrucciones presentan `main` como base válida y la recuperación de evidencia LEFT calcula el ancestro mediante `compare("main", ref)`. En una PR superior, esto puede recuperar la versión anterior a todo el stack, en vez de la versión que precede al cambio de esa PR. Fuentes: [workflow de conversación](https://github.com/FernandoValdes01/ceretime/blob/970fe7ce55638326343e664c1bad7b24b0df7a05/.github/workflows/ai-review-conversation.yml), [motor de conversación](https://github.com/FernandoValdes01/ceretime/blob/970fe7ce55638326343e664c1bad7b24b0df7a05/.github/ai-review-conversation.cjs) y [contexto de los hallazgos](https://github.com/FernandoValdes01/ceretime/blob/970fe7ce55638326343e664c1bad7b24b0df7a05/.github/ai-review-context.cjs).

## Cómo adaptarlo

La elegibilidad debe admitir una PR directa a `main` o una PR cuyo stack nativo tenga `stack.base.ref: main`. Una función compartida evita que preparación, cálculo de confianza, publicación y conversación apliquen condiciones distintas. Para el stack actual se puede conservar el filtro del workflow sobre `main`, porque GitHub ya activa todos sus niveles. Si también se quieren admitir ramas encadenadas sin stack nativo, hace falta ampliar el filtro y definir explícitamente cómo reconocer una cadena válida.

La base del stack determina si corresponde ejecutar el reviewer; la base inmediata determina qué cambio corresponde revisar. El motor ya obtiene los archivos con `pulls.listFiles`, enriquece el contexto con `pr.base.sha` y reconstruye parches mediante `git diff pr.base.sha...REVIEW_SHA`. Debe conservar ese comportamiento para que #78 revise su diferencia respecto a #77 y #81 respecto a #78. Usar `main` como base del diff repetiría cambios de los niveles inferiores. Fuente: [preparación del plan](https://github.com/FernandoValdes01/ceretime/blob/970fe7ce55638326343e664c1bad7b24b0df7a05/.github/ai-review-score.cjs).

La conversación debe utilizar la base inmediata asociada a la revisión original para reconstruir comentarios LEFT. También debe recibir las dos referencias, base inmediata y base del stack, y describirlas correctamente en las instrucciones del modelo. Si no se puede recuperar la base histórica después de un cambio de base o un rebase, corresponde declarar evidencia incompleta.

Al cambiar la base de una PR, la revisión debe repetirse aunque el head conserve su SHA. Conviene escuchar `pull_request.edited` y procesar solo eventos con `changes.base`, además de los eventos actuales. También se necesita conservar la verificación de base y head antes de publicar y verificar `base.ref`, porque un cambio de rama base puede conservar el mismo SHA. Esto impide presentar una ejecución anterior como vigente después de un cambio del stack. Fuente: [eventos de GitHub Actions](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#pull_request).

## Verificación requerida al implementarlo

- Una PR directa a `main` continúa revisándose; una PR superior de un stack con base `main` se prepara, publica y admite conversación.
- Una PR hacia otra rama sin stack admitido permanece excluida, al igual que borradores y forks.
- El diff de cada nivel incluye únicamente sus cambios y los comentarios LEFT usan la versión anterior de ese nivel.
- Cambiar la base o hacer un rebase durante una revisión impide publicar un resultado vigente sobre un contexto anterior.
- Repetir una ejecución conserva un único resumen por PR y no mezcla memorias ni hallazgos entre niveles.

No se realizó una llamada al proveedor ni se publicó ningún comentario como parte de esta investigación. El cambio del reviewer debe implementarse y comprobarse sobre el stack antes de dar por resuelto su soporte.
