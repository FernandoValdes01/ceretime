## Verificación de documentos

- `.md`: un párrafo por línea física; verificar con `bunx prettier --check <archivo>` y normalizar con `bunx prettier --write <archivo>`.
- Ortografía: `bunx --package cspell --package @cspell/dict-es-es cspell lint --no-progress <archivo>`, configurado en `../.cspell.json`.
- Ante una palabra desconocida: corregir el texto si es tipeo o falta de tilde; solo agregar a `words` nombres propios e identificadores técnicos.
- `.tex`: compilar si el host tiene alguna herramienta disponible.

## Fuentes

Los tutoriales (`git`, `tech`, `google-oauth`) y los documentos (`requerimientos`, `codigo-etica`) se escriben en `.tex` bajo `docs/sources/` y se compilan a `.pdf` en `docs/`. Los agentes leen siempre las fuentes `.tex`, nunca los PDF: son texto plano y más baratos de procesar.
