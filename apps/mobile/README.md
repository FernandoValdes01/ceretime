# CERETIME Mobile

Base de navegación de [TI4-6](https://linear.app/ceretime/issue/TI4-6/estructura-mobile-navegacion-principal), construida sobre el proyecto Expo existente.

## Ejecutar

Desde la raíz del monorepo, con Bun 1.3.14 y Node 22.13 o superior:

```sh
bun install --frozen-lockfile
bun run mobile:start
```

Usa un dispositivo o emulador con un cliente de desarrollo compatible con Expo SDK 57. Para generar y abrir el cliente local Android, con Android SDK instalado:

```sh
bun run mobile:android
```

Para revisar la misma interfaz en navegador:

```sh
bun run mobile:web
```

La navegación funciona sin backend ni credenciales. El envío simulado confirma por defecto y acepta una variable de entorno opcional para demostrar la recuperación ante errores. La pantalla de acceso permite elegir un rol simulado. La sesión vive únicamente en memoria y se pierde al reiniciar o recargar el proceso de la aplicación. «Cambiar de rol» elimina la sesión y vuelve al selector.

## Mapa de rutas

| URL                           | Acceso        | Resultado                                                          |
| ----------------------------- | ------------- | ------------------------------------------------------------------ |
| `/`                           | Público       | Redirige a `/login` o al inicio del rol activo.                    |
| `/login`                      | Sin sesión    | Selector temporal de los cuatro roles.                             |
| `/estudiante`                 | Estudiante    | Inicio con acceso a Nueva solicitud.                               |
| `/estudiante/nueva-solicitud` | Estudiante    | Formulario, envío simulado y confirmación de TI4-8 y TI4-30.       |
| `/profesional`                | Profesional   | Inicio provisional para revisión de solicitudes y acompañamientos. |
| `/practicante`                | Practicante   | Inicio provisional de consulta de acompañamientos asignados.       |
| `/administrador`              | Administrador | Inicio provisional de habilitación de cuentas.                     |
| Cualquier ruta inexistente    | Público       | Página no encontrada con regreso al inicio.                        |

```text
app/
├── _layout.tsx                 Proveedor de sesión y protección por sesión
├── index.tsx                   Redirección inicial
├── +not-found.tsx              Recuperación de direcciones inexistentes
├── (public)/
│   ├── _layout.tsx
│   └── login.tsx               Selector de rol
└── (protected)/
    ├── _layout.tsx             Protección por rol
    ├── estudiante/             _layout.tsx + index.tsx
    ├── profesional/            _layout.tsx + index.tsx
    ├── practicante/            _layout.tsx + index.tsx
    └── administrador/         _layout.tsx + index.tsx
```

Los grupos entre paréntesis no aparecen en la URL. `Stack.Protected` impide entrar a un grupo sin sesión y a las carpetas de otros roles. Los intentos se redirigen a una ruta permitida. Al eliminar la sesión, Expo Router retira las entradas protegidas del historial.

## Continuar el desarrollo

- Agrega las pantallas de cada rol dentro de su carpeta. El control del layout superior cubre las rutas nuevas de esa carpeta.
- Mantén componentes reutilizables y estado de navegación en `src/presentation/`, fuera de `app/`, para que Expo Router no los convierta en rutas.
- TI4-7 reemplazará el selector y el proveedor de sesión temporal por el flujo de autenticación simulado mediante adapters. La carga, los errores de autenticación, logout mediante adapter y asignaciones del practicante pertenecen a esa tarea.
- Los identificadores de `roles.ts` son locales a la navegación. No definen contratos compartidos con el backend.
- Esta protección controla la navegación del cliente. La autorización real debe verificarse en el backend cuando se integre la API.

## Validación

```sh
bun run --cwd apps/mobile typecheck
bun run --cwd apps/mobile test
bun --cwd apps/mobile expo install --check
bun run --cwd apps/mobile export
```

Las pruebas cargan las rutas reales de `app/` con Expo Router. Cubren arranque, entrada y salida de los cuatro roles, eliminación del historial protegido, enlaces directos sin sesión, intentos de acceso entre roles y recuperación de rutas inexistentes.

Jest transforma las dependencias dentro de `.bun` y resuelve Expo desde el workspace para evitar instancias diferentes por variantes de peer dependencies. Se usa React Native Testing Library 13 porque el helper `renderRouter` de Expo Router 57 requiere su render síncrono. Un mock desactiva el WebSocket de herramientas de desarrollo de Expo; las rutas y la sesión se ejecutan sin mocks. Las pruebas aisladas de tipografía simulan `expo-font` para comprobar carga y fallo sin perder los valores del formulario.

`export` genera bundles de Android, iOS y web en `dist/`. No genera un APK ni reemplaza la ejecución en dispositivo. La construcción Preview con EAS se mantiene en `eas.json`.

### Recorrido en dispositivo o emulador

1. Abrir la aplicación y comprobar que aparece el selector de roles.
2. Entrar con cada rol, verificar su inicio y volver mediante «Cambiar de rol».
3. Usar Atrás después de salir y comprobar que no reaparece el contenido protegido.
4. Abrir un enlace `ceretime://estudiante` sin sesión y comprobar el regreso al acceso. Repetir con los demás roles.
5. Comprobar etiquetas con lector de pantalla, controles táctiles y texto ampliado sin recortes.
6. Adjuntar al PR capturas o video del recorrido, dispositivo, versión del sistema y commit probado.

La evidencia nativa y la revisión de otro integrante deben completarse antes de integrar y cerrar TI4-6.

## Formulario del estudiante: TI4-8

Desde el inicio del Estudiante, abrir **Nueva solicitud**. La pantalla permite describir la necesidad y el resultado esperado, seleccionar varios apoyos de acceso y agregar otro en texto libre, elegir modalidad y días de disponibilidad, indicar una franja horaria opcional y describir el medio accesible preferido para recibir información. **Enviar solicitud** comprueba los campos localmente y, cuando son válidos, inicia el flujo simulado de TI4-30. El borrador se pierde al salir.

Las fuentes son RF-04 y la sección Solicitudes de la especificación del prototipo. Los nombres de los campos se alinean con las proyecciones provisionales de TI4-5, consultadas en el PR #5. `request-form-state.ts` contiene exclusivamente valores editables de presentación, con horarios como texto y selecciones locales. El flujo de TI4-30 los mapea a un comando provisional antes de entregarlos al adaptador inyectado.

Decisiones provisionales de presentación: necesidad, resultado, modalidad, al
menos un día y medio de información requieren respuesta; los apoyos y la franja
horaria son opcionales. Si se completa una hora, se exigen ambas en formato
HH:MM y en orden creciente. No son reglas canónicas del backend. No se piden
RUT, diagnósticos, adjuntos, nombre ni correo: la sesión temporal sólo contiene
un rol y la identidad institucional se integrará posteriormente.

## Envío simulado: TI4-30

El formulario usa un puerto de aplicación independiente del lector de TI4-29. La app inyecta un adaptador mock que espera brevemente y devuelve un comprobante ficticio; no llama a Convex, no guarda datos ni replica reglas del backend.

Durante el envío, los campos y las acciones quedan deshabilitados y una guarda inmediata impide iniciar una segunda promesa. Si el adaptador falla, los campos vuelven a quedar editables y **Reintentar envío** valida y envía los valores visibles del formulario. Cuando el adaptador responde, el formulario se reemplaza por una confirmación con una referencia de prueba.

El modo normal no necesita configuración. Para demostrar el error controlado, inicia Expo desde la raíz con el escenario `fail-once`:

```sh
EXPO_PUBLIC_STUDENT_REQUEST_DEMO_MODE=fail-once bun run mobile:start --clear
```

El primer intento falla y el reintento confirma la solicitud. La variable es pública y solo selecciona el comportamiento del adaptador ficticio; no contiene secretos. Expo inserta las variables `EXPO_PUBLIC_` en el bundle, por lo que debes recargar completamente la aplicación después de cambiarla. También puedes copiar `apps/mobile/.env.example` a `apps/mobile/.env.local`, seleccionar `success` o `fail-once` y ejecutar `bun run mobile:start --clear`.

La presentación toma como referencia **Inicio - Portal Estudiante (Móvil)** del
[proyecto de Stitch](https://stitch.withgoogle.com/projects/9057834843157775417),
pantalla `8eba1da09323417bac7d8f939c65ea79`. No hay una vista específica de Nueva
solicitud: se adaptan la tipografía Fira Sans, los colores y las superficies al
formulario de TI4-8, sin incorporar agendas, perfiles ni datos de los mockups.
Los tokens utilizados viven en `tailwind.config.js` y sólo se aplican al flujo del
estudiante. Se usa el primario `#00695b` del HTML mobile; los controles conservan
etiquetas de al menos 16 puntos, estados de foco y áreas táctiles de 52 puntos.
Fira Sans se incluye desde el paquete local; la fuente del sistema mantiene el
formulario utilizable mientras carga o si falla. Las referencias originales no
se incluyen en el repositorio.

El inicio y el formulario de estudiante usan Tailwind CSS 3 mediante NativeWind 4.
`global.css`, Babel y Metro configuran la conversión a estilos nativos; `inlineRem: 16`
conserva la escala de espaciado entre web y nativo. Los componentes usan `className`
y `contentContainerClassName`, incluidas las variantes de foco y pulsación. Sólo la
fuente cargada dinámicamente conserva `style`. Las pantallas provisionales de los
otros roles mantienen sus estilos anteriores. Tras cambiar la configuración, reinicia
Expo con `bun run --cwd apps/mobile start --clear`.

Jest compila las clases reales con Tailwind y las registra en NativeWind antes de
ejecutar las pruebas. Así también se pueden comprobar medidas y estados nativos.

Para verificar el formulario:

1. Entrar como Estudiante, abrir Nueva solicitud y revisar los campos vacíos.
2. Corregir los errores y comprobar que se conservan los valores ya ingresados.
3. Seleccionar y desmarcar varios apoyos y días; cambiar entre modalidades.
4. Probar una franja incompleta, una hora inválida y una franja invertida.
5. Con el modo `success`, completar los campos obligatorios, pulsar **Enviar solicitud** dos veces con rapidez y comprobar que la acción muestra **Enviando solicitud…**, queda deshabilitada y termina con la confirmación `SOL-DEMO-001`.
6. Reiniciar Expo con `EXPO_PUBLIC_STUDENT_REQUEST_DEMO_MODE=fail-once`, repetir el formulario y comprobar que el primer intento muestra el error sin borrar los campos. Pulsar **Reintentar envío** y comprobar la confirmación.
7. Volver al inicio, cambiar de rol y verificar que otros roles no abren la ruta.
8. En dispositivo, comprobar teclado, desplazamiento, etiquetas accesibles y texto ampliado. Adjuntar evidencia al PR identificando el commit probado.

Las pruebas `student-request.test.tsx` y `student-request-demo-mode.test.tsx` ejercitan las rutas reales, el contrato con tipos, el adaptador configurable y la prevención de doble envío. También deben seguir pasando las pruebas de navegación de TI4-6.

## Referencias

- [Instalación de Expo Router](https://docs.expo.dev/router/installation/).
- [Rutas protegidas](https://docs.expo.dev/router/advanced/protected/).
- [Referencia Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/).
- [Variables de entorno en Expo](https://docs.expo.dev/guides/environment-variables/).
- [Protocolo de Git, GitHub y Linear](../../docs/tutoriales/git.pdf).
- [Guía técnica del proyecto](../../docs/tutoriales/tech.pdf).
