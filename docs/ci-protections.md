# Protecciones de CI para `main`

El workflow `.github/workflows/ci.yml` ejecuta la validación cuando una Pull Request apunta a `main` y después de cada `push` a `main`, incluido un merge.

## Configuración en GitHub

El repositorio usa el Ruleset activo `protectedmain`, aplicado a la rama predeterminada, con protección contra eliminación y force push, revisión requerida, descarte de aprobaciones obsoletas, aprobación del último push y uso exclusivo de `Squash and merge`.

El Ruleset exige estos cinco resultados en todas las PR hacia `main`: cuatro jobs de CI y el status de Greptile.

- `Lint y formato`
- `Greptile 5/5`
- `Validación Mobile`
- `Validación Web`
- `Verificación Backend`

La regla exige resultados publicados por GitHub Actions, no tiene bypass actors y mantiene `strict_required_status_checks_policy` en `true`.

## Nota de Greptile

El status requerido `Greptile 5/5` lo publica `.github/workflows/greptile-score.yml` desde el workflow confiable en `main`. Al terminar CI, el evento `workflow_run` comprueba el comentario más reciente de `greptile-apps[bot]`; los comentarios creados, editados o eliminados por Greptile vuelven a actualizar el status mediante `issue_comment`. El workflow no descarga ni ejecuta código de la PR.

El status solo pasa cuando el comentario indica `Confidence Score: 5/5` y `Last reviewed commit` coincide con el SHA actual de la PR. Una nota de 4/5 publica `failure` con el mensaje `Hay cambios pendientes de Greptile (4/5).`, que GitHub muestra con una X. Una nota inválida, una revisión antigua o la ausencia del comentario también publican `failure`.

El job duplicado `Greptile 5/5` salió de `ci.yml` y el publicador dejó de usar `pull_request_target`, que hacía aparecer su propio job como otro check de la PR. Así, el resultado requerido de Greptile aparece una sola vez. El check de la aplicación `Greptile Review` puede quedar verde con 4/5 y no sustituye este status.

## Comprobación posterior

Después de integrar este cambio en `main`, comprueba en una PR nueva que aparezcan los cuatro jobs de CI, el status `Greptile 5/5` y el check propio `Greptile Review`. Comprueba que Greptile marque una X para 4/5 o una revisión ausente, que pase con 5/5 para el SHA actual y que una nota editada o eliminada actualice el resultado. Actualiza la rama cuando `main` avance para que la CI valide el estado que se integrará.
