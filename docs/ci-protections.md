# Protecciones de CI para `main`

El workflow `.github/workflows/ci.yml` ejecuta la misma validación en dos momentos: cuando una Pull Request apunta a `main` y después de cada `push` a `main`, incluido un merge. El push confirma el estado integrado; las reglas del repositorio deben impedir que una PR llegue a ese estado sin pasar antes por la CI.

## Configuración manual en GitHub

El repositorio usa el Ruleset activo `protectedmain`, aplicado a la rama predeterminada. En GitHub, abre `Settings > Rules > Rulesets > protectedmain > Edit` y conserva sus reglas actuales. En particular, no desactives la protección contra eliminación, la protección contra force push, la revisión requerida, el descarte de aprobaciones obsoletas, la aprobación del último push ni el uso exclusivo de `Squash and merge`.

En el mismo Ruleset, dentro de las reglas de la rama, activa `Require status checks before merging`. En `Additional settings`, agrega estos cinco checks después de integrar y probar el workflow de Greptile. GitHub los muestra con estos nombres en los runs de Actions:

- `Lint y formato`
- `Greptile 5/5`
- `Validación Mobile`
- `Validación Web`
- `Verificación Backend`

Activa también `Require branches to be up to date before merging`. En la API de Rulesets esta opción corresponde a `strict_required_status_checks_policy: true`. Guarda el Ruleset con enforcement `Active` y sin bypass actors para conservar el bloqueo efectivo.

La configuración requerida no se puede expresar en `ci.yml`: un workflow puede publicar checks, pero no puede obligar al repositorio a exigirlos ni imponer que una rama se actualice con `main`. La opción de actualización estricta evita que una PR conserve como válidos los checks ejecutados antes de un cambio incompatible en `main`; al actualizar la rama, GitHub crea una nueva ejecución de `pull_request` sobre el estado que se integrará.

## Nota de Greptile

El job `Greptile 5/5` de `.github/workflows/ci.yml` lee la nota real durante la CI de cada PR lista para revisión. Espera hasta diez minutos por un comentario de `greptile-apps[bot]` para el SHA actual y falla si la nota es menor que 5/5, está mal formada o no llega una revisión vigente. Así el CI existente comprueba el caso antes de que el workflow publicador esté integrado en `main`.

Después de integrarse en `main`, `.github/workflows/greptile-score.yml` también crea el status `Greptile 5/5` sobre el commit actual de cada PR. Lee el comentario que contiene `<!-- greptile_summary -->`, exige `Confidence Score: 5/5` y comprueba que `Last reviewed commit` apunte al SHA actual. Los eventos de PR y los comentarios creados, editados o eliminados por Greptile actualizan el status sin ejecutar código de la rama de la PR.

Cuando el workflow ya esté integrado en `main` y se haya comprobado en una PR de prueba, agrega `Greptile 5/5` al mismo Ruleset como status requerido. El check propio `Greptile Review` puede seguir en verde con una nota 4/5; por eso no lo uses como sustituto de este status. No agregues el nuevo status como requisito antes de integrar el workflow: una PR sin el publicador activo quedaría bloqueada sin posibilidad de obtenerlo.

## Comprobación posterior

Abre una PR de prueba hacia `main` y confirma que aparecen `Lint y formato`, `Greptile 5/5`, `Validación Mobile`, `Validación Web` y `Verificación Backend` como checks requeridos. Luego cambia `main` con otra PR y verifica que la primera PR queda desactualizada y no puede integrarse hasta actualizarse y repetir la CI. Finalmente confirma que el workflow también aparece en `Actions` para el commit integrado de `main`.
