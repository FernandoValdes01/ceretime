# TI4-63: validación del flujo guiado en Android

<!-- cspell:words samsung -->

Issue: [TI4-63](https://linear.app/ceretime/issue/TI4-63). Evaluación del 28 de octubre de 2026 sobre `ca097570cd0152d1a53d2d4b431b9e339cc51b17`, que incluye TI4-62. La evaluación inicial usó exclusivamente datos ficticios y el envío simulado, sin modificar implementación, contratos, backend ni estados de Linear. Las correcciones de UI solicitadas después por el usuario se registran al final.

## Resultado

Se completó la guía nativa de cinco pasos con TalkBack, resumen, retorno para editar, fallo y reintento. El usuario confirmó auditivamente el error del medio de información, el anuncio del resumen, el fallo con opción de reintentar, la relectura de la confirmación y, en una repetición pausada, el anuncio automático de éxito. Se completó también la ruta mediante pulsaciones y desplazamientos con TalkBack apagado, texto al 200 %, alto contraste y reducción de movimiento seleccionada.

La evaluación detectó que Nueva solicitud podía reabrir el comprobante anterior dentro de la misma sesión. Se registra para TI4-62 y no se corrige desde esta issue de evidencia. El informe distingue comprobaciones aprobadas, fallos y capacidades no probadas; no declara conformidad WCAG general ni sustituye la [matriz compartida](../../accessibility/wcag-matrix.md). La entrega permanece en borrador para revisar el hallazgo y los límites descritos abajo.

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

## Hallazgo para TI4-62

**Fallido: reapertura de Nueva solicitud después de un envío confirmado.** En la misma sesión, regresar desde el comprobante al inicio y pulsar Nueva solicitud volvió a mostrar SOL-DEMO-006 en lugar de los campos iniciales. [Evidencia al 200 %](./09-nueva-solicitud-conserva-confirmacion.png). Fue necesario cerrar y volver a abrir la sesión simulada para comenzar la pasada táctil con un formulario vacío.

Repetir sobre la ruta canónica `/estudiante/nueva-solicitud`, sin usar el botón de herramientas del cliente. Revisar la conservación de la pantalla oculta en `student-layout.tsx` y del estado de éxito en `use-submit-student-request.ts`. Atribución propuesta: TI4-62, responsable del flujo guiado; coordinar la corrección y repetir este escenario sin crear otro formulario, almacén o contrato. Esta evidencia no modifica la issue ni implementa una corrección fuera de alcance.

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

Las capturas 01–16 conservan sus resultados históricos y no se presentan como pruebas de la corrección. El hallazgo de reapertura del comprobante y los límites del recorrido inicial siguen pendientes. Al terminar esta repetición se restauró Seguir el sistema, se cerró el cliente, se retiró la redirección USB y se detuvo Metro. Los resultados de comprobaciones y la revisión del nuevo diff quedan en la PR.
