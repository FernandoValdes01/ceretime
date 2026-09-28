# Evidencia de Preview y smoke tests de TI4-13

Issue: [TI4-13: Build Preview y smoke tests mobile sprint 1](https://linear.app/ceretime/issue/TI4-13/build-preview-y-smoke-tests-mobile-sprint-1).

## Build Preview

- Perfil EAS `preview`, distribución interna y paquete Android `cl.rmv.ceretime`.
- EAS CLI compiló el APK local con `--profile preview`; Gradle terminó con `BUILD SUCCESSFUL` y el APK de 100,5 MB quedó en `/tmp/ti4-13-preview-student-flow.apk`, fuera del repositorio.
- SHA-256: `6cf0f12613548b79ea1002910ab6ad781cd21bc87ed1f4a772c1ea889d58b59a`.
- El artefacto se instaló y abrió en el emulador. Corresponde al commit `e5cce1c64f94d2b5ab6e7fa8d8c32dc1fffba14f`.
- Build remoto de EAS: [2b964edf-1397-4be1-af96-5b2c1aeccf0c](https://expo.dev/accounts/corvidown-crew/projects/ceretime/builds/2b964edf-1397-4be1-af96-5b2c1aeccf0c), en curso al actualizar esta evidencia.

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

- La barra de pestañas reserva el espacio inferior del sistema en Android con navegación de tres botones; [captura en el emulador](ti4-13/16-tabs-safe-area-three-button.png).

## Validaciones

- `bun run lint`: pasó.
- `bun run format:check`: pasó.
- `bun run --cwd apps/mobile typecheck`: pasó.
- `bun run --cwd apps/mobile test`: pasaron 15 suites y 122 pruebas.
- `bun --cwd apps/mobile expo install --check`: pasó.
- CSpell en los archivos de texto modificados: pasó.
- [CI del commit de código, run 36489096177](https://github.com/FernandoValdes01/ceretime/actions/runs/36489096177): lint y formato, Mobile, Web y Backend en verde.
- El check de Greptile informa que falta una revisión para el commit de evidencia. La PR permanece en draft y no se solicitó review, por lo que ese check sigue pendiente.

La PR permanece en draft por indicación del usuario mientras continúa el trabajo de TI4-13.
