# Protecciones de CI para `main`

El workflow `.github/workflows/ci.yml` ejecuta la validación cuando una Pull Request apunta a `main` y después de cada `push` a `main`, incluido un merge. El Ruleset del repositorio impide integrar cambios sin los requisitos activos.

## Configuración en GitHub

El repositorio usa el Ruleset activo `protectedmain`, aplicado a la rama predeterminada. Conserva sus reglas de protección contra eliminación y force push, la revisión requerida, el descarte de aprobaciones obsoletas, la aprobación del último push y el uso exclusivo de `Squash and merge`.

Como excepción autorizada para probar TI4-34 antes de integrar el publicador de status, `protectedmain` exige ahora estos cinco checks en todas las PR hacia `main`:

- `Lint y formato`
- `Greptile 5/5`
- `Validación Mobile`
- `Validación Web`
- `Verificación Backend`

La regla está asociada a GitHub Actions y no tiene bypass actors.

La protección estricta exige que la PR esté actualizada con `main` antes de integrarse. En la API de Rulesets esta opción corresponde a `strict_required_status_checks_policy: true`. Un workflow puede publicar checks, pero no puede obligar al repositorio a exigirlos.

## Nota de Greptile

El job `Greptile 5/5` de `.github/workflows/ci.yml` consulta el comentario de `greptile-apps[bot]` durante la CI de cada PR lista para revisión. Espera hasta diez minutos por una revisión del SHA actual y falla si la nota no es 5/5, está mal formada o no llega una revisión vigente. Con una nota 4/5, GitHub muestra `Oye, Greptile dice 4/5; no puedes mergear así.`; con 5/5, el check pasa.

Después de integrarse en `main`, `.github/workflows/greptile-score.yml` también publica el status `Greptile 5/5` sobre el commit de cada PR. Lee el comentario con `<!-- greptile_summary -->`, exige `Confidence Score: 5/5` y comprueba que `Last reviewed commit` apunte al SHA actual. Los eventos de PR y los comentarios creados, editados o eliminados por Greptile actualizan el status sin ejecutar código de la rama de la PR.

El check propio `Greptile Review` puede quedar verde con una nota 4/5; no lo uses como sustituto de `Greptile 5/5`. Después de integrar el publicador, verifica que ambos caminos mantengan el requisito en verde con 5/5 y en error con 4/5, una revisión ausente o una revisión eliminada.

## Comprobación posterior

En una PR hacia `main`, confirma que los cinco checks aparecen como requisitos y que cualquier resultado fallido bloquea el merge. Actualiza la rama cuando `main` avance y confirma que la CI vuelve a ejecutarse sobre el estado que se integrará. Después de integrar el publicador, comprueba que las notas y la eliminación del comentario actualizan el status del SHA correspondiente.
