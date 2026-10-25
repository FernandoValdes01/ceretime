# TI4-60: lectura optativa de estados y confirmaciones

Issue: [TI4-60](https://linear.app/ceretime/issue/TI4-60/leer-estados-y-confirmaciones-mediante-tts-sin-duplicar-anuncios-de). Preparación del 25 de octubre de 2026 sobre `main` `45d0cca`. Estado: implementación y comprobaciones locales disponibles; entrega en PR Draft, sin integración ni validación Android de este incremento.

## Qué se pidió y qué se entrega

Leer estados y confirmaciones existentes bajo petición, permitir detener la voz y conservar el texto cuando el motor falla. Se reutilizan `SpeechPort`, el adaptador de Expo Speech de TI4-55 y las preferencias compartidas. No se agrega motor, dependencia, permiso ni API.

`StudentRequestSpeechControls`, en `src/presentation/accessibility/speech-controls.tsx`, recibe `status` y `receipt` del estado canónico de `useSubmitStudentRequest`. Presenta envío en curso, fallo recuperable y confirmación con referencia ficticia. En reposo o sin comprobante no inventa una confirmación. No conserva otro estado de negocio ni muestra errores internos o necesidades personales.

`SpeechControls` muestra el mismo texto que entrega a la voz. El botón permite leer/detener; no comienza audio al montar o cambiar el mensaje. Con TalkBack detectado, el TTS propio queda deshabilitado y el texto sigue disponible para el lector del sistema. También se bloquea preventivamente mientras se consulta el lector o si falla la consulta.

Cambiar el mensaje, salir de la ruta o desmontar interrumpe el audio e invalida respuestas anteriores. Los fallos tardíos de una detención anterior no reemplazan el estado de una lectura nueva. El texto y el botón reutilizan `StudentText` y la paleta compartida para respetar ampliación y alto contraste.

## Consumidor y límites

La prueba `consumes real submission hook transitions without speaking automatically or exposing errors` monta un consumidor con el hook real `useSubmitStudentRequest`, un puerto de envío simulado y el módulo nuevo. Recorre reposo, envío, confirmación y error. Comprueba que solo se lee por pulsación y que el comprobante anterior desaparece ante un nuevo fallo.

Este consumidor es de prueba, no una pantalla publicada. La issue excluye editar RequestForm y pantallas ajenas durante S4 y pide demostrar consumo del estado existente inyectado. Por eso no se monta el módulo en esas pantallas ni se reemplazan sus anuncios automáticos de TI4-59. La lectura optativa no sustituye los anuncios de estado accesibles.

## Comprobaciones locales

- `bun install --frozen-lockfile`: correcto, sin cambios en dependencias ni archivo de bloqueo. Instaló dependencias ya declaradas que faltaban en el entorno.
- `bun run --cwd apps/mobile typecheck`: correcto.
- `bun run --cwd apps/mobile test --runTestsByPath __tests__/speech.test.tsx __tests__/speech-command-controls.test.tsx __tests__/student-request.test.tsx __tests__/accessibility-color-palette.test.tsx`: 4 suites, 58 pruebas correctas. La suite de solicitud emite avisos de Reanimated sobre reducción de movimiento; no son evidencia Android.
- `bun run lint` y `bun run format:check`: correctos al cierre.
- `bunx --package @cspell/dict-es-es --package cspell cspell lint --no-progress` aplicado a los tres archivos de este cambio: 3 archivos comprobados, 0 problemas. Con Bun 1.4, el orden indicado por la issue no encontró el ejecutable; invertir los paquetes permitió ejecutar el mismo corrector y diccionario sin cambiar el proyecto.

Las pruebas de voz cubren el adaptador existente, selección de español, ausencia de voz, límite de longitud, fallo nativo, interrupción, cancelación durante búsqueda de voces y rechazo de detención. Las del componente cubren TalkBack, consulta obsoleta/fallida, lectura/detención, salida, cambio de mensaje, respuesta tardía, consumidor real del hook y contraste básico. El motor y AccessibilityInfo están simulados en Jest; estas pruebas no acreditan audio real.

## WCAG AA y evidencia pendiente

La [matriz única WCAG](../../accessibility/wcag-matrix.md) conserva resultados por pantalla, criterio y versión. Hay evidencia histórica, criterios sin probar y barreras pendientes de repetición en TI4-64. Este incremento no cambia sus veredictos ni declara conformidad global.

El texto activo y la paleta se verifican contra 4.5:1 mediante `contrastRatio`. Esto aporta comprobación automatizada acotada para [1.4.3, contraste mínimo](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html). El botón mantiene un objetivo mínimo de 44 por 52 unidades y altura flexible; faltan recorrido nativo, foco y texto ampliado para evaluar la presentación final.

La política evita audio automático y ofrece detención, en línea con la orientación de [1.4.2, control del audio](https://www.w3.org/WAI/WCAG22/Understanding/audio-control.html). No se atribuye aprobación de [4.1.3, mensajes de estado](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html) a un botón de lectura: los anuncios automáticos existentes siguen siendo responsabilidad de TI4-59 y deben verificarse en Android.

No se ejecutó validación nativa nueva. `adb devices`, usando `/home/corvo/Android/Sdk/platform-tools/adb`, no encontró dispositivos; la inspección de puertos no encontró Metro en 8081/8082. No se inició emulador, Expo ni Metro. `apps/mobile/AGENTS.md` y la propia issue exigen una petición explícita para iniciar servidores; la instrucción de trabajo autónomo no menciona iniciarlos. La evidencia de TI4-55 pertenece a otro incremento y no se reutiliza como aprobación de este.

Antes de solicitar revisión final, validar el consumidor de prueba en Android con el mismo motor de TI4-55 y datos ficticios:

1. Registrar commit completo, estado del árbol, APK, dispositivo, Android, TalkBack, escala de fuente y configuración.
2. Con TalkBack apagado, cambiar envío a confirmación y error. Comprobar texto idéntico a la lectura explícita y ausencia de audio automático.
3. Leer y detener, cambiar el mensaje durante lectura, salir y desmontar. Confirmar auditivamente que cesa y no reaparece la voz anterior.
4. Activar TalkBack antes y durante una lectura. Confirmar que se detiene el TTS propio y que el texto y controles se recorren con gestos reales sin voces simultáneas.
5. Probar texto al 200 %, alto contraste y ausencia/fallo del motor. Verificar que detener sigue visible y operable y que el mensaje se conserva. Adjuntar pasos, observado y evidencia auditiva/visual revisada.

## Revisión del impacto

El contrato de voz y el adaptador permanecen iguales. El único consumidor del nuevo componente es el consumidor de prueba permitido por la issue. La comprobación clave es que actualizar el mensaje interrumpe la lectura antigua sin comenzar otra: la prueba `cancels stale messages and ignores their delayed completion` ejecuta el componente real y verifica detención, ausencia de reproducción adicional y descarte del fallo tardío. La revisión independiente estática no encontró defectos concretos de cancelación o TalkBack; señaló correctamente que no hay montaje productivo. No se modificaron pantallas, backend, web ni los controles de comandos de voz. La compatibilidad con comandos y envío existente se contrastó con sus suites.
