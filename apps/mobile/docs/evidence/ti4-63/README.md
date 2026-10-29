# TI4-63: validación del flujo guiado en Android

<!-- cspell:words samsung talkback -->

Issue: [TI4-63](https://linear.app/ceretime/issue/TI4-63). Evaluación del 28 de octubre de 2026 sobre `ca097570cd0152d1a53d2d4b431b9e339cc51b17`, que incluye TI4-62. La evaluación inicial usó exclusivamente datos ficticios y el envío simulado, sin modificar implementación, contratos, backend ni estados de Linear. Las correcciones de UI solicitadas después por el usuario se registran al final.

## Resultado

Se completó la guía nativa de cinco pasos con TalkBack, resumen, retorno para editar, fallo y reintento. El usuario confirmó auditivamente el error del medio de información, el anuncio del resumen, el fallo con opción de reintentar, la relectura de la confirmación y, en una repetición pausada, el anuncio automático de éxito. Se completó también la ruta mediante pulsaciones y desplazamientos con TalkBack apagado, texto al 200 %, alto contraste y reducción de movimiento seleccionada.

La evaluación detectó que Nueva solicitud podía reabrir el comprobante anterior dentro de la misma sesión. Ese hallazgo quedó corregido y repetido en Android el 29 de octubre, según el [cierre técnico](#cierre-técnico-y-regresión-de-reapertura). El informe distingue comprobaciones aprobadas, fallos históricos y capacidades no probadas; no declara conformidad WCAG general ni sustituye la [matriz compartida](../../accessibility/wcag-matrix.md). La implementación y la evidencia se entregan para revisión independiente; la aprobación e integración mediante PR siguen siendo necesarias para cerrar la issue.

## Entorno y versión

- Teléfono físico Samsung SM-S911B, Android 16, API 36; conexión USB autorizada mediante ADB. Todas las acciones se dirigieron a un único dispositivo.
- TalkBack de Samsung `com.samsung.android.accessibility.talkback`, versión 16.2.00.12. Estado inicial: desactivado; escala de texto del sistema: 1.0.
- Cliente evaluado: `cl.rmv.ceretime.debug`, versión 1.0.0, código de versión 1. APK local del 25 de octubre, instalado durante esta sesión sin reemplazar `cl.rmv.ceretime`, la app habitual del usuario.
- SHA-256 del APK: `65e49650b76deb2c70e54fc48da53ebaac5dd7c467fd8ef469c85afd97f48be7`. El JavaScript se sirvió desde el commit indicado arriba; la fecha del APK no identifica la versión del formulario.
- Metro iniciado con autorización explícita, modo `EXPO_PUBLIC_STUDENT_REQUEST_DEMO_MODE=fail-once`, puerto 8081 redirigido por USB. Tras observar consumo superior a 2 GiB, se detuvo y reinició bajo `agent-heavy`, con presupuesto de 6.25 GiB y seis workers. No se compiló un APK nuevo ni se inició un emulador.
- El APK instalado no declara `android.permission.RECORD_AUDIO`. La guía se probó sin micrófono disponible; no se acredita una denegación desde el diálogo de permisos de un cliente con reconocimiento instalado.

## Método e incidente de inspección

Al principio se consultó la jerarquía con `uiautomator dump` mientras TalkBack estaba activo. El usuario informó que escuchaba «TalkBack activado» y «TalkBack desactivado» en bucle. Se interrumpió el recorrido, se desactivó el servicio y se revisaron los registros. Las conexiones de automatización se registraban con `flags=0x0`: [Android documenta](https://developer.android.com/reference/android/app/UiAutomation#FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES) que la automatización suspende por defecto los otros servicios de accesibilidad. Esta interferencia provino del procedimiento de prueba; no acredita un defecto del formulario.

Se retiró esa inspección durante el recorrido con lector. Un inspector temporal basado en la API nativa se conectó con la opción de conservar los servicios (`flags=0x1`), comprobada en el registro. Los campos se completaron mediante acciones nativas de accesibilidad y los botones se activaron sobre los controles existentes. El usuario confirmó que TalkBack permanecía activo y estable. Estas acciones no equivalen a explorar cada control mediante gestos de TalkBack; la ruta táctil se comprobó después, por separado.

Las primeras acciones fueron demasiado rápidas, según informó el usuario. Se repitieron las comprobaciones auditivas relevantes con pausas de 20 a 30 segundos. Solo se atribuye confirmación auditiva a los mensajes que el usuario confirmó expresamente. Las capturas [01](./01-error-obligatorio.png) y [02](./02-talkback-error.png) son evidencia visual inicial, sin acreditación auditiva del primer intento.

La pasada táctil se hizo con TalkBack desactivado, mediante pulsaciones ADB cuyas posiciones se obtuvieron de la jerarquía visible, desplazamientos y entrada por teclado. El botón flotante de herramientas del cliente de desarrollo se ocultó porque se superponía a la cabecera. No se usó navegador ni Expo Web.

## Recorrido con TalkBack

1. Entrar como Estudiante y abrir Nueva solicitud. Intentar continuar con necesidad y resultado vacíos. **Probado visualmente:** errores asociados a ambos campos. **No probado auditivamente en esta primera ejecución:** la inspección interrumpía el lector.
2. Escribir «Necesito materiales accesibles» y «Leer los materiales del curso»; avanzar. Intentar continuar sin apoyo. Seleccionar Comunicación escrita y avanzar. **Probado:** el usuario escuchó el paso 2 y su error, con el límite de ritmo descrito arriba.
3. Seleccionar En línea y Lunes. Ingresar Desde 13:00 y Hasta 09:00 e intentar continuar. **Probado visualmente:** [error de franja invertida](./03-franja-invertida.png). Corregir a 09:00–13:00 y avanzar. **No probado:** audición específica del error horario.
4. Intentar continuar sin medio de información. Repetir el intento de forma pausada. **Probado auditivamente:** el usuario confirmó completo «Indica cómo prefieres recibir información». [Captura del error](./04-error-canal.png).
5. Escribir «Correo con texto accesible» y avanzar. **Probado:** el usuario confirmó el anuncio del resumen o paso 5; la inspección comprobó necesidad, resultado, Comunicación escrita, En línea, Lunes, franja y medio. [Resumen](./05-resumen.png).
6. Volver al paso 4, cambiar el medio a «Mensaje escrito accesible» y avanzar. **Probado:** el resumen reflejó el cambio y conservó necesidad, resultado y franja. No hubo envío antes de confirmar.
7. Confirmar. **Probado:** el primer intento falló y el usuario escuchó el error y la opción de reintento. [Fallo simulado](./06-fallo-envio.png).
8. Reintentar una sola vez. **Probado:** apareció [SOL-DEMO-006](./07-confirmacion.png). El usuario pidió repetir el anuncio; al enfocar la confirmación visible confirmó «Solicitud enviada». Esta primera comprobación acredita relectura, no el anuncio automático original.
9. En una sesión posterior del cliente, repetir el envío y su fallo. Reintentar con TalkBack activo y dejar 30 segundos sin acciones. **Probado auditivamente:** el usuario confirmó completo el anuncio automático de éxito. [Confirmación de la repetición](./15-confirmacion-anuncio.png).
10. Cancelar los controles locales de comandos. **Probado:** se cerró el panel y se conservó el comprobante SOL-DEMO-006; no se canceló la solicitud enviada. El listado posterior mostró una única solicitud nueva de esta repetición, además de los registros ficticios iniciales.

## Ruta táctil, ampliación y persistencia

Desde Preferencias de accesibilidad se eligieron texto al 200 %, Contraste: Activado y Movimiento: Reducir movimiento. [Controles de preferencias](./08-preferencias-200.png). Se reinició la sesión simulada para obtener un formulario vacío después del hallazgo de reapertura.

**Probado:** se completaron los cinco pasos mediante tacto, con TalkBack apagado y sin micrófono disponible. Datos ficticios: necesidad de material accesible de prueba, lectura de documentos del curso, Comunicación escrita, En línea, Lunes y medio escrito. Se abrió el teclado en los campos, se introdujeron valores, se ocultó el teclado y se desplazó el formulario hasta alcanzar Continuar y Confirmar. El [medio de información ampliado](./10-medio-tactil-200.png) conserva su acción visible. Los controles de las etapas anteriores se alcanzaron desplazando hacia arriba cuando el cambio de paso conservaba la posición inferior del formulario.

La confirmación produjo [SOL-DEMO-007 al 200 %](./11-confirmacion-tactil-200.png). Desde Inicio → Mis solicitudes se abrió su [detalle con referencia y estado Recibida](./12-detalle-tactil-200.png). No hubo reconocimiento de voz ni dictado.

**Probado:** después de detener y abrir nuevamente el cliente de desarrollo, Preferencias mostró [texto al 200 %, alto contraste y reducción de movimiento activados](./13-preferencias-persistidas.png). Esto acredita carga y persistencia entre procesos. **Límite:** la selección de reducción de movimiento no equivale a medir todas las animaciones; no se grabó una comparación temporal completa. El alto contraste se observó en Android y se complementó con la prueba de tokens existente; no se midieron todos los píxeles ni estados de cada pantalla.

## Doble confirmación

En un proceso nuevo, con preferencias del sistema y TalkBack apagado, se completó otra solicitud ficticia. Se enviaron dos pulsaciones consecutivas sobre Confirmar y enviar solicitud. **Probado:** terminó en el [único fallo previsto por el modo de fallo único](./14-doble-confirmacion-fallo.png); no apareció una confirmación por un segundo intento concurrente. Tras un único reintento apareció SOL-DEMO-006 y el [listado mostró una sola solicitud nueva](./16-listado-doble-confirmacion.png). La suite automatizada complementa la observación con el conteo del puerto de envío mientras la primera promesa está pendiente.

## Hallazgo inicial de reapertura

**Fallido: reapertura de Nueva solicitud después de un envío confirmado.** En la misma sesión, regresar desde el comprobante al inicio y pulsar Nueva solicitud volvió a mostrar SOL-DEMO-006 en lugar de los campos iniciales. [Evidencia al 200 %](./09-nueva-solicitud-conserva-confirmacion.png). Fue necesario cerrar y volver a abrir la sesión simulada para comenzar la pasada táctil con un formulario vacío.

La atribución inicial fue TI4-62, responsable del flujo guiado. La corrección se incorporó por ampliación explícita del alcance en la revisión final y se verificó sobre la ruta canónica `/estudiante/nueva-solicitud`, sin usar las herramientas del cliente para navegar. Se conserva la captura 09 como evidencia histórica del fallo; las capturas 21–24 y las pruebas de integración documentan la corrección.

## Límites y entrega

**No probado:** exploración secuencial completa de todos los controles mediante gestos de TalkBack; denegación desde el diálogo de micrófono en un cliente que lo declare; combinación de TalkBack con todos los pasos al 200 %; medición temporal completa de animaciones y contraste de todos los estados. La ruta táctil al 200 % y la pasada con lector al tamaño del sistema son comprobaciones distintas. Los pendientes de criterios se entregan a TI4-64 mediante el enlace a esta evidencia, sin sobrescribir su matriz.

Los errores de etiquetas o campos se coordinan con TI4-53; preferencias, con TI4-58 y las políticas correspondientes; capacidades de voz, con TI4-60/61. La incidencia de inspección es del procedimiento de QA. No se atribuye al producto un fallo del inspector. Algunas acciones del inspector temporal terminaron con código 137 después de ejecutarse; sus mensajes de acción por sí solos no se usan como prueba: se comprobó el estado posterior mediante captura o inspección independiente.

Al terminar se restauraron las preferencias de la app a Seguir el sistema, se desactivó TalkBack como estaba al inicio, se mantuvo la escala del sistema en 1.0, se cerró el cliente de pruebas, se eliminó el inspector temporal del teléfono y se retiró la redirección USB del puerto 8081. Metro quedó detenido. El cliente de pruebas instalado se conserva; la app habitual no fue reemplazada. No se eliminaron datos personales ni archivos temporales globales.

## Comprobaciones automatizadas

Desde la raíz:

```sh
bun run --cwd apps/mobile typecheck
bun run --cwd apps/mobile test --runTestsByPath __tests__/student-request.test.tsx __tests__/student-request-demo-mode.test.tsx __tests__/navigation.test.tsx
bun run --cwd apps/mobile test --runTestsByPath __tests__/accessibility-color-palette.test.tsx --silent
bun run lint
bun run format:check
bunx --package cspell --package @cspell/dict-es-es cspell lint --no-progress apps/mobile/docs/evidence/ti4-63/README.md
```

Typecheck y las tres suites solicitadas aprobaron: 46 pruebas. Se reutilizaron sus escenarios de validación, foco, resumen frente al comando, edición tras fallo, reintento, dos envíos concurrentes, descarte del borrador y navegación; no se duplicaron suites ni se reescribió la implementación. Jest emitió avisos de Reanimated sobre reducción de movimiento, que no se interpretan como evidencia nativa. La suite de paleta aprobó sus tres pruebas de contraste de tokens. Los resultados finales de lint, formato y ortografía se registran en la PR.

La [evidencia TI4-30](../ti4-30/README.md) describe el envío previo y no sustituye este recorrido. Las comprobaciones de esta entrega cubren el commit indicado, el teléfono y el cliente descritos; no acreditan otras versiones, dispositivos ni datos reales. El cierre requiere revisión, CI e integración mediante PR; no se marca la issue como terminada desde esta sesión.

## Correcciones de UI solicitadas después de la evaluación

Tras revisar las capturas, el usuario pidió corregir los iconos pequeños frente al texto ampliado, la alternancia entre CERETI y CERETIME, el nombre partido y el botón Cancelar del panel parcialmente cubierto por la navegación de Android. Ese pedido amplía el alcance original de evidencia a estas correcciones de presentación. No se cambian reconocimiento, contratos, preferencias almacenadas ni acciones de negocio.

Se conservan los módulos existentes. La cabecera nativa y la compartida muestran CERETI; con texto ampliado o poco ancho, la identidad y las acciones ocupan filas separadas. Avatar e iconos crecen de forma moderada, con límite de 1.5 veces su tamaño base; los iconos de pestañas reservan el espacio correspondiente. El texto sigue usando la escala solicitada. El panel usa área segura dentro del modal, conserva desplazamiento y consume el texto, contraste y reducción de movimiento de las preferencias compartidas. No se elimina el foco visible del lector.

Se repitió la comprobación en el mismo Samsung y cliente de desarrollo, con la corrección sobre la base documental `674fa3517af70e345b48fd9cfa9755bf1f9dc4c0`. Metro se ejecutó bajo protección de recursos; para la conexión USB se usó resolución local IPv4. No se compiló otro APK ni se habilitó TalkBack durante esta repetición visual.

- [Panel al 100 %](./17-comandos-corregidos-100.png): Cancelar aparece completo por encima de la navegación del sistema y cierra el panel.
- [Cabecera e iconos al 200 %](./18-cabecera-corregida-200.png): CERETI aparece completo en inicio; los iconos de cabecera y pestañas aumentan de tamaño.
- [Panel al 200 %](./19-comandos-corregidos-200.png): el título se distribuye en dos líneas, Cerrar sigue accesible y los cuatro botones permanecen completos. El límite inferior de Cancelar fue 2141 píxeles en ambas escalas, frente al inicio de la barra del sistema en 2214 píxeles.
- [Cabecera con Volver al 200 %](./20-cabecera-volver-corregida-200.png): CERETI permanece completo también en Nueva solicitud. El acceso inicial con cabecera nativa mostró el mismo nombre.

La prueba de regresión de comandos carga la preferencia al 200 % con sistema al 100 %, abre el panel, comprueba el texto ampliado y activa Cancelar: no se llama a volver ni a abrir solicitudes. Las suites existentes verifican además los comandos, su cancelación, la navegación entre roles y el envío. La prueba de opciones de cabecera se ejecuta explícitamente con su patrón `.test.ts`, porque el patrón general de Mobile solo incluye `.test.tsx`.

Las capturas 01–16 conservan sus resultados históricos y no se presentan como pruebas de la corrección. La reapertura se resolvió en la repetición del 29 de octubre descrita a continuación. Los límites del recorrido inicial siguen explícitos. Al terminar esta repetición se restauró Seguir el sistema, se cerró el cliente, se retiró la redirección USB y se detuvo Metro.

## Cierre técnico y regresión de reapertura

Repetición del 29 de octubre de 2026 en el mismo Samsung SM-S911B, Android 16/API 36 y cliente `cl.rmv.ceretime.debug`, con JavaScript del commit `6656b0314ecd0c0567c4e072c25f86057a0f5686`. Se reutilizó el APK instalado y Metro se ejecutó bajo protección de recursos, con conexión USB local IPv4 y el modo de fallo único. La repetición fue táctil, con TalkBack desactivado; las confirmaciones auditivas del recorrido inicial se conservan como evidencia de esa pasada.

La causa era la conservación de la pestaña oculta y de su formulario completado. Ahora el formulario notifica el éxito a su pantalla; al volver desde un comprobante al área del estudiante, la pantalla inicia una nueva instancia del formulario existente. Los borradores, los errores y los intentos pendientes mantienen su estado. Consultar las preferencias mantiene el comprobante, porque esa ruta compartida no inicia otra solicitud. No se cambia el puerto de envío, el almacén simulado ni el contrato de solicitud.

1. Abrir Nueva solicitud y completar los cinco pasos con datos ficticios: Materiales accesibles de prueba, Leer los materiales del curso, Comunicación escrita, En línea, Lunes y Correo con texto accesible. Confirmar, observar el fallo simulado y activar Reintentar envío. **Probado:** apareció [SOL-DEMO-006](./21-comprobante-antes-de-volver.png).
2. Abrir Preferencias de accesibilidad, seleccionar texto al 200 % y volver. **Probado:** se conservó la [confirmación visible al 200 %](./22-comprobante-tras-preferencias-200.png).
3. Activar la pestaña Inicio y volver a Nueva solicitud. Desplazarse hasta los campos. **Probado:** necesidad y resultado estaban [vacíos al 200 %](./23-nueva-solicitud-vacia-200.png); apareció el formulario inicial en lugar del comprobante. No se cerró ni reinició la sesión para conseguirlo.
4. Escribir Borrador de prueba en resultado esperado, volver a Inicio y abrir Nueva solicitud. **Probado:** el [borrador se conservó al 200 %](./24-borrador-conservado-200.png). Esta solicitud no se envió.
5. Restaurar Tamaño del texto: Seguir el sistema. **Probado:** preferencias mostraba texto al 100 %, alto contraste desactivado y reducción de movimiento desactivada. Se cerró el cliente de pruebas, se retiró la redirección USB y se detuvo Metro. TalkBack siguió desactivado y la escala del sistema siguió en 1.0.

La regresión automatizada se añadió a `student-request.test.tsx`, con el router y los módulos reales. El caso de reapertura falló antes del cambio y pasó después. También pasaron los casos de conservación del borrador y del comprobante al consultar preferencias. La suite completa de Mobile pasó con 26 suites y 271 pruebas; tipos, lint, formato y ortografía de los archivos modificados también pasaron. Los avisos de Reanimated no se usan como evidencia nativa.

### Cobertura de las responsabilidades de TI4-63

| Responsabilidad                                                             | Resultado y evidencia                                                                                                                                                                            |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Guía, resumen, volver/corregir, confirmar y resultado con TalkBack          | Recorrido inicial y confirmaciones auditivas explícitas del usuario; capturas 01–07 y 15. Se distinguen relectura y anuncio automático.                                                          |
| Texto ampliado, contraste, movimiento y carga de preferencias               | Ruta táctil completa al 200 %, persistencia tras reiniciar y capturas 08, 10–13 y 17–24. La selección de movimiento y contraste no se presenta como medición de todas las animaciones o estados. |
| Fallo/reintento, doble toque, teclado, desplazamiento y alternativa sin voz | Recorridos nativos descritos, capturas 06–07, 10–12, 14, 16 y 21; cliente sin micrófono disponible. El diálogo explícito de denegación sigue marcado como no probado.                            |
| Commit, dispositivo, pasos y resultados reproducibles                       | Entorno inicial y cierre técnico identifican las versiones de código y cliente; cada escenario distingue probado, fallido o no probado.                                                          |
| Atribución de pendientes y reutilización                                    | Límites coordinados con TI4-53/57/58/60/61/64 según responsabilidad; matriz compartida conservada. La reapertura quedó resuelta reutilizando la pantalla y el formulario.                        |

El alcance de evaluación admite registrar límites de cobertura y atribuirlos a las tareas existentes. Las comprobaciones no ejecutadas de la sección Límites y entrega no se convierten en aprobadas ni en una declaración de conformidad general. La aprobación humana y la integración de la PR corresponden al cierre del workflow, no a otra implementación pendiente del formulario.

## Pestañas compactas y compartidas entre roles

Por solicitud de la revisión visual se corrigió el espacio inferior de la barra y se comprobaron los cuatro roles. La repetición del 29 de octubre usó el mismo Samsung, cliente de desarrollo y datos ficticios, con el código `bfd60b44477d92a02cf3cb6467056b65210c3e52`. Se reutilizó Metro, que ya estaba activo, sin iniciarlo ni reiniciarlo.

La barra reservaba 84 puntos antes del área inferior del sistema. Ahora reserva normalmente 63 puntos al 100 %, que incluyen icono, dos líneas de etiqueta y relleno del botón. El área de navegación de Android se añade una sola vez. Las etiquetas que necesitan más líneas amplían la barra mediante su medida nativa; reducir el texto o cambiar el ancho descarta las medidas anteriores. Se conserva el texto ampliado y el nombre completo de cada destino.

Los cuatro navegadores de rol consumen `Tabs`, `RoleTabIcon` y `useRoleTabScreenOptions` del módulo `role-tabs.tsx`. El navegador profesional también importa Tabs desde ese módulo común. Los destinos y su número corresponden a cada rol; tamaño, espaciado, tipografía, colores y adaptación al texto proceden de la misma implementación. Los Stack internos conservan el navegador de pestañas del rol. Acceso y Preferencias son rutas fuera de esos navegadores y mantienen su navegación propia.

| Rol           | Ventanas comprobadas mediante pulsaciones en Android al 100 %                       | Resultado                                                                 |
| ------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Profesional   | Agenda, Solicitudes, Acompañamientos, Perfil y detalle de una atención desde Agenda | Cuatro pestañas conservadas; mismo tamaño y posición en las cinco vistas. |
| Estudiante    | Inicio, Solicitudes, Perfil y Nueva solicitud                                       | Tres pestañas conservadas; mismo tamaño y posición en las cuatro vistas.  |
| Practicante   | Asignaciones e Inicio, Perfil                                                       | Dos pestañas conservadas; mismo tamaño y posición.                        |
| Administrador | Inicio, Usuarios y Perfil                                                           | Tres pestañas conservadas; mismo tamaño y posición en las tres vistas.    |

En las vistas comprobadas al 100 %, todos los botones de pestaña ocuparon la misma franja vertical, de y=2050 a y=2214. Antes del ajuste, los botones del profesional empezaban en y=2011 y el borde superior de la barra estaba aproximadamente 55 píxeles más arriba. La comparación acredita una reducción de 21 puntos en la altura total, con el área del sistema conservada. En el profesional al 200 %, las etiquetas ocuparon hasta tres líneas y los botones se ampliaron a la franja y=1882–2214; el texto quedó dentro de la barra. La revisión del código incluye además los Stack de solicitudes y acompañamientos del estudiante, agenda y acompañamientos del profesional, y asignaciones del practicante, que no declaran otra barra.

- [Antes, profesional al 100 %](./25-tabs-profesional-antes-100.png).
- [Barra compacta, profesional al 100 %](./26-tabs-profesional-compactas-100.png).
- [Etiquetas completas, profesional al 200 %](./27-tabs-profesional-ampliadas-200.png).
- [Misma barra, estudiante al 100 %](./28-tabs-estudiante-100.png).
- [Misma barra, practicante al 100 %](./29-tabs-practicante-100.png).
- [Misma barra, administrador al 100 %](./30-tabs-administrador-100.png).

La suite completa pasó con 26 suites y 273 pruebas. Dos regresiones de `accessibility-text.test.tsx` comprueban que el área inferior se cuenta una vez, que una etiqueta de tres líneas amplía la barra y que reducir el texto elimina la altura anterior. Las pruebas existentes de navegación verifican los destinos de los cuatro roles y sus nombres accesibles. Tipos, lint, formato y ortografía de los archivos modificados también pasaron.

Al finalizar se restauró Seguir el sistema y la sesión Profesional en Agenda. TalkBack permaneció desactivado y la escala del sistema siguió en 1.0. El botón flotante de herramientas del cliente se ocultó temporalmente para no cubrir los controles y se restauró después. El cliente y el Metro preexistentes se dejaron activos.
