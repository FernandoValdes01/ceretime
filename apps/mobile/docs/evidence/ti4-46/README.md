# Evidencia nativa Android de TI4-46

Estas capturas muestran el funcionamiento visual de las pantallas incluidas en la [matriz inicial WCAG 2.2 A/AA](../../accessibility/wcag-matrix.md). Complementan la entrega documental de [TI4-46](https://linear.app/ceretime/issue/TI4-46) y registran el recorrido solicitado en la PR.

## Versión y entorno

- Fecha: 4 de octubre de 2026.
- Código servido por Metro: `2b801ee1ac1c616fd4d33ace2c9b23d8958d4506`. La corrección de esta evidencia solo cambia documentación e imágenes.
- Base del inventario B0: `297ae38781f2a518bda1b772c9325ab328bd4427`.
- Emulador: `Medium_Phone`, GPU `host`, Android 17/API 37, orientación vertical y pantalla de 1080 × 2400 píxeles.
- Escala de fuente: 1.0. TalkBack desactivado.
- Cliente Android de desarrollo: versión 1.0.0, código 1, paquete temporal `cl.rmv.ceretime.ti446`.
- SHA-256 del APK compilado e instalado: `16dc9d2b320fb5b2cb983dc51f738f6730f59040329b56f3f569659166c56dfd`.

El cliente se compiló desde el árbol de trabajo de la PR con JDK 17 y `bun run mobile:android --no-bundler --app-id cl.rmv.ceretime.ti446 --device Medium_Phone`. El sufijo `.ti446` se agregó únicamente al proyecto Android generado e ignorado por Git, para instalar el cliente junto al Preview existente. Metro se inició desde el mismo árbol de trabajo con `bun run mobile:start --dev-client --port 8081` y completó el bundle Android. El acceso se realizó mediante una copia temporal de `ceretime-mobile` dirigida a ese árbol de trabajo.

## Recorrido observado

Las acciones se ejecutaron mediante toques y desplazamientos nativos en Android. Cada PNG es una captura directa mediante `adb`, sin recorte ni edición, conserva sus 1080 × 2400 píxeles y se revisó visualmente antes de adjuntarlo.

| Ruta                          | Acción realizada                                                                                                             | Resultado observado                                                                          | Captura                                                             |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `/login`                      | Abrir el cliente de la PR.                                                                                                   | Aparece el selector de roles de demostración.                                                | [01. Selector de roles](01-login.png)                               |
| `/estudiante`                 | Elegir Estudiante.                                                                                                           | Inicio con Nueva solicitud y Mis solicitudes.                                                | [02. Inicio de Estudiante](02-estudiante.png)                       |
| `/estudiante/nueva-solicitud` | Abrir Nueva solicitud, dejar los campos vacíos, desplazarse hasta Enviar solicitud y pulsarlo. Ocultar el teclado con Atrás. | El formulario vuelve al primer campo y muestra "Describe la necesidad que quieres abordar.". | [03. Error del formulario vacío](03-formulario-error.png)           |
| `/profesional`                | Reabrir el cliente y elegir Profesional.                                                                                     | Agenda con cuatro actividades ficticias y sus horarios.                                      | [04. Agenda de Profesional](04-agenda-profesional.png)              |
| `/practicante/asignaciones`   | Reabrir el cliente y elegir Practicante con asignación.                                                                      | Tarjetas con objetivos y estados de acompañamientos ficticios.                               | [05. Practicante con asignación](05-practicante-asignado.png)       |
| `/administrador/usuarios`     | Reabrir el cliente, elegir Administrador y abrir Usuarios.                                                                   | Cuentas ficticias pendientes de habilitación. Solo se consultó el listado.                   | [06. Usuarios de Administrador](06-administrador-usuarios.png)      |
| `/practicante/sin-asignacion` | Reabrir el cliente y elegir Practicante sin asignación.                                                                      | Aviso de acceso denegado y explicación de la falta de asignación.                            | [07. Practicante sin asignación](07-practicante-sin-asignacion.png) |

Entre roles se reinició únicamente el cliente temporal para volver al selector. Este recorrido no verifica el cierre de sesión. Los nombres y correos visibles pertenecen a los datos ficticios de demostración del repositorio.

## Límites

El botón flotante de herramientas sobre la cabecera pertenece al cliente de desarrollo Expo y aparece en las capturas originales. Su superposición limita la observación de los controles de esa zona. El teclado se ocultó antes de capturar el error del formulario; la imagen no acredita su visibilidad con el teclado abierto.

La comprobación cubre los siete escenarios visuales descritos, con fuente al 100 %. No se ejecutaron TalkBack, mediciones de contraste ni una auditoría WCAG completa. Las 671 filas de la matriz conservan sus resultados: 664 No probado y siete Fallido de versiones históricas, sin nuevos Aprobado. Las auditorías TI4-47/TI4-48 y la consolidación TI4-64 mantienen su alcance y sus pendientes. Los comandos de validación documental y el CI del commit que incorpora estas imágenes se registran en la PR.
