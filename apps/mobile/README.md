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

La navegación funciona sin backend, variables de entorno ni credenciales. La pantalla de acceso permite elegir un rol simulado. La sesión vive únicamente en memoria y se pierde al reiniciar o recargar el proceso de la aplicación. «Cambiar de rol» elimina la sesión y vuelve al selector.

## Mapa de rutas

| URL                        | Acceso        | Resultado                                                          |
| -------------------------- | ------------- | ------------------------------------------------------------------ |
| `/`                        | Público       | Redirige a `/login` o al inicio del rol activo.                    |
| `/login`                   | Sin sesión    | Selector temporal de los cuatro roles.                             |
| `/estudiante`              | Estudiante    | Inicio provisional para solicitudes.                               |
| `/profesional`             | Profesional   | Inicio provisional para revisión de solicitudes y acompañamientos. |
| `/practicante`             | Practicante   | Inicio provisional de consulta de acompañamientos asignados.       |
| `/administrador`           | Administrador | Inicio provisional de habilitación de cuentas.                     |
| Cualquier ruta inexistente | Público       | Página no encontrada con regreso al inicio.                        |

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

Jest transforma las dependencias dentro de `.bun` y resuelve Expo desde el workspace para evitar instancias diferentes por variantes de peer dependencies. Se usa React Native Testing Library 13 porque el helper `renderRouter` de Expo Router 57 requiere su render síncrono. El único mock adicional desactiva el WebSocket de herramientas de desarrollo de Expo; las rutas y la sesión se ejecutan sin mocks.

`export` genera bundles de Android, iOS y web en `dist/`. No genera un APK ni reemplaza la ejecución en dispositivo. La construcción Preview con EAS se mantiene en `eas.json`.

### Recorrido en dispositivo o emulador

1. Abrir la aplicación y comprobar que aparece el selector de roles.
2. Entrar con cada rol, verificar su inicio y volver mediante «Cambiar de rol».
3. Usar Atrás después de salir y comprobar que no reaparece el contenido protegido.
4. Abrir un enlace `ceretime://estudiante` sin sesión y comprobar el regreso al acceso. Repetir con los demás roles.
5. Comprobar etiquetas con lector de pantalla, controles táctiles y texto ampliado sin recortes.
6. Adjuntar al PR capturas o video del recorrido, dispositivo, versión del sistema y commit probado.

La evidencia nativa y la revisión de otro integrante deben completarse antes de integrar y cerrar TI4-6.

## Referencias

- [Instalación de Expo Router](https://docs.expo.dev/router/installation/).
- [Rutas protegidas](https://docs.expo.dev/router/advanced/protected/).
- [Referencia Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/).
- [Protocolo de Git, GitHub y Linear](../../docs/tutoriales-ti2/git.pdf).
- [Guía técnica del proyecto](../../docs/tutoriales-ti2/tech.pdf).
