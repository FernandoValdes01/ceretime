# TI4-55: especificación y evidencia de síntesis de voz

Estado: implementación y pruebas automatizadas preparadas; validación nativa Android con TTS y TalkBack pendiente. Ningún escenario nativo sin completar en el registro de abajo constituye evidencia de ejecución.

Fuente operativa: [TI4-55 en Linear](https://linear.app/ceretime/issue/TI4-55). Responsable: Fernando Valdés. Entrega: 22 de octubre de 2026. Estimación registrada: 2 prismas. No tiene bloqueos registrados y desbloquea TI4-60.

Base local de preparación: `main`, commit `36a2524`. La descripción de Linear cita una base histórica `a025299`; la rama actual se preparó sobre el `main` vigente. Mobile usa Expo `~57.0.26` y no incluía una dependencia TTS.

## Selección técnica

La documentación oficial de [Expo Speech para SDK 57](https://docs.expo.dev/versions/v57.0.0/sdk/speech/) recomienda `expo-speech ~57.0.3`, que lista las voces disponibles, permite seleccionar una por idioma, detener la lectura y recibir eventos de finalización/error. En Android `speak` agrega textos a la cola, `stop` corta la locución y vacía la cola, y pausa/reanudación no están disponibles. Se instaló `~57.0.3`; la biblioteca no requiere permisos de micrófono ni una entrada de plugin o configuración Android para TTS.

La decisión de producto depende de concluir la prueba Android. El adaptador prefiere `es-CL`, después `es-ES` y luego otra voz cuyo idioma comience con `es`; devuelve voz española no disponible sin intentar leer. Antes de iniciar una lectura limpia la anterior. Los controles suspenden el TTS propio cuando React Native detecta un lector de pantalla y mantienen el texto disponible para TalkBack.

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

Los siguientes escenarios concretan los requisitos de Linear sin ampliar la tarea. Todos están pendientes.

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

## Plan de ejecución

1. Contrastar documentación oficial de Expo 57 y del proveedor con las versiones instaladas; registrar la elección y sus requisitos nativos.
2. Añadir el puerto mínimo, el adaptador y su composición. Incorporar controles de prueba solo si son necesarios para verificar la capacidad.
3. Probar lectura, finalización, error, interrupción y limpieza con simulaciones controladas. Si hay invocaciones consecutivas, comprobar que no queda audio pendiente ni un estado incoherente.
4. Ejecutar la matriz en Android con TalkBack desactivado y activado y con texto ampliado. Registrar por separado lo observado y lo simulado.
5. Completar evidencia y decisión, verificar el diff y los controles de calidad, y entregar la PR para su integración.

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

La validación de voz exige Android nativo, nunca Expo Web como sustituto. Usar el entorno activo si existe. Según `apps/mobile/AGENTS.md`, iniciar o reiniciar Expo, Metro o un servidor requiere una solicitud explícita del usuario; si falta el entorno, registrar el impedimento y solicitarla antes de iniciarlo. Este documento no acredita pruebas Android ni autoriza a iniciarlo.

## Registro de evidencia pendiente

- Pruebas focalizadas: `bun run --cwd apps/mobile test --runTestsByPath __tests__/speech.test.tsx`, 9 pruebas aprobadas.
- Suite Mobile: `bun run --cwd apps/mobile test`, 17 suites y 163 pruebas aprobadas.
- Tipos: `bun run --cwd apps/mobile typecheck`, aprobado.
- Lint, formato y ortografía del diff: aprobados localmente.
- `./gradlew :app:assembleDebug` desde `apps/mobile/android`: aprobado; compilación local del APK Android.
- Dispositivo/emulador, versión de Android, versión de TalkBack, motor y voz española: pendiente de prueba nativa.
- Commit probado en Android, identificador de compilación, fecha y verificación audible: pendiente.
- Por escenario nativo: precondiciones, texto ficticio, pasos, resultado observado y artefacto: pendiente.
- Decisión de viabilidad confirmada en dispositivo y limitaciones para TI4-60: pendiente.
- PR, integración y CI: pendiente; esta entrega se abrirá como Draft.

La validación audible aún no se ejecutó porque el puerto Metro `8081` del emulador está conectado a otro worktree. El atajo `ceretime-mobile` reutiliza ese puerto, por lo que conectarlo aquí probaría el código de ese checkout. Para completar los escenarios Android hace falta un entorno aislado o liberar `8081` sin interrumpir la otra sesión.

La tarea no está terminada mientras falte evidencia de idioma, interrupción, TalkBack o fallo. Un entorno sin ejecutar se registra como bloqueo de validación, no como resultado negativo del proveedor.
