# Ramas y Pull Requests

## Requisitos

GitHub CLI (`gh`) instalada y autenticada (ver `Requisitos` en `README.md`): sin `gh` el agente no puede comentar ni ajustar la PR por ti.

## Miembros y ramas

No hay tabla de miembros: cada uno se identifica solo con el issue ID en el nombre de su rama.

- Convención: `usuario/TEAM-nnn-slug` (ej. `vrivera/ti4-17-arnes-de-agentes-de-ia`).
- El prefijo de usuario dice quién trabaja; el `TEAM-nnn` dice a qué equipo y qué issue.
- Por defecto usa el `gitBranchName` que sugiere Linear, salvo instrucción explícita. Si necesitas abreviarlo, conserva el identificador del equipo y de la issue.
- Al empezar: muestra la rama actual y confirma que coincide con la pedida. Si la pedida no existe en el remoto, pregunta antes de crear o renombrar. Nunca asumas la rama.
- En worktrees T3 la rama inicial `t3code/*` es descartable: renómbrala según la convención antes de comenzar la tarea.

## Dominio

- `convex/` y `apps/web` son de TI2; `apps/mobile` es de TI4. TI4 no modifica lo de TI2: supervisa y aprueba. Una PR que toque dominio ajeno requiere revisión de ese equipo.

## Título

Formato: `ID - tipo(scope): descripción`

- Ej. `TI4-17 - chore(agents): arnés de trabajo con agentes de IA`
- El ID va primero porque sobrevive al truncado de GitHub; el resto sigue estilo de commit convencional.
- Toda PR lleva el ID de su issue. Sin ID, el título es inválido.
- El título suele convertirse en el mensaje del merge: explica por qué importa el cambio, no qué archivos se tocaron.
- Mal: `TI4-8 - feat(mobile): formulario de solicitud` (dice qué, no por qué).
- Bien: `TI4-8 - feat(mobile): estudiantes pueden pedir acompañamiento desde la app`.

## Cuerpo

- El cuerpo debe incluir el enlace directo a la issue correspondiente en Linear, por ejemplo: `Issue: [TI4-17](https://linear.app/ceretime/issue/TI4-17/...)`.
- El cuerpo debe comenzar con el problema en una o dos frases, explicado en términos simples, y luego describir la solución con la estructura que mejor se adapte al cambio. Puedes usar `Problema`, `Cambio`, `Validación`, `Riesgo` y `Pendientes` cuando aporten claridad; no son una plantilla obligatoria.
- Toda PR debe dejar evidencia de que el cambio se realizó y funciona: comandos y resultados, pruebas manuales, capturas u otra evidencia pertinente. No declares validaciones que no ejecutaste.
- Mantén explícitos los límites o pendientes relevantes y no incluyas secretos ni archivos sin relación.
- Abre con el problema en palabras simples (qué le dolía al usuario), no con el inventario de implementación: eso permite a todo el equipo seguir el trabajo sin leer el diff.
- Mal: enumerar hooks, componentes y funciones agregadas o eliminadas.
- Bien: los estudiantes no tenían cómo pedir acompañamiento desde el móvil y debían escribir por otro canal; ahora el formulario envía la solicitud con sus necesidades de acceso.

## Ciclo de vida

- Una PR por issue o por checkpoint revisable. Draft mientras falte trabajo o validación.
- Actualizar una PR es un checkpoint a pedido, no automático tras cada commit.
- Antes de marcar una PR como lista para revisión, asigna el reviewer que corresponda según las etiquetas de la issue en Linear. La distribución de revisores se mantiene en Linear; no la dupliques en este archivo.
- Crear o actualizar nunca incluye merge ni cierre.

## Revisión automática obligatoria

Las PR internas con cualquier base reciben R2D2 al abrirse, reabrirse, recibir commits, pasar a Ready for review o cambiar de base. Draft no consume revisiones. Conserva la PR en Draft durante la preparación y asigna el reviewer humano según Linear antes de solicitar su revisión. El secret `OPENROUTER_API_KEY` vive en GitHub Actions y nunca se pega en la PR.

El ruleset `protectedmain` exige los cuatro checks de CI y `R2D2 Review 5/5`, asociado a la App R2D2. Este último solo pasa con revisión vigente de head y base, cobertura completa, cero hallazgos, riesgo low y score 5. La revisión humana y la aprobación del último push siguen siendo obligatorias. R2D2 no autoriza ni realiza merge.

Una revisión incompleta muestra evidencia pendiente e incidentes, sin nota de calidad de 0/5. Puede bloquear aunque todos los bloques hayan sido procesados. Los hallazgos sobre renombres puros pueden aparecer como review general de la PR sin coordenada inline. La conversación no modifica el status formal.

Para repetir la comprobación formal sin commits artificiales ni hallazgos inline, usa Actions → AI Code Review → Run workflow con el número de PR. El trigger debe estar integrado en la rama predeterminada; consulta [protecciones de CI](../ci-protections.md) para requisitos, límites y recuperación. No corrijas código funcional válido para resolver un incidente del reviewer. No declares una inferencia real basándote solo en tests locales: registra run y status asociados al SHA vigente.
