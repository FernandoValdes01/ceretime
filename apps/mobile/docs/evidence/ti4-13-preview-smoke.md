# Evidencia de Preview y smoke tests de TI4-13

Issue: [TI4-13: Build Preview y smoke tests mobile sprint 1](https://linear.app/ceretime/issue/TI4-13/build-preview-y-smoke-tests-mobile-sprint-1).

## Build Preview

- Perfil EAS `preview`, distribución interna y paquete Android `cl.rmv.ceretime`.
- Preview compilado con EAS local desde el código del commit `63e990352cb8cadf2563e5f54f98a8a03a954021`, con Expo SDK `57.0.26`, EAS CLI `24.8.0` y JDK `17.0.20.1`.
- APK de 100,5 MiB en `/tmp/ceretime-pr64-preview-local.apk`, fuera del repositorio. La instalación con `adb install -r` terminó correctamente y la aplicación abrió sin Metro.
- SHA-256 de la APK: `0232c3d0b1b1b2c71c927194bc4ce414df4d034c91046c95722cf7302470bfe7`.
- [Build remoto solicitado para el mismo commit](https://expo.dev/accounts/corvidown-crew/projects/ceretime/builds/39c1dc87-bf5a-43f4-a597-8f8217a39f0d). EAS lo mantenía en cola al repetir las pruebas el 29 de septiembre de 2026. Las capturas de este documento corresponden a la APK local.

Comando de compilación usado desde `apps/mobile`, con `JAVA_HOME` y `PATH` apuntando a JDK 17 y el SDK Android local configurado:

```bash
bunx --package eas-cli eas build --platform android --profile preview --local --non-interactive --output /tmp/ceretime-pr64-preview-local.apk
```

El [Preview remoto anterior](https://expo.dev/accounts/corvidown-crew/projects/ceretime/builds/caedf30f-dcf8-44ea-b662-8f6dd9e4401d) y su [descarga de APK](https://expo.dev/artifacts/eas/8PbIjdydf79HXxYT-eix2ztNvql2w61qtfnSw0rxGC4.apk) corresponden a `a2c68e7`, antes de la actualización final de parches de Expo.

## Dispositivo

Emulador AVD `Medium_Phone`, serial ADB `emulator-5554`, Android 17 (API 37), resolución 1080 x 2400.

## Smoke tests

Recorridos repetidos el 29 de septiembre de 2026 sobre la APK Preview local identificada arriba.

| Flujo                                                       | Resultado                                                                      | Evidencia                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Estudiante: login simulado, envío, listado y detalle        | Aprobado; `SOL-DEMO-006` aparece en el listado y su detalle muestra `Recibida` | [Inicio Preview](ti4-13/00-preview-home.png), [formulario](ti4-13/01-student-form.png), [comprobante](ti4-13/02-student-result.png), [listado](ti4-13/03-student-list.png), [detalle](ti4-13/04-student-detail.png)                                                                                                                                                                               |
| Profesional: bandeja, revisión, aceptación y acompañamiento | Aprobado; `SOL-PRO-001` abre `ACO-SOL-PRO-001` activo                          | [Inicio](ti4-13/05-professional-home.png), [bandeja](ti4-13/06-professional-inbox.png), [solicitud](ti4-13/07-professional-request.png), [en revisión](ti4-13/08-professional-in-review.png), [aceptada](ti4-13/09-professional-accepted.png), [listado de acompañamientos](ti4-13/10-professional-accompaniment-list.png), [detalle de acompañamiento](ti4-13/11-professional-accompaniment.png) |
| Practicante: consultar acompañamientos asignados            | Aprobado; vista restringida a sus asignaciones                                 | [Listado asignado](ti4-13/12-practitioner-list.png)                                                                                                                                                                                                                                                                                                                                               |
| Administrador: habilitar cuenta institucional               | Aprobado; Alex Rojas pasa a cuenta habilitada                                  | [Inicio](ti4-13/13-admin-home.png), [cuentas pendientes](ti4-13/14-admin-accounts.png), [confirmación](ti4-13/15-admin-enabled.png)                                                                                                                                                                                                                                                               |

Los datos y cuentas usados son ficticios. El envío del estudiante vive en un almacén en memoria del simulador, por lo que el listado y el detalle comparten el envío durante la sesión; no se llama al backend ni se conserva al cerrar la aplicación.

## Hallazgos corregidos

Las correcciones se realizaron durante los smoke tests de [TI4-13](https://linear.app/ceretime/issue/TI4-13/build-preview-y-smoke-tests-mobile-sprint-1). Cada entrada identifica las issues de origen del flujo, el defecto, el commit que lo corrige y su comprobación.

- **Envío ausente del listado y del detalle.** Flujos de origen: [TI4-30, envío y confirmación](https://linear.app/ceretime/issue/TI4-30/estudiante-mobile-envio-errores-y-confirmacion) y [TI4-19, listado y detalle](https://linear.app/ceretime/issue/TI4-19/estudiante-mobile-listado-y-detalle-de-solicitudes). El simulador devolvía un comprobante que el lector no podía consultar. [Corrección `e5cce1c`](https://github.com/FernandoValdes01/ceretime/commit/e5cce1c64f94d2b5ab6e7fa8d8c32dc1fffba14f): formulario, listado y detalle comparten un almacén en memoria. Una prueba de integración recorre listado → Inicio → envío → listado → detalle; otra comprueba el escenario vacío. Evidencia nativa: [comprobante](ti4-13/02-student-result.png), [listado](ti4-13/03-student-list.png) y [detalle](ti4-13/04-student-detail.png).
- **Pestañas cubiertas por la navegación de Android.** Flujo de origen: [TI4-6, navegación principal](https://linear.app/ceretime/issue/TI4-6/estructura-mobile-navegacion-principal). La barra no reservaba el espacio inferior del sistema. [Corrección `f6d9521`](https://github.com/FernandoValdes01/ceretime/commit/f6d9521365ae50b39b8475655524f05c9ba1137b): las pestañas incorporan el inset inferior. Comprobación con navegación de tres botones: [captura del Preview](ti4-13/16-tabs-safe-area-three-button.png).
- **Campos del formulario cubiertos por el teclado.** Flujo de origen: [TI4-8, formulario y validaciones](https://linear.app/ceretime/issue/TI4-8/estudiante-mobile-formulario-y-validaciones). Al abrir Gboard, el campo enfocado podía quedar oculto. [Corrección final `a2c68e7`](https://github.com/FernandoValdes01/ceretime/commit/a2c68e7aa8dfe5bf99345cc07ea4ef74da8ae11f): el formulario ajusta su altura y desplaza el campo enfocado sobre el teclado. Comprobación del [primer campo](ti4-13/17-keyboard-no-cover.png) y del [último campo](ti4-13/18-keyboard-no-cover-last-field.png).

## Validaciones

- `bun run lint`: pasó.
- `bun run format:check`: pasó.
- `bun run --cwd apps/mobile typecheck`: pasó.
- `bun run --cwd apps/mobile test`: pasaron 15 suites y 122 pruebas.
- `bun --cwd apps/mobile expo install --check`: pasó.
- CSpell en los archivos de texto modificados: pasó.
- [CI del código compilado, commit `63e9903`, run 36626377097](https://github.com/FernandoValdes01/ceretime/actions/runs/36626377097): lint y formato, Mobile, Web, Backend y despliegue Web Preview en verde.
- Pruebas de las reglas de publicación de CI y del gate de Greptile: pasaron 21 pruebas y 73 comprobaciones.

La evidencia nativa corresponde al código de aplicación de `63e9903`. El commit que agrega estas capturas solo modifica la evidencia. Los resultados de CI del último commit se consultan en la PR. La revisión de Greptile y la aprobación humana se verifican sobre el último commit publicado antes de integrar.
