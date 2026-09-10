# **ceretime**

## Requisitos

Para integrarte completamente al flujo (desarrollo, issue tracker y pull requests) necesitas `bun` y la GitHub CLI (`gh`).

- Arch Linux: `sudo pacman -S github-cli`
- Windows: `winget install --id GitHub.cli`

Después, autentica la CLI una vez por máquina con `gh auth login`.

## Comandos mínimos de arranque desde cero

- Instala dependencias limpias desde la raíz con `bun install`.
- Levanta todo con un solo comando según tu área (backend + app en la misma terminal):
  a) TI2 (web): `bun run dev:web`
  b) TI4 (mobile): `bun run dev:mobile`
- La primera vez, `convex dev` abre un asistente interactivo de login y vinculación; el detalle está en [convex/README.md](convex/README.md).

## Variables de entorno

Los `.env.example` listan las variables requeridas, sin valores reales. Los `.env.local` guardan los valores y nunca se suben a Git.

- **Raíz**: sin acción manual, `bunx convex dev` crea solo el `.env.local`.
- **`apps/web` y `apps/mobile`**: copiar la plantilla y pedir los valores al equipo:

```bash
cp apps/web/.env.example apps/web/.env.local
```

`VITE_*` queda visible en el navegador y `EXPO_PUBLIC_*` en la app: nunca pongas secretos en esas variables.

**Queda estrictamente prohibido incluir contraseñas, tokens de API o secretos de autenticación (como BETTER_AUTH_SECRET) dentro de apps/mobile/.env.example, apps/web/.env.example o en el código cliente.**

**Los secretos del backend se configuran directamente de forma segura en el entorno de Convex, nunca en los archivos de ejemplo del monorepo.**

## Calidad de código

Oxlint y Oxfmt se configuran en la raíz y cubren el código compatible de `apps/`, `convex/` y `packages/` cuando esa carpeta exista. Las salidas generadas, dependencias y builds quedan excluidas. Estas comprobaciones no reemplazan typecheck, pruebas ni builds.

Desde la raíz del monorepo:

```sh
bun install --frozen-lockfile
bun run lint
bun run format:check
```

Para aplicar el formato automáticamente, ejecuta `bun run format` y vuelve a comprobar con `bun run format:check`.

## Issue tracker

Se recomienda conectar tu agente al MCP de Linear, ya están configurados en `opencode.json`, `.codex/config.toml` y `.mcp.json`, cada miembro debe autenticarse una vez por máquina, los tokens quedan en cada máquina y no se versionan.

Opencode:

```sh
opencode mcp auth linear
opencode mcp list
```

Codex:

```sh
codex mcp login linear
codex mcp list
```

Codex sólo carga `.codex/config.toml` cuando el proyecto está marcado como confiable. Al abrir el repositorio por primera vez, acepta la confianza del proyecto; si lo abres como no confiable, la configuración MCP definida en el repositorio no se cargará.

Claude Code:

```sh
claude mcp login linear
claude mcp list
```

## Flujo de trabajo

1. En Linear, abre la issue asignada y revisa su descripción, criterios y dependencias.
2. Crea o cambia a la rama que sugiere Linear, respetando el formato `usuario/TEAM-nnn-slug`.
3. Pide al agente que trabaje en esa issue. Antes de empezar debe confirmar la rama y el alcance.
4. Al terminar, ejecuta las validaciones del proyecto y abre la PR ya sea manual o con `gh pr create`, siguiendo los lineamientos establecidos.
5. Antes de pedir revisión, abre una sesión nueva del agente y pídele: `Ejecuta la skill self-review sobre esta PR`. La sesión nueva permite revisar el cambio con una perspectiva independiente de la implementación. La skill contrasta el cambio con la issue, corrige el título si es necesario y deja el resultado comentado en GitHub.

### Workflows manuales

Estos workflows no se ejecutan automáticamente. Pídeselos al agente por su nombre cuando los necesites:

- `grill-with-docs`: cuestionar y refinar un plan, dejando registradas las decisiones en la documentación.
- `to-questionnaire`: convertir dudas o contradicciones sobre el alcance en preguntas concretas para el grupo de TI4.
- `handoff`: opción avanzada para dejar el contexto y el estado del trabajo preparados cuando otro agente o integrante deba continuar.
