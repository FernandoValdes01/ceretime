# Auditoría de R2D2

Fecha: 2026-10-10. Alcance: selección, contexto, consumo, verificación y publicación de la PR #90. Se inspeccionaron el código publicado en `d5967fd`, los logs de la ejecución [38061965001](https://github.com/FernandoValdes01/ceretime/actions/runs/38061965001) y las correcciones locales posteriores. La PR seguía abierta con ese mismo SHA al consultar GitHub. No se ejecutó otra inferencia pagada durante esta auditoría.

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

## Corrección local

Se recorre primero el diff disponible y se conservan las respuestas para retomarlas. Las divisiones comparten tres rondas por bloque original; las declaraciones y sus dependencias se reutilizan entre bloques; los imports se transmiten una vez por declaración. El servidor controla los cursores y una resolución desconocida no elimina pendientes ni reinicia todo el análisis.

Un patch ilegible deja un incidente explícito y permite analizar los bloques válidos hasta el límite. Si hay candidatos, se verifican antes de recuperar contexto adicional de cobertura. Si se confirma un defecto, se conserva y publica junto con las partes pendientes; se evita otra recuperación para completar ese bloque. El comentario principal muestra archivo, línea, problema, impacto y propuesta. Una revisión parcial sin hallazgos muestra riesgo no determinado.

La cobertura parcial conserva el status de fallo y no recibe una nota de calidad. Cambiar esa regla afectaría la política actual de aprobación del repositorio. Los hallazgos comprobados sí son útiles aunque ese status siga pendiente; no se publican hipótesis como defectos.

## Límite de la auditoría

Las regresiones locales comprueban el control de flujo y la presentación con respuestas simuladas. No certifican la calidad del modelo ni que toda declaración extensa quepa en una solicitud. La revisión real del cambio posterior continúa pendiente; no se afirma que la PR completa ya haya sido revisada.
