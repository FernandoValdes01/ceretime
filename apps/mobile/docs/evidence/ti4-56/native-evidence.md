# Prueba nativa de reconocimiento local

Fecha: 22 de octubre de 2026. Issue: [TI4-56](https://linear.app/ceretime/issue/TI4-56). PR: [#124](https://github.com/FernandoValdes01/ceretime/pull/124).

## Entorno y método

Se usó Medium_Phone con GPU host, Android 17/API 37, arquitectura x86_64, aplicación `cl.rmv.ceretime`, Expo 57, React Native 0.86.3 y `expo-speech-recognition` 57.1.1 con el parche de privacidad del repositorio. El atajo `ceretime-mobile` inició el entorno autorizado por el usuario; se desactivó Vulkan mediante `ANDROID_EMULATOR_FEATURES=-Vulkan` para resolver un bloqueo gráfico del emulador.

La base del adaptador probada es `efb46e8`; el consumidor integrado de TI4-61 se ejecutó desde `f3b95c6f4e69b1a4832d2bebde3460f465b17596`. La compilación `:app:assembleDebug -PreactNativeArchitectures=x86_64 --console=plain`, con Java 21 y Android SDK local, terminó correctamente en 2 min 59 s: 515 tareas ejecutadas. SHA-256 del APK instalado: `d708133823e6551b655a59320505e567029d6f586031450c5731b3eb9cc0c8d3`.

El SDK real informó reconocimiento disponible y capacidad local. Inicialmente solo había `en-US`; se instaló `es-ES` mediante `androidTriggerOfflineModelDownload({ locale: "es-ES" })` y el diálogo nativo descargó 49,31 MB. Luego se desactivaron Wi-Fi y datos móviles; `wifi_on=0` y `mobile_data=0`. Metro permaneció accesible mediante `adb reverse tcp:8081 tcp:8081`.

La voz fue sintética en español, transmitida por un micrófono virtual del anfitrión al emulador. No se simularon respuestas del SDK. No se guardaron audio ni transcripciones; las capturas muestran estados o intenciones. Esta prueba comprueba el recorrido nativo, no la precisión con voces humanas.

## Resultados observados

| Caso                              | Resultado real                                                                                           | Evidencia                                                                                          |
| --------------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Primer uso                        | Android solicita permiso de micrófono                                                                    | [Diálogo](android-permission-prompt.png)                                                           |
| Permiso rechazado                 | El diagnóstico informa permiso denegado                                                                  | [Denegación](android-permission-denied.png)                                                        |
| Español ausente                   | Se rechaza el reconocimiento; no se recurre al proveedor remoto                                          | [Modelo ausente](android-no-spanish-model.png)                                                     |
| «Abrir solicitudes» sin red       | Se interpreta abrir solicitudes                                                                          | [Intención](android-open-command.png)                                                              |
| «Cancelar» sin red                | Se interpreta cancelar                                                                                   | [Intención](android-cancel-command.png)                                                            |
| Silencio                          | Se informa que no se detectó voz; la sesión tiene un límite de 12 s desde el inicio nativo               | [Silencio](android-silence.png)                                                                    |
| Tres intenciones en el consumidor | Abrir llega a la lista existente; «regresar» vuelve al inicio; cancelar cierra solo la interacción local | [Evidencia de TI4-61 en la PR apilada #125](https://github.com/FernandoValdes01/ceretime/pull/125) |
| Frase literal «volver»            | Una muestra sintética resultó desconocida y no navegó                                                    | Matriz de TI4-61; no se declara reconocimiento fiable de esa frase                                 |
| TalkBack y texto al 160 %         | Servicio activo y enlazado, foco visible por teclado, botones completos y cancelación táctil utilizable  | Matriz de TI4-61; no se verificaron gestos manuales de TalkBack                                    |

Las primeras muestras sintéticas de menor amplitud produjeron silencio con frecuencia. Se añadió un límite de 12 s ante ausencia de resultado nativo y se configuró `EXTRA_LANGUAGE_MODEL: "web_search"`, recomendado por el proveedor instalado para palabras breves. Se conserva `requiresOnDeviceRecognition: true` y no se habilita persistencia de grabaciones. El límite se inicia después de `start`, por lo que no consume el tiempo del diálogo de permiso. Al detener, el adaptador espera el cierre nativo antes de permitir otra sesión; si el cierre falla, exige reiniciar la app.

## Reproducción

Compilar e instalar el desarrollo nativo, iniciar el entorno con `ceretime-mobile` y montar temporalmente el wrapper diagnóstico descrito en el README. Consultar `isRecognitionAvailable()`, `supportsOnDeviceRecognition()` y `getSupportedLocales()` del SDK; instalar español desde el diálogo nativo si falta. Conceder o rechazar el permiso real y repetir con Wi-Fi y datos desactivados. Mantener Metro por el puerto invertido de ADB.

Para reproducir la entrada sintética, conectar el monitor de un dispositivo de audio virtual al micrófono del emulador y transmitir sin crear archivos:

```sh
espeak-ng --stdout -v es -s 120 -a 180 'abrir solicitudes' | ffmpeg -loglevel error -i pipe:0 -af adelay=1000 -f s16le -ar 16000 -ac 1 pipe:1 | pacat --playback --device=ceretime_stt_test --rate=16000 --channels=1 --format=s16le
```

Repetir con «regresar» y «cancelar», además de silencio y una frase desconocida. La reproducción de audio y la captura del micrófono deben permanecer activas durante la escucha. No confundir el resultado del parser con la precisión del motor acústico.

Al terminar se retiraron las rutas temporales, se devolvió la app al acceso público, se restauraron Wi-Fi y datos, tamaño de texto 1,15, TalkBack desactivado y la fuente original del micrófono. Se eliminó el dispositivo virtual de audio. El modelo español permanece instalado.

## Validación y límites

La suite final del consumidor integrado pasó: 25 suites, 252 pruebas. Incluye 20 del adaptador, 13 del parser y 7 del diagnóstico; las 11 pruebas de TTS existentes siguen pasando. Las pruebas unitarias cubren eventos tardíos; la prueba nativa de cancelar y emitir audio después comprobó ausencia de navegación, sin afirmar que el proveedor haya emitido un callback tardío.

El recorrido local es viable para las tres intenciones probadas en este entorno con español instalado. La variación de «volver», la voz sintética y el único emulador impiden generalizar precisión, accesibilidad o compatibilidad a todos los dispositivos. No se probó iOS ni un teléfono físico. No hay dictado de campos ni operaciones de negocio por voz.
