# Evidencia de Preview y smoke tests de TI4-13

Issue: [TI4-13: Build Preview y smoke tests mobile sprint 1](https://linear.app/ceretime/issue/TI4-13/build-preview-y-smoke-tests-mobile-sprint-1).

## Build Preview

- Perfil EAS `preview`, distribución interna y paquete Android `cl.rmv.ceretime`.
- Build remoto completado: [EAS Preview caedf30f-dcf8-44ea-b662-8f6dd9e4401d](https://expo.dev/accounts/corvidown-crew/projects/ceretime/builds/caedf30f-dcf8-44ea-b662-8f6dd9e4401d), compilado desde el commit `a2c68e7aa8dfe5bf99345cc07ea4ef74da8ae11f`.
- La APK de 101 MB se descargó a `/tmp/ti4-13-preview-a2c68e7.apk`, fuera del repositorio, y se instaló y abrió en el emulador; [descargar APK](https://expo.dev/artifacts/eas/8PbIjdydf79HXxYT-eix2ztNvql2w61qtfnSw0rxGC4.apk).
- SHA-256 de la APK: `d27343f829aceeb4b4633b84107ff863f27812c462023b0ba47d10f4a29efe3e`.

## Dispositivo

Emulador AVD `Medium_Phone`, serial ADB `emulator-5554`, Android 17 (API 37), resolución 1080 x 2400.

## Smoke tests

| Flujo                                                       | Resultado                                                                      | Evidencia                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Estudiante: login simulado, envío, listado y detalle        | Aprobado; `SOL-DEMO-006` aparece en el listado y su detalle muestra `Recibida` | [Inicio Preview](ti4-13/00-preview-home.png), [formulario](ti4-13/01-student-form.png), [comprobante](ti4-13/02-student-result.png), [listado](ti4-13/03-student-list.png), [detalle](ti4-13/04-student-detail.png)                                                                                                                                                                               |
| Profesional: bandeja, revisión, aceptación y acompañamiento | Aprobado                                                                       | [Inicio](ti4-13/05-professional-home.png), [bandeja](ti4-13/06-professional-inbox.png), [solicitud](ti4-13/07-professional-request.png), [en revisión](ti4-13/08-professional-in-review.png), [aceptada](ti4-13/09-professional-accepted.png), [listado de acompañamientos](ti4-13/10-professional-accompaniment-list.png), [detalle de acompañamiento](ti4-13/11-professional-accompaniment.png) |
| Practicante: consultar acompañamientos asignados            | Aprobado                                                                       | [Listado asignado](ti4-13/12-practitioner-list.png)                                                                                                                                                                                                                                                                                                                                               |
| Administrador: habilitar cuenta institucional               | Aprobado                                                                       | [Inicio](ti4-13/13-admin-home.png), [cuentas pendientes](ti4-13/14-admin-accounts.png), [confirmación](ti4-13/15-admin-enabled.png)                                                                                                                                                                                                                                                               |

Los datos y cuentas usados son ficticios. El envío del estudiante vive en un almacén en memoria del simulador, por lo que el listado y el detalle comparten el envío durante la sesión; no se llama al backend ni se conserva al cerrar la aplicación.

## Hallazgo corregido

La primera prueba mostró que el simulador devolvía un comprobante independiente del listado y del detalle. Esta PR conecta los tres pasos mediante el almacén local de sesión y agrega una prueba de integración que navega desde el listado existente, vuelve a Inicio, envía la solicitud y abre su detalle. También cubre el listado de ejemplo vacío.

## Ajustes visuales reportados

- La barra de pestañas reserva el espacio inferior del sistema en Android con navegación de tres botones; [captura del Preview](ti4-13/16-tabs-safe-area-three-button.png).
- Al enfocar el primer cuadro de texto con varias líneas y abrir el teclado, todo el campo queda visible; [captura del Preview](ti4-13/17-keyboard-no-cover.png).
- El último cuadro de texto también permanece visible sobre el teclado; [captura del Preview](ti4-13/18-keyboard-no-cover-last-field.png).

## Validaciones

- `bun run lint`: pasó.
- `bun run format:check`: pasó.
- `bun run --cwd apps/mobile typecheck`: pasó.
- `bun run --cwd apps/mobile test`: pasaron 15 suites y 122 pruebas.
- `bun --cwd apps/mobile expo install --check`: pasó.
- CSpell en los archivos de texto modificados: pasó.
- [CI del commit `a2c68e7`, run 36500984714](https://github.com/FernandoValdes01/ceretime/actions/runs/36500984714): lint y formato, Mobile, Web y Backend en verde; Vercel omitió el deploy porque no estaba afectado.
- Greptile pide una review. La PR permanece abierta en draft y sin reviewers porque el usuario indicó que continúan otros cambios de TI4-13.

La PR permanece en draft por indicación del usuario mientras continúa el trabajo de TI4-13.
