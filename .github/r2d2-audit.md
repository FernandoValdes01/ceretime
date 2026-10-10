# Auditoría de R2D2

Fecha: 2026-10-10. Alcance: selección, contexto, consumo, verificación y publicación de la PR #90. Se inspeccionaron tres ejecuciones reales y el código publicado en `d5967fd`, `edd7b28` y `265962c`. La corrección actual se preparó y comprobó localmente antes de publicar otra ejecución.

## Cómo funciona

El workflow descarga el head de la PR y compara contra su base inmediata. Selecciona código y configuración funcional; omite binarios, archivos generados, cambios de espaciado y documentación que no sea un contrato seleccionado. Recupera contexto desde Git y agrupa el diff en bloques de hasta 48000 caracteres. El modelo propone hallazgos y solicita evidencia; un verificador independiente debe confirmar cada hallazgo antes de publicarlo. El resultado se publica como resumen, comentarios de revisión y status del commit. La revisión corresponde a la PR: no selecciona archivos por identidad del autor.

La configuración actual limita la ejecución a 80 llamadas, 48 bloques y 450000 tokens acumulados. Las tres ejecuciones auditadas tenían un límite de 600000. La reserva previa usa bytes como cota conservadora y se ajusta al consumo informado por el proveedor. Los tests de escala y demostración del workflow son simulaciones locales; el costo del modelo viene del análisis, sus reintentos, las recuperaciones y la verificación.

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

## Tercer resultado real

La ejecución [38073982013](https://github.com/FernandoValdes01/ceretime/actions/runs/38073982013), sobre `265962c`, consumió 525555 tokens de entrada y 37106 de salida: 562661 en total. Hubo 46 llamadas, 33 archivos con análisis inicial, 23 de 29 bloques procesados, 28 solicitudes pendientes y ningún defecto confirmado. El análisis consumió 308630 tokens y la verificación 254031. El status de revisión fue fallo.

Los logs muestran recuperaciones repetidas de `reviewPlan`, grupos cuya evidencia superó el límite de entrada y nuevas verificaciones tras reutilizar declaraciones ya leídas. Las páginas de un archivo leído completo conservaban `headComplete:false` y las citas podían quedar partidas con un salto de línea artificial. También se descartaron solicitudes válidas de archivo porque el modelo enviaba solo su ruta. Las comprobaciones de infraestructura agotaron presupuesto antes de terminar la tarea móvil.

## Corrección actual

Se recorre primero el diff disponible y se conservan las respuestas para retomarlas. Las divisiones comparten tres rondas por bloque original; las declaraciones y sus dependencias se reutilizan entre bloques; los imports se transmiten una vez por declaración. El servidor controla los cursores y una resolución desconocida no elimina pendientes ni reinicia todo el análisis.

Las solicitudes del modelo se normalizan una por una. Se descartan sus cursores y se restaura únicamente la continuación conocida en Git, aunque se haya añadido una asociación inequívoca con el archivo cambiado. Un selector inválido se informa con el campo rechazado y conserva otras solicitudes y hallazgos. Las decisiones del verificador también se aíslan por candidato: un índice ausente, una respuesta inválida, un fallo del proveedor o el agotamiento de llamadas en otro grupo no borra pruebas ya confirmadas.

Cuando falta evidencia para un candidato, el verificador recupera solo sus declaraciones y vuelve a comprobar ese candidato, hasta tres rondas. No vuelve a detectar sobre el bloque completo. La evidencia y sus dependencias se comparten entre comprobaciones y se incluyen al guardar la caché, de modo que un contrato cambiado invalide conclusiones anteriores. El contrato de prueba, las citas, el vínculo con HEAD y el sello de publicación mantienen sus validaciones.

Se unen las páginas contiguas de una selección completa, hasta 16000 caracteres, tanto en el mensaje del modelo como al comprobar citas. Un archivo completo conserva esa información en `headComplete`; si falta una página, sigue siendo parcial. Al pedir un módulo pequeño se incluye su código completo, con helpers y usos locales; los tests descriptivos siguen recuperando solo el caso pertinente. Las solicitudes que contienen únicamente una ruta se tratan como lectura acotada de archivo.

El verificador recibe rangos de hasta 80 líneas para funciones extensas y puede pedir otro rango concreto. Un extracto no se presenta como declaración completa. La comparación de evidencia usa código, disponibilidad y completitud; cambiar asociaciones o metadata sin aportar código nuevo no provoca otra llamada. El informe conserva las comprobaciones que refutaron una hipótesis con citas válidas, además de los defectos confirmados.

Los bloques y candidatos de aplicación se atienden primero. El límite total baja a 450000 tokens; el análisis tiene un techo de 405000 y la verificación puede usar el saldo total. Las solicitudes sin consumo medido conservan su reserva. Los límites no garantizan cobertura completa de una PR de cualquier tamaño.

Un patch ilegible deja un incidente explícito y permite analizar los bloques válidos hasta el límite. El comentario principal muestra archivo, línea, problema, impacto y propuesta de cada defecto comprobado. Incluye los candidatos pendientes como observaciones sin confirmar y los resúmenes disponibles de todos los bloques en los detalles. Una revisión parcial sin hallazgos muestra riesgo no determinado.

La cobertura parcial conserva el status de fallo y no recibe una nota de calidad. Cambiar esa regla afectaría la política actual de aprobación del repositorio. Los hallazgos comprobados sí son útiles aunque ese status siga pendiente; no se publican hipótesis como defectos.

## Límite de la auditoría

Las regresiones locales ejecutan el verificador real con respuestas simuladas. Incluyen defectos demostrables de la PR #73 archivada, recuperación sin repetir detección, conservación de pruebas entre grupos, continuidad de cursores, rangos, citas entre páginas y ausencia de llamadas adicionales cuando solo cambia metadata. Una lectura local del candidato en `reviewPlan` sobre `265962c` recuperó 1675 caracteres en lugar de la primera página de 16000; los mensajes de evidencia ocuparon 2924 y 18923 bytes respectivamente. Esta comparación no mide tokens ni calidad del modelo.

## Cuarto resultado real y ajuste posterior

La ejecución [38076346221](https://github.com/FernandoValdes01/ceretime/actions/runs/38076346221), sobre `cf4b161`, consumió 379919 tokens de entrada y 17765 de salida: 397684 en total. Analizó inicialmente los 36 archivos en 28 llamadas, pero completó solo 10 de 24 bloques y dejó seis solicitudes pendientes. Refutó una hipótesis con evidencia y no confirmó defectos. El status de revisión siguió en fallo. Las dos últimas ejecuciones acumularon 960345 tokens; el descenso de la última no compensa el costo de repetir intentos fallidos.

Persistían rangos rechazados por superar 80 líneas y una solicitud de verificación que no cabía en la reserva conservadora restante. Además, un archivo parcial podía contener una función completa repartida entre el diff y el contexto, sin indicar esa completitud al modelo. Archivos nuevos enviaban código duplicado en ambos lugares.

El ajuste posterior calcula hashes privados de archivos y declaraciones desde el código canónico de Git. El mensaje indica `completeFiles` y `completeDeclarations` únicamente cuando cada línea requerida está presente y coincide, combinando diff y evidencia. Esa comprobación se vuelve a calcular después de cada proyección; un rango recortado no conserva una afirmación de completitud anterior. Los hashes y el catálogo privado no se envían al modelo.

Se elimina una copia de líneas idénticas ya disponibles en el diff, preservando el código interno para comprobar citas. Un extracto sin el símbolo solicitado mantiene una identidad compartida sin fingir que contiene esa declaración. Los rangos de hasta 640 líneas se sirven mediante las páginas y el límite existente de 16000 caracteres por ronda; los rangos preferidos siguen siendo de 80 líneas. Coordenadas enteras enviadas como texto se normalizan sin admitir valores negativos ni expresiones.

Los paquetes de verificación grandes conservan declaraciones pertinentes, contratos documentados y contexto con coordenadas reales. Los recortes siguen siendo explícitamente parciales. El agrupamiento considera la reserva disponible y separa candidatos que caben individualmente cuando juntos la exceden. Se mantiene el límite total de 450000 tokens y la comprobación independiente para publicar un defecto. Estos arreglos locales no certifican todavía la calidad de una nueva inferencia real.
