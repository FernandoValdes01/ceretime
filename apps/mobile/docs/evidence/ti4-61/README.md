# Evidencia TI4-61: comandos locales probados en Android

La PR draft [#125](https://github.com/FernandoValdes01/ceretime/pull/125) apila TI4-61 sobre la PR draft [#124 de TI4-56](https://github.com/FernandoValdes01/ceretime/pull/124). Esta evidencia registra recorridos nativos en el emulador Android y separa las observaciones de las limitaciones de reconocimiento.

## Resultado

En Android 17/API 37, el comando sintético «abrir solicitudes» abrió la lista canónica con fixtures, «regresar» ejecutó `router.back()` y «cancelar» cerró solo los controles locales. La frase sintética «volver» quedó como desconocida en esta ejecución; no se afirma reconocimiento fiable de voz humana ni exactitud general para esa frase.

El permiso denegado y la frase desconocida conservaron visibles los controles táctiles; una cancelación táctil durante la escucha impidió que el audio posterior abriera solicitudes. Con TalkBack activo, texto ampliado y foco de navegación se verificaron los controles visibles; el alcance observado y sus límites están en [native-evidence.md](./native-evidence.md).

Desde la ruta normal `/estudiante`, el botón «Comandos de voz» abre el panel con los tres comandos y sus equivalentes táctiles. Las pruebas de navegación comprueban que «abrir solicitudes» lleva a `/estudiante/solicitudes`, «volver» regresa a `/estudiante` y «cancelar» cierra solo el panel local. Con permiso denegado, silencio, frase desconocida o fallo, los tres botones permanecen habilitados y la navegación táctil sigue disponible.

La prueba de silencio de 12 segundos pertenece al puerto y límite de escucha compartidos con TI4-56; agotó el tiempo sin ejecutar acciones. La evidencia visual y la traza reproducible están en [native-evidence.md](./native-evidence.md).

## Alcance y privacidad

El cambio reutiliza `speech-port.ts`, `speech-command-parser.ts`, `native-speech-recognition-adapter.ts`, `speech-controls.tsx` y `mobile-dependencies.ts`; el plugin y parche del proveedor mantienen el reconocimiento local y sin registros de transcripciones. La navegación se limita a `open-requests`, `back` y `cancel`. `SpeechCommandLauncher` se monta en el layout del estudiante, de modo que el botón «Comandos de voz» está disponible en las rutas normales del rol sin editar formularios ni pantallas de gestión. Los probes de `apps/mobile/app/ti4-56-probe.tsx` y `apps/mobile/app/ti4-61-probe.tsx` fueron rutas temporales y se retiraron del árbol de producto después de capturar evidencia.

Se usó voz sintética enviada en vivo al micrófono del emulador; no se guardaron archivos de audio ni transcripciones. La implementación nativa elimina los registros del proveedor que podían escribir transcripciones en el registro del sistema Android.

La compilación y prueba descritas corresponden a un emulador Android, a un modelo local español instalado y a entrada de voz sintética; no validan dispositivos físicos, iOS, otros modelos/versiones Android ni la pronunciación de personas.

## Validación automatizada

La suite Mobile combinada se ejecutó con `bun run --cwd apps/mobile test`: 26 suites y 258 pruebas aprobadas. El resultado comprueba los casos automatizados de parser, adaptador, controles y navegación desde `/estudiante`, incluidos permiso denegado, silencio, frase desconocida y fallo; la evidencia nativa por separado está resumida en [native-evidence.md](./native-evidence.md).
