# Evidencia TI4-61: comandos de voz locales

Esta entrega limita la navegación por voz a las intenciones `open-requests`, `back` y `cancel` que reconoce el parser compartido con TI4-56; los botones equivalentes permanecen disponibles durante la escucha y ante silencio, permiso denegado, frase desconocida, falta de disponibilidad o fallo.

## Probe de navegación

La integración por callbacks conserva las rutas existentes y no modifica las vistas del estudiante; el botón táctil y el reconocimiento confirmado usan exactamente el mismo callback.

```tsx
const router = useRouter();

<SpeechCommandControls
  speechPort={speechRecognitionPort}
  onOpenRequests={() => router.push("/estudiante/solicitudes")}
  onBack={() => router.back()}
  onCancel={closeVoiceControls}
/>;
```

`closeVoiceControls` solo cierra la interfaz local de comandos; el componente invalida la generación activa antes de detener el reconocimiento y no ejecuta mutaciones, envíos ni cancelaciones de una solicitud o reserva.

La ruta `/estudiante/solicitudes` ya existe en `app/(protected)/estudiante/index.tsx`, y el uso de `router.back()` ya existe en `src/presentation/accessibility/accessibility-preferences-screen.tsx`; ambas referencias se usan como destino de integración sin editar esas vistas.

## Validación automatizada

`__tests__/speech-command-controls.test.tsx` verifica el mapeo aislado de las tres intenciones, la ausencia de navegación para unknown y resultados de error, la disponibilidad de los botones mientras se escucha, la invalidación de resultados tardíos y la ejecución local de cancelar aunque falle `stop()`.

Las pruebas usan un puerto falso; no capturan audio ni conservan transcripciones. Resultado ejecutado: `bun run --cwd apps/mobile test --runTestsByPath __tests__/speech-command-controls.test.tsx` pasó con 12 pruebas.

## Probe nativo reproducible

`native-probe.tsx` consume `mobileDependencies.speechRecognitionPort` de la composición existente y conecta los callbacks a la ruta `/estudiante/solicitudes`, `router.back()` y un cierre local que no ejecuta acciones de negocio.

Para probarlo después de integrar la composición de TI4-56, copia temporalmente este archivo como `apps/mobile/app/ti4-61-probe.tsx`, instala la compilación con `./gradlew :app:installDebug` desde `apps/mobile/android`, y abre la ruta con `adb shell am start -a android.intent.action.VIEW -d ceretime://ti4-61-probe` mientras el servidor de desarrollo autorizado ya está activo; elimina el archivo temporal al terminar y no conserves esta ruta en el producto.

Prueba cada frase con datos ficticios, confirma que solo activa su callback, detén la escucha y prueba los botones durante la escucha; repite con permiso de micrófono denegado y con TalkBack y texto ampliado, registrando por separado lo que realmente observes en Android.

El probe mantiene instrucciones visibles, no registra el texto reconocido y no escribe audio, transcripciones ni datos de solicitudes; la frase reconocida se procesa solo en memoria para seleccionar una de las tres intenciones.

## Validación en Android pendiente

`bun run --cwd apps/mobile typecheck`, `bun run lint`, `bun run format:check` y CSpell para los cuatro archivos del incremento pasaron en la validación automatizada previa a integrar TI4-56; el probe Android no se ejecutó.

No se inició Metro ni un emulador en esta ejecución, por lo que TalkBack, permiso real de micrófono, reconocimiento nativo y texto ampliado siguen pendientes de comprobar en dispositivo Android; no se afirma evidencia de hardware.

## Apilamiento y revisión

[PR draft #125](https://github.com/FernandoValdes01/ceretime/pull/125), con base en [TI4-56, PR #124](https://github.com/FernandoValdes01/ceretime/pull/124). El incremento de controles se registró en `a61cdc1`; la base TI4-56 quedó incorporada hasta `026999e`. La instalación `bun install --frozen-lockfile` aplicó el parche nativo en este segundo checkout.

El diff contra TI4-56 conserva un único parser, puerto y adaptador. No cambia vistas estudiantiles ni formularios; el punto de integración es el módulo reutilizable y el probe temporal documentado. El llamador conserva las acciones existentes y cancelar solo cierra la interacción local.

La revisión manual de Luna y la supervisión contrastaron el orden nativo de eventos, la barrera entre sesiones, los botones durante errores y la invalidación anterior a detener. La evidencia automatizada usa datos ficticios; no demuestra reconocimiento con micrófono real.

La compilación Android de TI4-56 pasó con el mismo proveedor y parche nativo que reutiliza esta PR. No se inició Metro ni el emulador; la autorización explícita exigida por `apps/mobile/AGENTS.md` seguía pendiente.

La suite Mobile completa se ejecutó después de combinar ambas tareas con `bun run --cwd apps/mobile test`: 25 suites y 248 pruebas aprobadas. Emitió advertencias de Reanimated y de `act` en pruebas ajenas al diff; no hubo suites fallidas.
