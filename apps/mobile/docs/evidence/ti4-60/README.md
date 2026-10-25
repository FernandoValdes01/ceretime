# TI4-60: lectura optativa de estados y confirmaciones

<!-- cspell:words googletts -->

Issue: [TI4-60](https://linear.app/ceretime/issue/TI4-60/leer-estados-y-confirmaciones-mediante-tts-sin-duplicar-anuncios-de). Preparación del 25 de octubre de 2026 sobre `main` `45d0cca`. Estado: implementación y comprobaciones locales disponibles; PR #127 en Draft. Implementación y evaluación Android completadas el 25 de octubre de 2026 con autorización y confirmación auditiva del usuario. Quedan revisión independiente e integración; la PR permanece en Draft por instrucción del usuario.

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

El texto activo y la paleta se verifican contra 4.5:1 mediante `contrastRatio`. Esto aporta comprobación automatizada acotada para [1.4.3, contraste mínimo](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html). El botón mantiene un objetivo mínimo de 44 por 52 unidades y altura flexible; el recorrido nativo de este módulo y el texto ampliado se documentan abajo, sin extender el resultado a otras pantallas.

La política evita audio automático y ofrece detención, en línea con la orientación de [1.4.2, control del audio](https://www.w3.org/WAI/WCAG22/Understanding/audio-control.html). No se atribuye aprobación de [4.1.3, mensajes de estado](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html) a un botón de lectura: los anuncios automáticos existentes siguen siendo responsabilidad de TI4-59 y su evaluación integral corresponde a la matriz por pantalla.

Se inició la validación nativa el 25 de octubre de 2026 después de que el usuario pidiera ejecutar las evaluaciones y ofreciera escuchar TalkBack. El entorno se abrió con `ceretime-mobile`, Medium_Phone con GPU host y Metro del checkout. La primera comprobación sin entorno activo queda sustituida por esta ejecución, no por la evidencia antigua de TI4-55.

## Evaluación Android de este incremento

Se usa el consumidor de diagnóstico [native-probe.tsx](./native-probe.tsx), copiado temporalmente a `apps/mobile/app/ti4-60-probe.tsx` y abierto con `ceretime://ti4-60-probe`. El hook `useSubmitStudentRequest`, el componente y el adaptador TTS son los reales. El envío es el adaptador ficticio existente, con espera de 9 segundos y primer intento fallido. Las acciones adicionales de preferencias, desmontaje y motor no disponible pertenecen al diagnóstico, no al producto.

Versión del código evaluado: `6d4556266a4cba644f612e67680c05bda435fa4a` más el consumidor temporal. Cliente Android `cl.rmv.ceretime` 1.0.0, versionCode 1, instalado el 23 de octubre de 2026; APK instalado SHA-256 `d708133823e6551b655a59320505e567029d6f586031450c5731b3eb9cc0c8d3`, obtenido al extraer el paquete instalado mediante ADB. El JavaScript se sirve desde Metro, por lo que la fecha del APK no identifica la versión del componente.

Dispositivo: Medium_Phone, `sdk_gphone16k_x86_64`, Android 17/API 37, resolución 1080 por 2400. TalkBack `17.0.0.889642762`. Motor `com.google.android.tts`, versión `googletts.google-speech-apk_20260914.02_p2.986315744`. Voces españolas disponibles de España y Estados Unidos; no se encontró voz `es-CL`. Escala inicial del sistema 1.15; se comprobó además la preferencia de texto al 200 % y alto contraste.

| Escenario                        | Resultado observado                                                                                                                                                                                                                                                        | Límite                                                                                     |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Envío en curso a fallo           | El hook pasa de submitting a error. El adaptador recibe stop al cambiar el mensaje y devuelve stopped a la lectura anterior. No se solicita lectura del mensaje nuevo.                                                                                                     | La respuesta de envío es ficticia.                                                         |
| Lectura y detener                | La lectura se inicia solo por pulsación y detener resuelve stopped. El texto permanece.                                                                                                                                                                                    | Eventos nativos más audio capturado; no se atribuye audición propia al agente.             |
| Leer mensaje de error completo   | El adaptador devuelve completed para el texto visible. Se capturó señal de audio del altavoz.                                                                                                                                                                              | No equivale a verificar TalkBack.                                                          |
| Reintento y confirmación         | El mismo hook pasa por submitting y success, con referencia SOL-DEMO. Leer y volver a enviar cancela la voz anterior, sin lectura automática.                                                                                                                              | Datos ficticios.                                                                           |
| Desmontaje                       | Durante lectura, desmontar produce stop y resultado stopped. Montar no inicia audio.                                                                                                                                                                                       | Se comprueba el módulo aislado.                                                            |
| Texto al 200 % y alto contraste  | Mensaje y botón se amplían, la etiqueta Detener lectura permanece completa y los controles se desplazan verticalmente.                                                                                                                                                     | Solo el dispositivo y escenario descritos.                                                 |
| Motor no disponible simulado     | El diagnóstico inyecta locale-voice-unavailable, conserva la confirmación y muestra el mensaje de recuperación.                                                                                                                                                            | Inyección explícita, separada del escenario nativo siguiente.                              |
| Motor nativo ausente             | Se deshabilitó temporalmente com.google.android.tts y se reinició la app. Expo devolvió una lista vacía y leer devolvió locale-voice-unavailable; el mensaje original y el aviso de recuperación quedaron visibles. Después se habilitó el motor y se reinició el cliente. | Prueba real de ausencia del motor, no de todas las averías internas posibles.              |
| TalkBack activo                  | Android informa lector activo y el componente deshabilita su TTS manteniendo el texto visible. El usuario confirmó español comprensible y una sola voz.                                                                                                                    | Confirmación del recorrido del mensaje de error, control y explicación, no de toda la app. |
| Activar TalkBack durante lectura | read-request nativo a las 20:42:27.861; evento screen-reader true y stop a las 20:42:27.964; resultado stopped a las 20:42:28.018.                                                                                                                                         | No se inició otra lectura propia.                                                          |
| Salir de la ruta durante lectura | read-request a las 20:43:00.258; salir a las 20:43:02.482 provoca stop y resultado stopped a las 20:43:02.639.                                                                                                                                                             | La salida usa navegación real de Expo Router.                                              |

### Idioma de TalkBack

El primer entorno tenía `system_locales=en-US` y no tenía `tts_default_locale` ni `tts_default_synth` fijados. El usuario informó que TalkBack pronunciaba español con acento inglés. Se ajustó el emulador a `es-CL` mediante `cmd locale set-device-locale es-CL`, el motor a `com.google.android.tts`, su idioma a `com.google.android.tts:es-ES` y velocidad a 100. Es un ajuste del emulador; la app no cambia las preferencias de voz del usuario. La voz propia de la app ya seleccionaba una voz española mediante el adaptador de TI4-55.

Se repitió el mensaje de error con TalkBack activo, usando exploración táctil del mensaje, el botón de lectura inhabilitado y la explicación del lector. El usuario confirmó: "Sí, ahora se entiende en español y hay una sola voz". Esta confirmación corresponde al mensaje "No pudimos enviar la solicitud ficticia. Puedes reintentar", el control de lectura y la explicación del lector del sistema. No se atribuye una reparación de un teléfono físico: el único dispositivo conectado es el emulador. Android permite elegir motor e idioma desde los [ajustes de salida de texto a voz](https://support.google.com/accessibility/android/answer/6006983).

### Capturas

- [Lectura explícita del mensaje de error](./android-error-reading.png).
- [Texto al 200 % y alto contraste durante lectura](./android-contrast-200-reading.png).
- [Fallo real por motor ausente](./android-native-engine-unavailable.png).
- [TalkBack con idioma español](./android-talkback-spanish.png) y [texto al 200 % con TalkBack](./android-talkback-text-200.png).
- [Fragmento TTS](./android-tts.mp3), [recorrido de TalkBack en español](./android-talkback-spanish.mp3) y [eventos nativos](./native-events.txt).

### Evidencia y repetición

La captura de audio inicial se tomó del monitor del altavoz del host, con duración de 45 segundos, volumen medio de -30.6 dB y máximo de -9.5 dB. Contiene los escenarios de lectura y detención del texto ficticio; se conserva solo el fragmento relevante. Una señal de audio o captura de pantalla no demuestra por sí sola el contenido oído.

Para evaluar TalkBack se usan gestos táctiles y capturas. `uiautomator dump` interrumpe temporalmente los servicios de accesibilidad en este entorno y produjo eventos false/true durante la preparación; esos cambios no se atribuyen a una acción de la app ni se usan como evidencia de convivencia. No se ejecuta esa herramienta durante el recorrido auditivo.

Al repetir, registrar versión completa, hash del consumidor servido, configuración y pasos. Separar lo oído por una persona, lo observado en pantalla, los eventos nativos y los fallos inyectados. La ruta temporal se retiró al finalizar y el consumidor queda conservado junto a esta evidencia. Se restauró la escala de texto de la app al sistema y el contraste al sistema, con font_scale del dispositivo conservado en 1.15. El motor quedó habilitado y TalkBack apagado tras las pruebas. Se conserva Español (Chile) y la voz española por petición del usuario.

El consumidor inicial tenía SHA-256 `c86b8ab50c3e93d91638ac8e292700d1ce097f76f5c41b1a68b0d7876b0bf130`; después de normalizar formato, el servido en la repetición final y conservado en esta carpeta tiene SHA-256 `bd197ac077d9d2e1b0cfa6a44f432372a5d012d4d946cdf13e3335e5a26c30b0`. El componente de producto permanece en el commit evaluado; el formato del consumidor no cambió su comportamiento.

## Revisión del impacto

El contrato de voz y el adaptador permanecen iguales. El único consumidor del nuevo componente es el consumidor de prueba permitido por la issue. La comprobación clave es que actualizar el mensaje interrumpe la lectura antigua sin comenzar otra: la prueba `cancels stale messages and ignores their delayed completion` ejecuta el componente real y verifica detención, ausencia de reproducción adicional y descarte del fallo tardío. La revisión independiente estática no encontró defectos concretos de cancelación o TalkBack; señaló correctamente que no hay montaje productivo. No se modificaron pantallas, backend, web ni los controles de comandos de voz. La compatibilidad con comandos y envío existente se contrastó con sus suites.
