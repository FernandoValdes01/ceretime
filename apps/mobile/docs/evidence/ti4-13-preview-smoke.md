# Evidencia de Preview y smoke tests de TI4-13

Issue: [TI4-13](https://linear.app/ceretime/issue/TI4-13/build-preview-y-smoke-tests-mobile-sprint-1).

## Build Preview

- Perfil EAS `preview`, distribución interna y paquete Android `cl.rmv.ceretime`.
- EAS CLI generó e instaló el APK local en el emulador. Gradle terminó con `BUILD SUCCESSFUL`; el APK de 101 MB se guardó en `/tmp/ti4-13-preview-local.apk` y no se incluye en el repositorio.
- SHA-256 del APK local: `03e69d799c2ee06dfa1263ab1810f35f0ed5877db466e748fcb08b8ba155fb43`.
- Build remoto de EAS: [95746b90-a88e-44e5-ab47-15408b536bdb](https://expo.dev/accounts/corvidown-crew/projects/ceretime/builds/95746b90-a88e-44e5-ab47-15408b536bdb). Quedó en `IN_PROGRESS` mientras se preparaba esta evidencia; falta confirmar el artefacto remoto.
- El APK instalado corresponde al commit `fec33714b2faf936dcd237e50eb3fb752733b551`.

## Dispositivo

Emulador AVD `Medium_Phone`, serial ADB `emulator-5554`, Android 17 (API 37), resolución 1080 x 2400.

## Smoke tests

| Flujo                                                                 | Resultado         | Evidencia                                                                                                                                                                                                                                                                           |
| --------------------------------------------------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Estudiante: login simulado, enviar solicitud, abrir listado y detalle | Aprobado con nota | [Inicio](ti4-13/00-preview-home.png), [formulario](ti4-13/01-student-form.png), [comprobante](ti4-13/02-student-result.png), [listado](ti4-13/03-student-list.png), [detalle](ti4-13/04-student-detail.png)                                                                         |
| Profesional: bandeja, revisión, aceptación y acompañamiento           | Aprobado          | [Bandeja](ti4-13/06-professional-inbox.png), [en revisión](ti4-13/08-professional-in-review.png), [aceptada](ti4-13/09-professional-accepted.png), [listado de acompañamientos](ti4-13/10-professional-accompaniment-list.png), [detalle](ti4-13/11-professional-accompaniment.png) |
| Practicante: consultar acompañamientos asignados                      | Aprobado          | [Listado asignado](ti4-13/12-practitioner-list.png)                                                                                                                                                                                                                                 |
| Administrador: habilitar cuenta institucional                         | Aprobado          | [Cuentas pendientes](ti4-13/14-admin-accounts.png), [confirmación](ti4-13/15-admin-enabled.png)                                                                                                                                                                                     |

El formulario de estudiante devuelve el comprobante ficticio `SOL-DEMO-001`. El listado usa datos de ejemplo independientes y no guarda ese envío. Al abrir `SOL-DEMO-001`, el detalle muestra el estado `Aceptada`. El recorrido no persiste el envío ni llama al backend.

## Validaciones

- `bun run lint`: pasó.
- `bun run format:check`: pasó.
- `bun run --cwd apps/mobile typecheck`: pasó.
- `bun run --cwd apps/mobile test`: pasaron 15 suites y 120 pruebas.
- `bun --cwd apps/mobile expo install --check`: pasó.
- CSpell en los archivos modificados: pasó.
- [CI de la PR, run 36480433132](https://github.com/FernandoValdes01/ceretime/actions/runs/36480433132): lint y formato, Mobile, Web y backend en verde.

La compilación Preview local y los cuatro recorridos abrieron sin cierres ni errores nativos. La PR sigue en draft hasta confirmar el build remoto de EAS y cerrar la nota del simulador de estudiante.
