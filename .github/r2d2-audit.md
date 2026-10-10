# Auditoría de R2D2

Fecha: 2026-10-10. Alcance: selección, contexto, consumo, verificación y publicación de la PR #90. Se inspeccionaron las dos ejecuciones reales y el código publicado en `d5967fd` y `edd7b28`. La tercera corrección se preparó y comprobó localmente antes de publicar otra ejecución.

## Cómo funciona

El workflow descarga el head de la PR y compara contra su base inmediata. Selecciona código y configuración funcional; omite binarios, archivos generados, cambios de espaciado y documentación que no sea un contrato seleccionado. Recupera contexto desde Git y agrupa el diff en bloques de hasta 48000 caracteres. El modelo propone hallazgos y solicita evidencia; un verificador independiente debe confirmar cada hallazgo antes de publicarlo. El resultado se publica como resumen, comentarios de revisión y status del commit. La revisión corresponde a la PR: no selecciona archivos por identidad del autor.

La configuración limita la ejecución a 80 llamadas, 48 bloques y 600000 tokens acumulados. La reserva previa usa bytes como cota conservadora y se ajusta al consumo informado por el proveedor. Los tests de escala y demostración del workflow son simulaciones locales; el costo del modelo viene del análisis, sus reintentos, las recuperaciones y la verificación.

## Fallos observados

| Problema                                                      | Evidencia                                                                                                 | Efecto                                                                                                |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Recuperación antes de recorrer toda la PR                     | Los logs procesan reiteradamente los primeros bloques mientras el total crece por divisiones.             | Los últimos archivos quedan sin analizar al agotar el presupuesto.                                    |
| Divisiones reinician el límite y repiten contexto             | El total crece de 17 a 39 bloques; varias rondas recuperan las mismas declaraciones.                      | Se paga de nuevo por contratos ya leídos.                                                             |
| Contexto que no cabe                                          | Los logs registran recuperaciones de aproximadamente 66000 caracteres frente al límite de 48000.          | Recuperar desde Git no garantiza que el modelo pueda recibir toda esa evidencia.                      |
| Errores de protocolo provocan reintentos completos            | Cursores desconocidos y resoluciones de evidencia inválidas en los logs.                                  | Otra llamada paga por el mismo diff sin resolver el problema.                                         |
| Un patch ilegible impide revisar los válidos                  | `reviewPlan` publicado termina inmediatamente si `plan.issues` contiene cualquier incidente.              | La revisión disponible se descarta antes de llamar al modelo.                                         |
| Completar contexto tiene prioridad sobre verificar candidatos | La recuperación se ejecuta antes del verificador.                                                         | Un defecto potencialmente comprobable espera mientras se consume presupuesto buscando otra evidencia. |
| El informe parcial destaca incidentes                         | El resumen muestra cobertura y próximos pasos técnicos; las correcciones quedan en comentarios separados. | El usuario recibe poca información útil en el comentario principal.                                   |

La ejecución medida consumió 531278 tokens de entrada y 14711 de salida: 545989 en total. Procesó 17 de 39 bloques, dejó 47 solicitudes pendientes y no produjo hallazgos verificados. El éxito del job de Actions indica que publicó un resultado; el status de revisión fue fallo. La falta de hallazgos no demuestra ausencia de defectos.

## Segundo resultado real

La ejecución [38067356340](https://github.com/FernandoValdes01/ceretime/actions/runs/38067356340), sobre `edd7b28`, tampoco resolvió el problema: hubo análisis inicial de 35 archivos, pero solo 14 de 27 bloques completos, 50 solicitudes pendientes, cuatro incidentes y cero hallazgos verificados. Consumió 537331 tokens de entrada y 21899 de salida: 559230 en total, repartidos en 36 llamadas. Su status de revisión fue fallo.

Se reprodujo localmente el rechazo de un cursor legítimo: Git devolvía una continuación sin `forPath`, y el modelo la asociaba al archivo del cambio en la siguiente solicitud. La identidad estricta consideraba esa asociación una solicitud diferente y rechazaba la continuación, aunque su ruta, lado y selector fueran los mismos. Además, una solicitud inválida del verificador eliminaba las decisiones válidas de su respuesta; después de recuperar contexto se volvía a detectar sobre el diff entero, en vez de comprobar el candidato original.

## Corrección actual

Se recorre primero el diff disponible y se conservan las respuestas para retomarlas. Las divisiones comparten tres rondas por bloque original; las declaraciones y sus dependencias se reutilizan entre bloques; los imports se transmiten una vez por declaración. El servidor controla los cursores y una resolución desconocida no elimina pendientes ni reinicia todo el análisis.

Las solicitudes del modelo se normalizan una por una. Se descartan sus cursores y se restaura únicamente la continuación conocida en Git, aunque se haya añadido una asociación inequívoca con el archivo cambiado. Un selector inválido se informa con el campo rechazado y conserva otras solicitudes y hallazgos. Las decisiones del verificador también se aíslan por candidato: un índice ausente, una respuesta inválida, un fallo del proveedor o el agotamiento de llamadas en otro grupo no borra pruebas ya confirmadas.

Cuando falta evidencia para un candidato, el verificador recupera solo sus declaraciones y vuelve a comprobar ese candidato, hasta tres rondas. No vuelve a detectar sobre el bloque completo. La evidencia y sus dependencias se comparten entre comprobaciones y se incluyen al guardar la caché, de modo que un contrato cambiado invalide conclusiones anteriores. El contrato de prueba, las citas, el vínculo con HEAD y el sello de publicación mantienen sus validaciones.

El análisis puede consumir como máximo el 60 % del presupuesto total; el resto queda disponible para comprobar candidatos. El límite total permanece en 600000 tokens y las solicitudes sin consumo medido conservan su reserva. Este límite evita gastar todo en detección y recuperación, pero no garantiza cobertura completa de una PR de cualquier tamaño.

Un patch ilegible deja un incidente explícito y permite analizar los bloques válidos hasta el límite. El comentario principal muestra archivo, línea, problema, impacto y propuesta de cada defecto comprobado. Incluye los candidatos pendientes como observaciones sin confirmar y los resúmenes disponibles de todos los bloques en los detalles. Una revisión parcial sin hallazgos muestra riesgo no determinado.

La cobertura parcial conserva el status de fallo y no recibe una nota de calidad. Cambiar esa regla afectaría la política actual de aprobación del repositorio. Los hallazgos comprobados sí son útiles aunque ese status siga pendiente; no se publican hipótesis como defectos.

## Límite de la auditoría

Las regresiones locales ejecutan el verificador real con respuestas simuladas. Incluyen defectos demostrables de la PR #73 archivada, recuperación sin repetir detección, conservación de pruebas entre grupos, continuidad de cursores y reserva para verificar al agotar el análisis. No certifican la calidad del modelo ni que toda declaración extensa quepa en una solicitud. El resultado real de la tercera corrección sigue pendiente; no se afirma que la PR completa ya haya sido revisada.
