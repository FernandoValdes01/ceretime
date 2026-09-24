# Protecciones de CI para `main`

El workflow `.github/workflows/ci.yml` ejecuta la validación cuando una Pull Request apunta a `main` y después de cada `push` a `main`, incluido un merge.

## Configuración en GitHub

El repositorio usa el Ruleset activo `protectedmain`, aplicado a la rama predeterminada, con protección contra eliminación y force push, revisión requerida, descarte de aprobaciones obsoletas, aprobación del último push y uso exclusivo de `Squash and merge`.

El Ruleset exige los cinco jobs de CI en todas las PR hacia `main`.

- `Lint y formato`
- `Greptile 5/5`
- `Validación Mobile`
- `Validación Web`
- `Verificación Backend`

La regla exige resultados publicados por GitHub Actions, no tiene bypass actors y mantiene `strict_required_status_checks_policy` en `true`.

## Check de Greptile 5/5

El job `Greptile 5/5` de `.github/workflows/ci.yml` consulta cada 30 segundos el resumen más reciente de `greptile-apps[bot]` durante un máximo de 15 minutos. Solo pasa cuando el resumen indica `Confidence Score: 5/5` y `Last reviewed commit` coincide con el SHA actual de la PR.

Si Greptile da 4/5, el job falla con `Hay cambios pendientes de Greptile (4/5).`; GitHub marca el check con una X. Una nota inválida, una revisión de otro SHA o la ausencia de una revisión actual también hacen fallar el job. El job usa permisos de solo lectura y publica su resultado como el check de CI requerido `Greptile 5/5`.

El check de la aplicación `Greptile Review` es independiente y puede quedar verde con 4/5. El requisito de integración es el job de CI `Greptile 5/5`.

## Comprobación posterior

Comprueba que una nota de 4/5 haga fallar el job `Greptile 5/5` con una X y que 5/5 para el SHA actual lo haga pasar. Una PR normal debe mostrar los cinco checks de CI y, si la integración está activa, el check externo `Greptile Review`. Actualiza la rama cuando `main` avance para que la CI valide el estado que se integrará.
