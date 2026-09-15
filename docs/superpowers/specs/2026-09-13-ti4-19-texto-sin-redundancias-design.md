# TI4-19: texto sin redundancias

## Objetivo

Reducir la repetición visual y audible en el listado y detalle de solicitudes sin cambiar el comportamiento, el contrato de datos ni el alcance de TI4-19.

## Decisión

El header nativo de Expo Router será el único título de cada pantalla secundaria. `StudentScreen` permitirá omitir su bloque introductorio en estas rutas, pero lo conservará por defecto para no alterar el inicio ni el formulario del Estudiante. Los estados de carga, error y ausencia de datos comunicarán cada situación una sola vez.

Se descartan dos alternativas. Ocultar el header nativo obligaría a reconstruir el control de regreso y su accesibilidad. Mantener ambos títulos con palabras distintas conservaría la redundancia y debilitaría la jerarquía.

## Textos visibles

| Contexto | Texto definido |
| --- | --- |
| Header del listado | `Mis solicitudes` |
| Introducción del listado | Se elimina. |
| Carga del listado | `Cargando solicitudes…` |
| Error del listado | `No pudimos cargar tus solicitudes` y acción `Reintentar` |
| Listado vacío | `Aún no tienes solicitudes`, explicación actual y acción `Crear nueva solicitud` |
| Tarjeta | Necesidad, fecha y acción breve `Ver detalle`; no muestra el identificador interno |
| Header del detalle | `Detalle de solicitud` |
| Introducción del detalle | Se elimina. |
| Carga del detalle | `Cargando solicitud…` |
| Error del detalle | `No pudimos cargar la solicitud` y acción `Reintentar` |
| Solicitud ausente | `Solicitud no encontrada`, `No aparece en tu listado` y acción `Volver a mis solicitudes` |
| Referencias ficticias | `SOL-DEMO-001` y `SOL-DEMO-002` |
| Canal preferido | `Correo institucional con texto accesible` |

En iOS y web, el botón nativo de regreso usará el título `Volver`. En Android, su descripción accesible seguirá el idioma configurado en el sistema operativo.

## Implementación

`StudentScreen` recibirá una opción que oculte el título y la descripción internos. El listado y el detalle activarán esa opción. Los componentes de estado admitirán mensajes opcionales para evitar frases de relleno. Los identificadores ficticios se actualizarán en el fixture y en las pruebas que dependen de ellos.

## Verificación

Las pruebas comprobarán que listado y detalle conservan su navegación, estados y contenido contractual. También verificarán las nuevas referencias y los textos simplificados. El recorrido final en Pixel 5 confirmará que cada pantalla secundaria muestra un solo título, que el contenido comienza antes y que carga, vacío, error, éxito y detalle siguen siendo comprensibles. Las capturas versionadas y la descripción de la PR se actualizarán con el resultado.

## Fuera de alcance

No se incorporarán estado de la solicitud, disponibilidad, agenda, acompañamiento resultante, conexión con TI2 ni cambios visuales generales en otras pantallas.
