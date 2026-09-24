# Protecciones de CI para `main`

El workflow `.github/workflows/ci.yml` valida las Pull Requests que apuntan a `main` y ejecuta los mismos cuatro jobs después de cada `push` a `main`, incluido un merge.

## Configuración en GitHub

El repositorio usa el Ruleset activo `protectedmain`, aplicado a la rama predeterminada, con protección contra eliminación y force push, revisión requerida, descarte de aprobaciones obsoletas, aprobación del último push y uso exclusivo de `Squash and merge`.

El Ruleset exige cinco resultados en todas las PR hacia `main`: los cuatro jobs de CI y el status `Greptile 5/5`.

- `Lint y formato`
- `Validación Mobile`
- `Validación Web`
- `Verificación Backend`
- `Greptile 5/5`

La regla exige resultados publicados por GitHub Actions, no tiene bypass actors y mantiene `strict_required_status_checks_policy` en `true`.

## Check de Greptile 5/5

El status requerido `Greptile 5/5` lo publica `.github/workflows/greptile-score.yml`, cuyo código se ejecuta desde el workflow confiable de `main`. El CI de la PR no puede cambiar la lógica que decide si este status pasa.

Al terminar CI, el workflow valida el resumen más reciente de `greptile-apps[bot]`, exige `Confidence Score: 5/5` y compara `Last reviewed commit` con el SHA actual de la PR. Si Greptile da 4/5, publica un status fallido con el mensaje `Hay cambios pendientes de Greptile (4/5).` y GitHub marca `Greptile 5/5` con una X.

Los comentarios creados, editados o eliminados por Greptile vuelven a evaluar el status vigente. Así, una revisión que llega después de CI o un cambio posterior en la nota actualiza el mismo status para el SHA de la PR. Una nota inválida, una revisión de otro SHA o la ausencia de una revisión actual mantienen el status fallido.

El check externo `Greptile Review` puede quedar verde con 4/5 y no sustituye el status requerido `Greptile 5/5`.

## Comprobación posterior

Comprueba que 4/5 haga fallar `Greptile 5/5` con una X y que 5/5 para el SHA actual lo haga pasar. Una PR normal muestra los cuatro jobs de CI, el status `Greptile 5/5` y, si la integración está activa, el check externo `Greptile Review`. Actualiza la rama cuando `main` avance para que CI valide el estado que se integrará.
