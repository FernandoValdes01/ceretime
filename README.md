## Issue tracker

Se recomienda conectar tu agente al MCP de Linear, ya están configurados en `opencode.json` y `.codex/config.toml`, cada miembro debe autenticarse una vez por máquina, los tokens quedan en cada máquina y no se versionan.

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
