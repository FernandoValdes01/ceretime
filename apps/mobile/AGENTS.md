# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

## Ejecución y validación

Para ejecutar y revisar la aplicación en Android, usa el comando disponible desde la raíz del monorepo:

```sh
bun run mobile:android
```

No uses `expo-web`, `expo start --web`, `npm run web` ni una vista previa en navegador como sustituto del emulador Android.

No inicies ni reinicies Expo, Metro ni ningún servidor de desarrollo para validar la aplicación salvo que el usuario lo solicite explícitamente; si no hay un servidor activo, informa el bloqueo y espera autorización.

## Capas de `src/`

- `domain/`: modelos, proyecciones y errores propios del negocio, sin I/O ni React. Los tipos que comparten varios roles van en `request-models.ts`.
- `application/`: los puertos, las interfaces que la app necesita del exterior, con los tipos de su contrato (como los modelos de vista de la agenda o `UserFacingError`). Importa de `domain/`, nunca al revés.
- `infrastructure/`: adaptadores que implementan los puertos (demo, nativos, contratos de Convex).
- `presentation/`: pantallas, hooks y proveedores; `composition/` elige los adaptadores.
