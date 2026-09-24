# Protecciones de CI para `main`

El workflow `.github/workflows/ci.yml` ejecuta la validación cuando una Pull Request apunta a `main` y después de cada `push` a `main`, incluido un merge.

## Configuración en GitHub

El repositorio usa el Ruleset activo `protectedmain`, aplicado a la rama predeterminada, con protección contra eliminación y force push, revisión requerida, descarte de aprobaciones obsoletas, aprobación del último push y uso exclusivo de `Squash and merge`.

Por autorización explícita para probar TI4-34, el Ruleset exige ahora estos cinco checks en todas las PR hacia `main`:

- `Lint y formato`
- `Greptile 5/5`
- `Validación Mobile`
- `Validación Web`
- `Verificación Backend`

La regla exige checks publicados por GitHub Actions, no tiene bypass actors y mantiene `strict_required_status_checks_policy` en `true`.

## Nota de Greptile

El job `Greptile 5/5` de `.github/workflows/ci.yml` consulta cada 30 segundos el comentario de `greptile-apps[bot]` hasta 15 minutos para validar `Confidence Score: 5/5` y `Last reviewed commit` contra el SHA actual de la PR. Con 4/5 muestra `Oye, Greptile dice 4/5; no puedes mergear así.`; con 5/5 informa que la revisión del SHA actual pasó; si no llega una revisión vigente, falla.

Ese job tiene permisos de solo lectura y no publica statuses. El status requerido `Greptile 5/5` lo publica `.github/workflows/greptile-score.yml`, que usa `pull_request_target`, `issue_comment` y `workflow_run` desde el workflow confiable en `main`; nunca descarga ni ejecuta código de la rama de la PR.

El check run y el commit status comparten el contexto `Greptile 5/5`. GitHub exige que ambos pasen cuando los dos existen; una vez integrado el publicador confiable, el check run editable de la PR no puede sustituir un commit status fallido.

El publicador valida la nota más reciente de Greptile, exige que el SHA revisado sea el actual y publica `failure` para una nota menor a 5/5, una nota inválida, una revisión antigua o la ausencia del comentario. Los comentarios creados, editados o eliminados actualizan el status; luego el workflow ejecuta otra vez el gate si el check terminado ya no coincide. Al terminar una ejecución de CI, `workflow_run` vuelve a comparar status y check run para corregir una carrera con una nota tardía, con un máximo de tres intentos por ejecución.

Durante esta PR de habilitación, GitHub todavía no ejecuta los listeners `issue_comment` ni `workflow_run` porque el workflow aún no está en `main`; por autorización explícita, el check run de esta PR prueba el mismo contexto requerido mientras espera la nota. Después de integrar el workflow, el status confiable y el check run deberán pasar para el mismo SHA cuando ambos estén presentes.

El check propio `Greptile Review` puede quedar verde con 4/5 y no sustituye `Greptile 5/5`. La CI reproduce la salida de error para 4/5 y confirma el caso positivo 5/5 con pruebas automatizadas sobre comentarios reales y simulados.

## Comprobación posterior

En una PR hacia `main`, confirma que los cinco checks aparecen como requisitos y que un fallo en cualquiera impide integrar. Comprueba que `Greptile 5/5` refleja el mismo SHA que la PR en el check run y el commit status, y que una nota tardía, editada o eliminada vuelve a reconciliar ambos resultados. Actualiza la rama cuando `main` avance para que la CI valide el estado que se integrará.
