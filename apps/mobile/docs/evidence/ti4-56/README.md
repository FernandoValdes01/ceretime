# Evidencia TI4-56: reconocimiento local de comandos

## Estado de viabilidad

El proveedor elegido es `expo-speech-recognition` 57.1.1, compatible con Expo SDK 57 y compilado en Android; se comprobó reconocimiento local en un emulador Android 17/API 37 sin red. La viabilidad queda condicionada al modelo español instalado y al reconocimiento de frases breves; véase la [matriz nativa](native-evidence.md).

El adaptador solicita permiso explícito, exige un modelo español instalado y activa `requiresOnDeviceRecognition`; no usa resultados parciales, no guarda audio y conserva el texto reconocido solo mientras interpreta el comando.

En Android se limita el uso a API 33 o superior porque la implementación del proveedor usa `createOnDeviceSpeechRecognizer` desde API 33; en versiones anteriores su opción on-device no basta para impedir un fallback remoto, por lo que el adaptador informa `unavailable`.

Cuando no existe capacidad on-device, no hay modelo español instalado, falta el módulo nativo o el reconocedor no está disponible, la operación termina como `unavailable`; no se intenta reconocimiento remoto.

La dependencia registraba transcripciones finales y parciales con `Log.d` en Android; `patches/expo-speech-recognition@57.1.1.patch` elimina esos tres logs y una prueba focalizada comprueba que no regresen.

Si el proveedor falla al iniciar o detener y no confirma el evento nativo `end`, el adaptador queda cerrado como `unavailable` hasta reiniciar la app; esta barrera evita mezclar eventos de dos sesiones cuando el SDK no incluye un identificador de sesión.

## Contrato y límites

El parser puro acepta únicamente frases completas de una lista explícita: abrir, ver o mis solicitudes; volver o regresar; y cancelar; textos incompletos, extensiones y expresiones que solo contienen una frase conocida quedan como `unknown`.

El probe diagnóstico usa el puerto y el parser reales, muestra solo la intención o el estado y ofrece un control táctil para detener; no guarda ni vuelve a mostrar la transcripción y no ejecuta acciones de navegación o negocio.

Para probarlo manualmente, crear temporalmente `apps/mobile/app/(protected)/ti4-56-probe.tsx` con este wrapper autenticado; retirarlo después de la prueba porque no forma parte de la navegación del producto.

```tsx
import { router } from "expo-router";
import { mobileDependencies } from "../../src/composition/mobile-dependencies";
import { NativeSpeechProbe } from "../../docs/evidence/ti4-56/native-probe";
import { StudentScreen } from "../../src/presentation/estudiante/student-screen";
import { RoleGuard } from "../../src/presentation/navigation/role-guard";

export default function SpeechProbeScreen() {
  return (
    <RoleGuard requiredRole="estudiante">
      <StudentScreen
        title="Prueba de comandos de voz"
        description="Prueba comandos locales sin enviar solicitudes ni cambiar tus datos."
        onBack={router.back}
      >
        <NativeSpeechProbe recognitionPort={mobileDependencies.speechRecognitionPort} />
      </StudentScreen>
    </RoleGuard>
  );
}
```

El reconocimiento de estos tres comandos no es dictado de campos, no envía solicitudes ni modifica reservas. TI4-61 conecta abrir solicitudes con la lista existente `/estudiante/solicitudes`; cancelar solo termina la interacción local.

## Comprobaciones ejecutadas

`bun run --cwd apps/mobile typecheck` pasó.

`bun run --cwd apps/mobile test --runTestsByPath __tests__/native-speech-recognition-adapter.test.tsx __tests__/speech-command-parser.test.tsx __tests__/speech-command-probe.test.tsx` pasó con pruebas de parser, permisos, silencio, modelo local ausente, resultado desconocido, errores, interrupción por stop, resultados tardíos, desmontaje del probe y texto de logs nativos.

`bun install` aplicó el parche de `expo-speech-recognition` 57.1.1 y conservó la dependencia fijada en `apps/mobile/package.json` y `bun.lock`.

El build nativo Android `assembleDebug` para x86_64 terminó correctamente en 12 segundos después de aplicar el parche; se compiló el módulo nativo con el config plugin Expo.

## Evidencia nativa

La [matriz nativa del 22 de octubre de 2026](native-evidence.md) registra permisos reales, modelo ausente, instalación de español, reconocimiento sin red, silencio y controles accesibles. Las tres intenciones se ejecutaron en el consumidor de TI4-61: abrir solicitudes, regresar y cancelar. La frase literal «volver» produjo un comando desconocido en una muestra sintética; no se afirma fiabilidad general ni validación en un teléfono físico o iOS.

## Evidencia de la entrega

[PR draft #124](https://github.com/FernandoValdes01/ceretime/pull/124). El puerto y parser se registraron en `5ddea1d`; el adaptador, su configuración y el parche nativo se registraron en `ee4e943`.

Se ejecutaron 13 pruebas del parser, 20 del adaptador y 7 del probe. Las 11 pruebas existentes de TTS también pasaron. Typecheck, lint, formato y ortografía pasaron; el comando de ortografía con dos paquetes no es compatible con Bun 1.4, por lo que se ejecutó CSpell con ambos paquetes instalados en un directorio temporal y la misma configuración del repositorio.

La compilación del checkpoint `ee4e943` se repitió con `ANDROID_HOME=/home/corvo/Android/Sdk JAVA_HOME=/usr/lib/jvm/java-21-openjdk ./gradlew :app:assembleDebug -PreactNativeArchitectures=x86_64 --console=plain` desde `apps/mobile/android`: `BUILD SUCCESSFUL in 8s`, 515 tareas, 19 ejecutadas y 496 actualizadas. Esto comprueba compilación nativa; no sustituye una prueba de micrófono.

Con autorización explícita del usuario se iniciaron Expo/Metro y Medium_Phone. El build limpio de esta sesión terminó en 2 min 59 s con 515 tareas ejecutadas. La suite final de la integración con TI4-61 pasó: 25 suites y 252 pruebas. La evidencia nativa incluye la fuente base `efb46e8` y el consumidor integrado `f3b95c6`; las rutas temporales se retiraron después de las pruebas.

Referencias consultadas: [Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/) y [documentación del proveedor](https://github.com/jamsch/expo-speech-recognition#readme). La compatibilidad del build y el orden de eventos se contrastaron con la versión 57.1.1 instalada.
