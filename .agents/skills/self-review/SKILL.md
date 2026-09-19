---
name: self-review
description: "Revisa tu propio cambio contra su issue de Linear antes de pedir revisión: criterios, alcance, higiene y título. Ajusta el título y deja el veredicto comentado en la PR. Rápido y barato; úsalo siempre antes de marcar una PR como lista."
disable-model-invocation: true
metadata:
  scope: local
  opencode/autoinvoke: "false"
---

# Self-review

Usa esta skill cuando termines un cambio y quieras revisarlo tú mismo antes de pedir revisión a otra persona. Contrasta tu diff contra su issue de Linear con chequeos básicos y enruta la revisión especializada según el impacto real del diff. Está diseñada para correr rápido en un modelo pequeño: si algo no pasa, corrígelo tú; solo escala a revisión humana lo que no puedas resolver.

## Límites de actuación

- En tu propia PR puedes escribir solo dos cosas: el comentario con el veredicto y la corrección del título. Nada más.
- No modifiques archivos, no hagas commits, no cambies nada en Linear y nunca hagas merge.
- Si un chequeo de código falla y sabes corregirlo, sal de la skill, corrige y vuelve a correrla.
- La skill puede actualizar únicamente el título de la PR y publicar el comentario final con el veredicto.

## Flujo

### 1. Fijar el objeto

- Lee la rama actual: el `TEAM-nnn` en su nombre es tu issue (ej. `ti4-8` en `jmunoz/ti4-8-formulario-estudiante`).
- Resuelve tu PR desde la rama con `gh pr view --json number,title,url`. Si aún no existe PR, detente y pide abrirla primero.
- Lee la issue: descripción, criterios de aceptación, fuera de alcance y evidencia de cierre.
- Calcula el diff contra el merge-base con `main`:

```bash
git merge-base main HEAD
git diff --stat <merge-base>...HEAD
git diff <merge-base>...HEAD
```

### 2. Chequeo básico

Responde cada punto con pasa o no pasa, citando archivo y línea o criterio:

1. **Criterios:** cada criterio de aceptación está cubierto por el diff o declarado pendiente.
2. **Alcance:** nada fuera del issue, nada de issues vecinas, nada de tu dominio ajeno (`apps/mobile` es TI4; `convex/` y `apps/web` son TI2).
3. **Secretos:** sin tokens, contraseñas ni `.env.local` en el diff.
4. **Higiene:** `bunx prettier --check` limpio en tus archivos y sin palabras nuevas que rompan `cspell`.
5. **Título PR:** formato `ID - tipo(scope): descripción`, con tu issue ID primero.

### 3. Router de revisión especializada

Ejecuta esta selección después de tener el diff completo; no cargues todas las skills por defecto. Si una condición coincide, lee y aplica únicamente la skill indicada, respetando sus límites. Las skills específicas de mobile viven bajo `apps/mobile/.agents/skills` y las de web bajo `apps/web/.agents/skills`; usa cada una desde su alcance, nunca las reinstales en la raíz.

- **Mobile:** si el diff toca `apps/mobile/**`, usa `building-native-ui` para UI, navegación o animaciones; `native-data-fetching` para Convex, sincronización, caché, reconexión u offline; y `react-native-best-practices` solo si existe evidencia medible de rendimiento.
- **Web:** si hay UI nueva o rediseñada en `apps/web/**`, usa `frontend-design`; si corresponde una auditoría de accesibilidad, UX o interfaz existente, usa `web-design-guidelines`; usa `shadcn` solo si el diff toca `components.json`, componentes shadcn, registries, presets o composición basada en ellos.
- **Backend o contratos compartidos:** si el diff toca `convex/**`, contratos compartidos o una integración que pueda afectar web y mobile, usa `blast-radius` antes del veredicto.
- **Dominio:** si cambia terminología, estados, invariantes, entidades o una decisión arquitectónica, consulta `domain-modeling` y verifica el glosario o ADR correspondiente.
- **Bugs:** `diagnosing-bugs` es un flujo de diagnóstico de inicio a fin; no lo dispares por reflejo al finalizar. En esta etapa solo exige evidencia de reproducción, regresión o prueba de la corrección si el issue era un bug.
- **Prosa visible:** pasa por `unslop` la prosa del comentario, títulos y textos dirigidos a usuarios, sin modificar código, identificadores, datos ni citas exactas.

`blast-radius` es una revisión de cierre: se ejecuta únicamente cuando ya existe un diff y hay una superficie de impacto que justificar. No se ejecuta al iniciar una tarea sin cambios concretos que analizar.

No enrutes automáticamente `grill-with-docs`, `to-questionnaire` ni `handoff`: son workflows manuales independientes que solo se usan si la persona los solicita.

### 4. Título

Compara el título actual con el formato `ID - tipo(scope): descripción`, con tu issue ID primero. Si no calza, corrígelo tú con `gh pr edit <n> --title "..."` e informa el cambio.

### 5. Veredicto y comentario

Termina con uno de estos tres, sin rodeos:

- **Lista:** todo pasa, puedes marcar la PR como lista.
- **Lista con observaciones:** funciona, pero anota lo menor que queda pendiente.
- **Falta:** enumera solo lo que no pasa y qué hacer para corregirlo.

Publica ese veredicto como comentario en tu PR con `gh pr comment <n> --body "..."`. El comentario siempre empieza con una etiqueta Markdown que identifica el modelo y la herramienta usados:

```md
## Review by <modelo> on <herramienta>
```

Ejemplo: `## Review by Muse Spark 1.3 on Opencode`.

Después de la etiqueta incluye el veredicto, el chequeo punto por punto y los pendientes. Ese comentario es la constancia de que corriste la skill. Entrégale además el mismo texto a la persona usuaria.
