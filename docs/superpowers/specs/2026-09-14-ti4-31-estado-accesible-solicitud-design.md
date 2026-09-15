# TI4-31: estado accesible de la solicitud

## Contexto

TI4-19 incorporó el listado y el detalle de las solicitudes propias del estudiante, pero dejó fuera la representación del estado para mantener separadas las responsabilidades. TI4-31 agrega esa información al detalle sin incorporar el acompañamiento resultante de TI4-35 ni modificar los contratos provisionales de Mobile.

## Alcance

El detalle mostrará el estado actual mediante una etiqueta textual y una señal gráfica que no dependa del color. TalkBack recibirá una descripción que identifique el campo y su valor. La pantalla conservará los estados existentes de carga, error y solicitud no encontrada.

Quedan fuera del cambio el acompañamiento resultante, las transiciones de estado, los datos de disponibilidad, el listado de solicitudes y cualquier integración nueva con TI2.

## Alternativas consideradas

La opción elegida es un componente específico y reutilizable respaldado por un mapeo exhaustivo de `StudentRequestStatus`. Centraliza el texto visible, la señal gráfica y el tratamiento visual de los siete estados. El compilador advertirá si aparece un estado sin representación.

Se descartó resolver el estado con condicionales dentro de la pantalla porque mezclaría traducción, apariencia y estructura del detalle. También se descartó ampliar `DetailField`, ya que un estado necesita semántica y señal gráfica propias y no es un dato de texto común.

## Diseño

Un módulo de presentación convertirá cada `StudentRequestStatus` en una etiqueta en español y una variante visual. El componente mostrará un icono o forma junto con el texto dentro de una superficie con contraste suficiente. El color será complementario, nunca la única diferencia entre estados.

`StudentRequestDetailScreen` entregará `request.status` al componente dentro de la tarjeta existente. No cambiará la lectura de datos ni el puerto `StudentAreaReader`: el flujo seguirá siendo adaptador ficticio, proveedor del área de estudiante, solicitud encontrada en el snapshot y representación del estado.

El valor textual expondrá una sola descripción comprensible, con el formato `Estado de la solicitud: <etiqueta>`, para evitar que TalkBack anuncie por separado el rótulo y los elementos decorativos. El icono y el rótulo no añadirán focos adicionales.

## Pruebas y evidencia

Las pruebas automatizadas comprobarán el mapeo de todos los estados, el texto visible, la descripción accesible y la integración en el detalle real. Las pruebas existentes de carga, error, autorización y navegación deberán seguir pasando.

La comprobación manual se hará con TalkBack en el emulador Pixel 5. La evidencia incluirá una captura del estado y un registro breve del anuncio escuchado. El cierre ejecutará las pruebas de Mobile, la comprobación de tipos, `cspell`, `bun run lint` y `bun run format:check`.

## Estrategia de rama y PR

La rama `jmunoz/ti4-31-estudiante-estado-solicitud` parte de `jmunoz/ti4-19-estudiante-solicitudes`, porque TI4-31 depende de TI4-19 y Linear permite encadenarlas. Mientras la PR de TI4-19 siga abierta, la PR draft de TI4-31 tendrá esa rama como base para mostrar únicamente el cambio accesible. Después del merge de TI4-19 se actualizará la base a `main` y, si hace falta, se reubicará el commit sobre la nueva punta.
