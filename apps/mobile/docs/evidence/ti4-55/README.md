# TI4-55: especificación y evidencia de síntesis de voz

Estado: implementación terminada; pruebas automatizadas y recorridos nativos Android ejecutados. La [PR #117](https://github.com/FernandoValdes01/ceretime/pull/117) permanece en Draft; falta su integración y queda pendiente inducir un fallo real del motor TTS en Android.

Fuente operativa: [TI4-55 en Linear](https://linear.app/ceretime/issue/TI4-55). Responsable: Fernando Valdés. Entrega: 22 de octubre de 2026. Estimación registrada: 2 prismas. No tiene bloqueos registrados y desbloquea TI4-60.

Base local de preparación: `main`, commit `36a2524`. La descripción de Linear cita una base histórica `a025299`; la rama actual se preparó sobre el `main` vigente. Mobile usa Expo `~57.0.26` y no incluía una dependencia TTS.

## Selección técnica

La documentación oficial de [Expo Speech para SDK 57](https://docs.expo.dev/versions/v57.0.0/sdk/speech/) recomienda `expo-speech ~57.0.3`, que lista las voces disponibles, permite seleccionar una por idioma, detener la lectura y recibir eventos de finalización/error. En Android `speak` agrega textos a la cola, `stop` corta la locución y vacía la cola, y pausa/reanudación no están disponibles. Se instaló `~57.0.3`; la biblioteca no requiere permisos de micrófono ni una entrada de plugin o configuración Android para TTS.

En el emulador Medium_Phone (Android 17, API 37), Google Text-to-Speech ofreció voces `es-ES` y `es-US`, pero no `es-CL`; el adaptador seleccionó una voz local `es-ES`. La salida capturada desde el monitor del altavoz contiene audio durante la lectura y se incluye como `android-tts.mp3`. El adaptador prefiere `es-CL`, después `es-ES` y luego otra voz cuyo idioma comience con `es`; devuelve voz española no disponible sin intentar leer. Antes de iniciar una lectura limpia la anterior. Los controles suspenden el TTS propio cuando React Native detecta un lector de pantalla y mantienen el texto disponible para TalkBack.

## Resultado esperado

Determinar con pruebas nativas Android si es viable leer texto ficticio en español, detener la lectura y convivir con TalkBack sin lectura automática duplicada. Entregar una capacidad mínima reutilizable por TI4-60, una alternativa visual y táctil y una decisión sustentada en evidencia. Instalar una biblioteca o aprobar pruebas con simulaciones no demuestra funcionamiento nativo.

Una conclusión de no viabilidad también debe sustentarse en pruebas y describir las limitaciones y la alternativa. No se debe presentar la capacidad como disponible si no funciona, ni dar por resuelta una prueba que no se pudo ejecutar.

## Alcance y límites

1. Evaluar un proveedor compatible con la versión real de Expo y Android del proyecto. Consultar documentación oficial versionada antes de elegirlo; registrar versión, requisitos de compilación, configuración, permisos y disponibilidad de voces españolas. No presumir funcionamiento sin conexión ni permisos innecesarios.
2. Implementar únicamente el contrato y adaptador mínimos para probar lectura explícita, interrupción, finalización y errores. El reconocimiento de voz se añadirá en TI4-56 como capacidad independiente.
3. Definir y probar una política de convivencia con TalkBack. No activar lecturas automáticamente al entrar, cambiar foco o actualizar una vista. La política exacta para lectura explícita con TalkBack queda pendiente de la evaluación nativa y debe documentarse antes del cierre.
4. Mantener el texto visible y los controles táctiles utilizables cuando la voz esté deshabilitada, no esté disponible o falle. Si se incorporan controles, comprobar nombres accesibles, foco y texto ampliado.
5. Entregar pruebas focalizadas, evidencia reproducible y condiciones de reutilización para TI4-60.

Quedan fuera la lectura final de estados y confirmaciones de TI4-60, el reconocimiento de voz y su analizador de TI4-56, el dictado, los comandos, las reglas de negocio y los datos reales. No modificar RequestForm, vistas de estudiante o gestión, `apps/web/` ni `convex/`. No crear servicios, almacenes, contratos de solicitud o carpetas paralelos.

## Archivos y responsabilidades

| Ubicación                                                               | Responsabilidad                                                                                                                        |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/mobile/src/application/speech-port.ts`                            | Contrato mínimo de síntesis y detención, independiente de React, Expo y Convex. TI4-56 añadirá reconocimiento como capacidad separada. |
| `apps/mobile/src/infrastructure/native-speech-adapter.ts`               | Integración del proveedor, idioma, interrupción, finalización y errores. TI4-60 extenderá este mismo adaptador.                        |
| `apps/mobile/src/composition/mobile-dependencies.ts`                    | Componer e inyectar el adaptador a través del puerto.                                                                                  |
| `apps/mobile/src/presentation/accessibility/speech-controls.tsx`        | Controles reutilizables accesibles con alternativa táctil. El consumidor mantiene el texto leído visible y accesible en su pantalla.   |
| `apps/mobile/package.json`, archivo de bloqueo y `apps/mobile/app.json` | Dependencia y configuración estrictamente requeridas por el proveedor elegido.                                                         |
| `apps/mobile/src/presentation/components/screen.tsx`                    | Reutilizar o ajustar solo si la prueba requiere un punto de integración transversal mínimo.                                            |
| `apps/mobile/__tests__/*.test.tsx`                                      | Pruebas focalizadas del contrato, adaptador y consumidor que se incorporen.                                                            |
| Este documento                                                          | Decisión, requisitos, pasos, resultados y enlaces a evidencia Android.                                                                 |

No es obligatorio editar cada archivo listado. Mantener Application e Infrastructure con archivos planos y reutilizar los componentes existentes. No cambiar instrucciones de `apps/mobile/AGENTS.md` para eludir restricciones de ejecución.

## Criterios de aceptación verificables

Los siguientes escenarios concretan los requisitos de Linear sin ampliar la tarea. El resultado de cada criterio aparece en la matriz de ejecución que sigue.

| ID    | Escenario                       | Resultado exigido                                                                                                                                                                                                    | Evidencia necesaria                                                                                             |
| ----- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| CA-01 | Compatibilidad                  | El proveedor y su versión funcionan en una compilación Android compatible con Expo 57. Se registran configuración, permisos y requisitos de voz.                                                                     | Referencias oficiales, identificación de compilación y prueba nativa.                                           |
| CA-02 | Lectura explícita en español    | Una acción del usuario inicia lectura audible en español de un texto ficticio con tildes y puntuación. La finalización deja el control en estado coherente. No empieza al montar la vista.                           | Prueba automatizada de invocación y registro nativo con verificación audible.                                   |
| CA-03 | Detener y volver a leer         | Detener durante una lectura la interrumpe. Una lectura posterior funciona y no reproduce contenido pendiente de la anterior.                                                                                         | Prueba focalizada y ejecución Android.                                                                          |
| CA-04 | Salida y desmontaje             | Salir del consumidor detiene su lectura; sus respuestas tardías no reactivan audio ni actualizan un consumidor desmontado.                                                                                           | Prueba de limpieza y recorrido Android.                                                                         |
| CA-05 | Fallo y falta de disponibilidad | Un error del motor o voz española no disponible no bloquea la pantalla ni produce un falso éxito. El texto y la alternativa táctil siguen disponibles y el mensaje es seguro.                                        | Pruebas de error; registrar si el fallo se indujo o se observó realmente en Android.                            |
| CA-06 | TalkBack                        | Con TalkBack activo e inactivo se verifica la política documentada. La app no inicia lectura automática duplicada ni superpone deliberadamente anuncios del mismo contenido. Los controles siguen siendo accesibles. | Recorrido Android con observación audible y estado de TalkBack registrado. Una captura sola no demuestra audio. |
| CA-07 | Texto ampliado                  | Los controles añadidos y su texto permanecen legibles y utilizables con texto ampliado, sin ocultar la acción de detener.                                                                                            | Evidencia Android con la escala utilizada.                                                                      |
| CA-08 | Reutilización y capas           | TI4-60 puede consumir el mismo puerto y adaptador. Application no importa React, Expo ni Convex. El consumidor usa el puerto y no aparece un segundo motor o contrato equivalente.                                   | Revisión del diff, tipos y pruebas.                                                                             |
| CA-09 | Privacidad                      | Las pruebas usan texto ficticio. La evidencia y los errores no contienen datos sensibles. Se documenta cualquier procesamiento externo requerido por el proveedor.                                                   | Revisión de configuración, registros y artefactos.                                                              |
| CA-10 | Entrega                         | Hay decisión viable o no viable, pasos reproducibles, limitaciones, PR, commit y comprobaciones reales. El cambio se integra mediante PR con las verificaciones necesarias aprobadas.                                | Enlaces a PR, commit y CI, además de evidencia nativa.                                                          |

No afirmar conformidad WCAG general por superar estos casos. Identificar los criterios aplicables y los pendientes según las matrices existentes.

## Resultados de ejecución Android

| ID    | Estado   | Resultado observado                                                                                                                                                            |
| ----- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| CA-01 | Aprobado | `expo-speech 57.0.3` quedó enlazado en `:app:installDebug` bajo Expo 57; Android 17/API 37 cargó el módulo sin permisos de micrófono ni configuración adicional.               |
| CA-02 | Aprobado | El toque explícito leyó texto ficticio en español; el callback terminó en `completed` y el botón volvió a `Leer en voz alta`. El clip `android-tts.mp3` contiene audio.        |
| CA-03 | Aprobado | Un segundo toque durante una lectura larga devolvió `stopped`; una lectura posterior completó el texto desde el inicio. No se observó audio antiguo en cola.                   |
| CA-04 | Aprobado | Salir con el botón Atrás durante una lectura cerró la pantalla; AudioFlinger reportó cero pistas activas después de la salida.                                                 |
| CA-05 | Parcial  | Voz no disponible, error del proveedor y texto sobre el límite están cubiertos con simulaciones; no se indujo un fallo real del motor en Android.                              |
| CA-06 | Aprobado | Con TalkBack enlazado y `touchExplorationEnabled=true`, el control se deshabilitó visualmente, apareció la indicación del texto visible y el doble toque no inició TTS propio. |
| CA-07 | Aprobado | Con `font_scale=1.4`, texto y botón siguieron visibles y el objetivo táctil respondió; evidencia en `android-font-scale.png`.                                                  |
| CA-08 | Aprobado | Application depende solo de `SpeechPort`; la composición instala un único adaptador nativo. Verificado por tipos y revisión del diff.                                          |
| CA-09 | Aprobado | Se usó texto ficticio y la voz local del sistema; no se añadieron permisos, servicios remotos ni registros con contenido sensible.                                             |
| CA-10 | Parcial  | La [PR #117](https://github.com/FernandoValdes01/ceretime/pull/117) está abierta en Draft. La integración queda pendiente; el estado de CI está enlazado en la PR.             |

El entorno fue `Medium_Phone` (imagen `sdk_gphone16k_x86_64`), Android 17/API 37, Expo SDK 57 y `com.google.android.tts`. La lista nativa incluyó voces `es-ES` y `es-US`; no incluyó `es-CL`. Los identificadores locales `es-es-x-eef-local` y `es-es-x-eee-local` aparecieron en consultas distintas, por lo que la prueba verifica preferencia de idioma, no un identificador fijo.

La captura de audio se hizo desde el monitor del altavoz del host mientras la app pronunciaba el texto ficticio. El PCM tuvo 25.94 segundos, `mean_volume=-33.3 dB` y `max_volume=-13.3 dB`; se detectó señal en los intervalos 8.80–12.62 y 13.35–15.97 segundos, coincidentes con la locución iniciada desde el botón. El MP3 es un recorte de 8 segundos para revisión manual.

Las capturas `android-TalkBack.png` y `android-font-scale.png` corresponden a una ruta de diagnóstico temporal, no a una pantalla de producto. El código que la genera está en `native-probe.tsx`; para repetir la prueba, coloca temporalmente ese archivo en `apps/mobile/app/ti4-55-probe.tsx`, instala la build Android desde `apps/mobile/android` con `./gradlew :app:installDebug`, abre `ceretime://ti4-55-probe` y elimina la ruta al terminar.

## Plan de ejecución

1. Contrastar documentación oficial de Expo 57 y del proveedor con las versiones instaladas; elección y requisitos nativos registrados.
2. Añadir el puerto mínimo, el adaptador y su composición; el control visual queda reutilizable y mantiene el texto visible.
3. Probar lectura, finalización, error, interrupción y limpieza con simulaciones controladas; las lecturas consecutivas no dejan una cola antigua.
4. Ejecutar la matriz en Android con TalkBack desactivado y activado y con texto ampliado; resultados observados y simulados separados.
5. Completar evidencia, verificar el diff y los controles de calidad, y entregar la PR #117 en Draft para revisión.

## Validaciones de la implementación

Desde la raíz:

```sh
bun run --cwd apps/mobile typecheck
bun run --cwd apps/mobile test --runTestsByPath <ruta-real-de-la-prueba>
bun run lint
bun run format:check
bunx --package cspell --package @cspell/dict-es-es cspell lint --no-progress <archivo-editado>
```

Sustituir los marcadores por rutas existentes al implementar. Si falla el formato, ejecutar `bun run format` y repetir lint y formato. Ejecutar la revisión ortográfica sobre los archivos de texto editados. No se requiere una compilación Web o modificación de Backend para esta tarea.

La validación de voz exige Android nativo, nunca Expo Web como sustituto. El 15 de octubre de 2026 se ejecutó con el emulador Medium_Phone y Metro de esta rama, tras recibir autorización explícita para probarla. El primer arranque detectó un cliente Android instalado antes de añadir ExpoSpeech; `./gradlew :app:installDebug` instaló la build actual y permitió completar el recorrido.

## Validaciones realizadas

- Pruebas focalizadas actuales: `bun run --cwd apps/mobile test --runTestsByPath __tests__/speech.test.tsx`, 11 pruebas aprobadas, incluida la carrera entre la consulta asíncrona y el evento de TalkBack.
- Build Android nativa: `./gradlew :app:installDebug` desde `apps/mobile/android`, BUILD SUCCESSFUL; APK instalado en Medium_Phone.
- Suite Mobile completa: 17 suites y 165 pruebas aprobadas; quedan warnings `act(...)` preexistentes en `professional-accompaniments.test.tsx`.
- Typecheck, `bun run lint` y `bun run format:check`: aprobados.
- Ortografía de la evidencia: `bunx cspell lint --no-progress .../README.md .../native-probe.tsx`, sin hallazgos.
- Evidencia: `android-tts.mp3`, `android-TalkBack.png` y `android-font-scale.png`; el código de probe se conserva en `native-probe.tsx` y no queda registrado como ruta de producto.
- Compatibilidad probada para Android 17/API 37; no se afirma compatibilidad de runtime con otras versiones Android que no se ejecutaron.
- Fallo real del motor TTS en Android no inducido; la falta de voz, excepción y texto fuera del límite se cubren solo con mocks.
- [PR #117](https://github.com/FernandoValdes01/ceretime/pull/117) sigue en Draft y no está integrada; el estado de los checks del commit publicado queda visible en esa página.

La prueba confirma viabilidad para síntesis explícita en el emulador y deja las limitaciones anteriores acotadas. No equivale a certificación WCAG ni a validación en dispositivos físicos o versiones Android no probadas.
