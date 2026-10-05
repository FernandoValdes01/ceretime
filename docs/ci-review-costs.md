# Costo y optimización de R2D2

Evaluación de TI4-45 realizada el 2 de octubre de 2026. Se mantienen Groq y `openai/gpt-oss-120b`; no se contrata un servicio, no se activa facturación ni se configura otro proveedor. La revisión humana TI4 y los cuatro jobs de CI continúan obligatorios.

## Comparación con las PR del repositorio

Se consultaron las últimas 60 PR de [CERETIME](https://github.com/FernandoValdes01/ceretime/pulls), incluyendo abiertas, cerradas e integradas. Excluyendo #74, la mediana es 522 líneas añadidas/eliminadas y unas nueve de cada diez cambian hasta 1.383. #74 modifica 4.274 líneas: aproximadamente 8,2 veces la mediana. Es la segunda más grande de la muestra; #33 modifica 12.609 líneas. El número de líneas no mide dificultad ni equivale a tokens.

Además se descargaron los archivos de las 15 PR inmediatamente anteriores o posteriores a #74 y se aplicaron los `ignore_paths` actuales. Los patches disponibles se midieron con el mismo planificador; #64 y #61 tienen partes no disponibles o binarias y no se usan para calcular la mediana del diff completo. En las otras 13, la mediana es 26.310 caracteres elegibles y cuatro bloques. #74 tiene 192.508 caracteres elegibles y 27 bloques, antes de estos nuevos cambios locales: unas 7,3 veces esa mediana.

| PR | Caracteres elegibles disponibles | Bloques | Observación |
| --- | ---: | ---: | --- |
| #75 | 28.061 | 4 | Contratos y pruebas |
| #73 | 26.310 | 4 | Disponibilidad Convex |
| #71 | 20.606 | 3 | Contratos públicos |
| #70 | 46.645 | 7 | Disponibilidad y reservas |
| #69 | 55.165 | 9 | Panel Web |
| #65 | 24.456 | 4 | Pruebas Convex |
| #62 | 93.690 | 13 | Contratos Mobile |
| #74 | 192.508 | 27 | Automatización R2D2 |

Los datos son una muestra reciente, no una predicción de todas las PR futuras. Las mediciones no almacenan código de otras PR en este documento. Los patches ausentes se declaran como limitación; no se consideran revisados.

## Opciones de proveedor

| Opción | Entrada por millón de tokens | Salida por millón de tokens | Consecuencia |
| --- | ---: | ---: | --- |
| Groq gratuito | Sin cobro en el plan gratuito | Sin cobro en el plan gratuito | 8.000 TPM y 200.000 TPD publicados; cuota compartida y revisiones lentas |
| Groq Developer | USD 0,15 | USD 0,60 | Conserva integración; publica 250.000 TPM y 1.000 RPM para este modelo |
| OpenRouter, ruta económica | Desde USD 0,03 | Desde USD 0,17 | Mismo modelo, distintos proveedores; requiere adaptar endpoint, autenticación y routing |

Fuentes primarias: [modelo y precios Groq](https://console.groq.com/docs/model/openai/gpt-oss-120b), [modelos y límites Developer](https://console.groq.com/docs/models), [límites Groq](https://console.groq.com/docs/rate-limits), [endpoints y precios OpenRouter](https://openrouter.ai/api/v1/models/openai/gpt-oss-120b/endpoints). Los límites efectivos de una cuenta pueden diferir. El endpoint de OpenRouter consultado ofrece CoreWeave desde USD 0,03/0,17 y también Groq a USD 0,15/0,60: usar OpenRouter con Groq no produce por sí solo el precio mínimo.

OpenRouter admite alternativas entre proveedores y cobra un recargo al comprar créditos, además del costo de inferencia. El importe del recargo debe confirmarse al comprar; la documentación consultada no muestra una cifra estable. Sus [términos](https://openrouter.ai/terms) indican una compra mínima de USD 5. Requiere definir proveedores permitidos, soporte de JSON, política de datos y límite de gasto; no elegir automáticamente un proveedor desconocido solo por su precio. Fuentes: [facturación y políticas](https://openrouter.ai/docs/faq) y [selección de proveedores](https://openrouter.ai/docs/guides/routing/provider-selection).

## Estimación de gasto

La estimación usa caracteres del contenido enviado divididos por 3,5 como aproximación de tokens de entrada, y el techo de 1.200 tokens de salida por bloque. No utiliza un tokenizer exacto de GPT-OSS ni datos de facturación. Incluye el contexto repetido por bloque; excluye reintentos, conversaciones, impuestos, recargos de compra y descuentos de caché. Los tokens de razonamiento consumidos forman parte de la salida que debe comprobarse en el proveedor. Los nuevos campos `usage` muestran consumo real cuando Groq lo devuelve.

Para una PR típica de cuatro bloques, el orden de magnitud estimado es USD 0,005 en Groq y USD 0,001 en una ruta económica de OpenRouter. Para #74, la estimación con el techo de salida es aproximadamente USD 0,033 y USD 0,008 respectivamente. Son cifras orientativas por revisión completa, no facturas ni un compromiso de precio o calidad.

Un escenario de 100 PR al mes y tres revisiones por PR representa unas 300 revisiones típicas: alrededor de USD 1,4 en Groq o USD 0,35 en OpenRouter antes de los conceptos excluidos. PR grandes, más commits y reintentos aumentan ese gasto; memoria válida y respuestas cortas lo reducen. El ahorro absoluto entre proveedores es pequeño para este volumen.

La recomendación inicial es optimizar y, si se aprueba pagar, mantener Groq Developer con un presupuesto pequeño y controles de gasto efectivos en la cuenta: evita una migración por un ahorro mensual estimado de pocos dólares. OpenRouter tiene sentido si se valora disponer de varios proveedores o el volumen aumenta. La calidad y latencia de una ruta económica deben probarse con los mismos casos de QA antes de adoptarla. No se ha verificado que la cuenta pueda activar Developer ni se han cambiado planes.

## Flujo incremental implementado

Las estimaciones anteriores corresponden al motor y al presupuesto de salida previos a esta corrección. Son una referencia histórica; no deben proyectarse como el costo del nuevo flujo sin volver a medir. El presupuesto formal de salida ahora es 2.400 tokens, sin cambiar proveedor o facturación.

Todas las PR usan el mismo motor y el mismo contrato JSON. Se eliminó la Action externa de la ruta corta y la inferencia adicional para normalizar el score. La nota y el riesgo se derivan localmente de hallazgos funcionales validados; no se paga una consulta adicional por una explicación de confianza. Los parámetros y el registro de usage se concentran en `.github/ai-review-provider.cjs` para la revisión formal y la conversación.

La selección ocurre antes de construir el plan: excluye lockfiles, generado, binarios, artefactos y documentación ajena a contratos. JSON y YAML se comparan por su estructura y valores cuando es posible; cambios exclusivos de metadatos descriptivos en `package.json` se omiten, mientras dependencias, scripts, nombre, versión, build y publicación permanecen revisables. Los binarios no convierten una PR de código en fallo de cobertura. Si no hay unidades elegibles, no hay llamadas y el resumen lo explica.

Los hunks se conservan como unidades independientes, agrupadas en llamadas que aprovechan espacio disponible. Cada unidad válida se guarda durante 24 horas con firma de integridad. Las claves de recuperación identifican repositorio, PR, modelo, SHA y nombre de base, instrucciones, propósito, límites e implementación; el nuevo SHA por sí solo no invalida contenido intacto. Las huellas de archivo, entorno, dependencias, consumidores y discusión evitan reutilizar una conclusión cuyo contexto cambió. La invalidación del archivo propio es conservadora: modificar un helper puede exigir revisar otra vez otros hunks del mismo archivo.

La memoria guarda evaluaciones y coordenadas relativas, no patches, requests ni API keys. El resultado reutilizado se valida y se asocia al SHA actual. Una entrada corrupta, alterada, vencida o fuera de contexto produce una nueva consulta; jamás cobertura ficticia. Un fallo de cuota conserva resultados completos de unidades válidas para continuar más tarde. La disponibilidad de la caché depende del runner y del alcance de GitHub Actions.

Al responder una persona y cambiar código, el motor recupera el hallazgo original, la explicación y el cambio relacionado. Comprueba ese hilo una sola vez, conserva las decisiones formales y actualiza su estado sin crear otra raíz. Incluso una reversión que elimina el archivo del diff recibe una comprobación dirigida. Los bloques recuperados no se vuelven a enviar aunque cambie su agrupamiento con otros archivos.

El resumen muestra unidades reutilizadas, archivos omitidos, llamadas y tokens reales de entrada, salida y caché. La conversación registra las mismas métricas en su ejecución, incluidas respuestas inválidas que consumieron tokens antes de fallar. Recuperar una unidad no vuelve a sumar su consumo histórico. La caché del proveedor y la memoria local son mecanismos diferentes.

La configuración actual usa OpenRouter y `deepseek/deepseek-v4.1-flash`, con el secret de Actions ya configurado. Se mantienen los máximos de 32 bloques y 32 llamadas con reintentos y el timeout de 55 minutos. Cada bloque permite 24.000 caracteres y cada request 32.000; la pausa base es un segundo. HTTP 429 conserva los reintentos acotados y respeta `Retry-After`. Las pruebas reales del proveedor comprobaron el contrato estructurado en revisión y conversación; la revisión del diff completo se valida mediante su propio run y SHA. Las estimaciones históricas anteriores no describen la facturación de DeepSeek.
