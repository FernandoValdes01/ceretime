# CERETI

Proyecto de Taller de Integración (UCT): aplicación móvil con Expo y documentación oficial del proyecto.

## Estructura

El proyecto usa arquitectura por capas:

- `apps/web`: aplicación web, propiedad de TI2.
- `apps/mobile`: aplicación Expo, propiedad de TI4.
- `convex/`: backend de la aplicación, propiedad de TI2.

Compartido:

- `docs/`: documentación oficial del proyecto.
- `CONTEXT.md`: lenguaje del proyecto.

# Workflow

En el proyecto trabajan dos equipos de contextos diferentes:

- `TI2`: 2do año de carrera, encargados de backend y web.
- `TI4`: 4to año de carrera, encargados de mobile y orquestación/supervisión de `TI2`.

Puedes identificar a qué equipo pertenece la sesión actual por el nombre de la rama, siempre va a tener el identificador de `ti2` o `ti4`.

Estamos usando Linear como Issue Tracker, tenemos los equipos separados

# Skills y alcance por equipo

- Las skills compartidas viven en `.agents/skills` y `.claude/skills` es un enlace simbólico a esa única fuente.
- Las skills de mobile viven únicamente en `apps/mobile/.agents/skills` y `apps/mobile/.claude/skills` es su enlace simbólico; no deben instalarse en la raíz.
- Las skills exclusivas de web (`web-design-guidelines` y `shadcn`) viven únicamente en `apps/web/.agents/skills` y `apps/web/.claude/skills` es su enlace simbólico; no deben instalarse en la raíz.
- Para OpenCode, usa el agente `ti2` para cambios de `apps/web` o `convex`, y `ti4` para cambios de `apps/mobile`; el agente `ti2` bloquea explícitamente las skills de mobile.
- La mayoría de las skills de revisión son manuales. `self-review` funciona como router al cierre del cambio y selecciona solo las skills que correspondan al diff.
- `blast-radius` se ejecuta después de que existe un diff concreto y antes del veredicto final cuando hay riesgo de impacto; no se ejecuta al inicio de una tarea vacía.

La fuente de verdad operativa de cada issue es Linear: la issue vigente manda sobre alcance, prioridad, dependencias y criterios de cierre. La fuente de verdad del producto permanece en `CONTEXT.md`, `DESIGN.md`, `docs/` y los ADR.

## Verificación de Markdown

- En archivos `.md` versionados, mantén cada párrafo en una sola línea física; verifica el archivo con `bunx prettier --check <archivo>` y, para normalizarlo, ejecuta `bunx prettier --write <archivo>`.

## Verificación de textos

- En archivos de texto versionados y textos visibles de la aplicación, ejecuta `bunx --package cspell --package @cspell/dict-es-es cspell lint --no-progress <archivo>`; la configuración está en `.cspell.json`.
- Ante una palabra desconocida, corrige el texto si contiene un error de escritura o falta una tilde; solo agrega a `words` nombres propios e identificadores técnicos.

# Issues y Pull Requests

Cada miembro se identifica solo con el issue ID en el nombre de su rama (`usuario/TEAM-nnn-slug`); el detalle operativo vive en `docs/agents/issue-tracker.md` y `docs/agents/pull-requests.md`. Por defecto se usa el `gitBranchName` que sugiere Linear.
