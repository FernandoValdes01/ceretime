# Protecciones de CI para `main`

El workflow `.github/workflows/ci.yml` ejecuta las validaciones y los despliegues. La integración en `main` requiere los checks de CI y la aprobación humana.

## Checks obligatorios

La consulta del ruleset `protectedmain` del 10/10/2026 confirmó estos cuatro checks de GitHub Actions, con validación estricta contra la base vigente:

- `Lint y formato`
- `Validación Mobile`
- `Validación Web`
- `Verificación Backend`

El ruleset exige una aprobación, descarta aprobaciones antiguas y exige aprobación del último push. Permite squash y merge. La resolución obligatoria de conversaciones permanece desactivada.

## Retiro de la revisión por IA

R2D2 se retira del repositorio por consumo excesivo de tokens y revisiones incompletas sin retroalimentación útil. Se eliminan sus workflows, scripts, configuración, tests, fixtures, avatar y documentación específica. Los cuatro checks de CI y la revisión humana continúan como requisitos de integración.

## Validación y despliegues

CI valida PR normales y apiladas, incluyendo cambios de base. Los jobs conservan sus nombres y validan el merge commit del evento. Preview se publica únicamente cuando el head y la base siguen vigentes. Production comprueba que el commit corresponde al main actual antes de desplegar.

La validación manual de builds está documentada en [validación de builds](ci-build-validation.md). Los despliegues están documentados en [despliegues Vercel](vercel-deployment.md).
