---
name: self-review
description: "Revisa tu propio cambio contra Linear, los contratos que toca y sus consumidores antes de pedir una revisión independiente. Corrige lo seguro, deja pendientes claros y publica un veredicto claro en la PR."
disable-model-invocation: true
metadata:
  scope: local
  opencode/autoinvoke: "false"
---

# Self-review

Usa esta skill cuando termines un cambio y quieras dejarlo listo para una revisión independiente. Lee la PR como si fueras otra persona: contrasta el diff con el issue de Linear, las decisiones previas del proyecto, los datos que ya existen y los consumidores del cambio. Su propósito es encontrar temprano los problemas que después obligarían a TI4 a pedir varias rondas de correcciones.

La skill puede ejecutarse con un modelo pequeño, pero no debe reducir la revisión a comprobar que existen archivos o que los tests pasan. Los chequeos automáticos son evidencia útil; no sustituyen la revisión del contrato completo ni la compatibilidad con lo que ya está publicado.

## Límites de actuación

- En tu propia PR puedes escribir solo dos cosas: el comentario con el veredicto y la corrección del título. Nada más.
- No modifiques archivos, no hagas commits, no cambies nada en Linear y nunca hagas merge.
- Si un chequeo falla y sabes corregirlo sin cambiar el diseño ni salir del issue, sal de la skill, corrige la rama y vuelve a correrla.
- Si la solución requiere decidir entre equipos, cambiar el alcance, migrar datos o reinterpretar un contrato, deja el problema explícito para TI4 en vez de inventar una decisión.
- La skill puede actualizar únicamente el título de la PR y publicar el comentario final con el veredicto.

## Flujo

### 1. Fijar el objeto

- Lee la rama actual: el `TEAM-nnn` en su nombre es tu issue (ej. `ti4-8` en `jmunoz/ti4-8-formulario-estudiante`).
- Resuelve tu PR desde la rama con `gh pr view --json number,title,url,headRefOid,baseRefName`. Si aún no existe PR, detente y pide abrirla primero.
- Lee la issue: descripción, criterios de aceptación, fuera de alcance, dependencias y evidencia de cierre.
- Lee la descripción de la PR, los commits, las conversaciones pendientes y las revisiones automáticas. Usa esa información como evidencia que debes contrastar, no como una aprobación ni como la fuente única de verdad.
- Calcula el diff contra el merge-base con la rama base de la PR y conserva ese commit durante toda la revisión:

```bash
git merge-base <base> HEAD
git diff --check <merge-base>...HEAD
git diff --stat <merge-base>...HEAD
git diff <merge-base>...HEAD
git log --oneline <merge-base>..HEAD
```

Si el `head` cambia mientras revisas, detente, vuelve a fijar el commit y repite los chequeos afectados. No publiques un veredicto sobre un diff distinto del que leíste.

### 2. Cargar el contexto correcto

Antes de evaluar el código, busca las decisiones que pueden cambiar el significado del cambio:

- Lee `CONTEXT.md`, `DESIGN.md`, el documento del dominio y los ADR que correspondan.
- Busca issues y PR anteriores o dependientes que definan el mismo estado, campo, entidad, error o flujo. Si una decisión ya fue fusionada, compárala con el contrato nuevo.
- Comprueba los comentarios pendientes de revisiones anteriores y las observaciones automáticas. Conserva los que sigan siendo válidos, descarta los que el código actual haya corregido y señala cualquier contradicción.
- Anota las reglas que deben permanecer iguales: literales guardados o enviados, nombres de campos, campos que admiten `null`, identificadores, permisos, estados, errores públicos y límites de ownership.

La issue vigente de Linear manda sobre decisiones históricas. Las decisiones fusionadas y los comentarios anteriores sirven como evidencia de compatibilidad, salvo que el issue actual documente explícitamente el cambio. Si la persona responsable dejó una instrucción explícita en la PR o en el issue, comprueba que el cambio la respete o explica la excepción. No marques un problema solo porque una forma te parezca más elegante. Marca la diferencia cuando contradiga el issue vigente, rompa un consumidor o deje una ambigüedad que otro equipo tendría que resolver a ciegas.

### 3. Revisar contratos e integración

Este bloque es obligatorio cuando el diff toca un tipo, validator, schema, endpoint, función pública, estado, error, DTO o barrel de exports. Para cada contrato nuevo o modificado, sigue el dato desde su fuente hasta quien lo consume y registra una tabla breve en tus notas:

| Pregunta                      | Evidencia que debes buscar                                                   |
| ----------------------------- | ---------------------------------------------------------------------------- |
| ¿Cuál es la fuente canónica?  | Issue, ADR, dominio o módulo que define el significado                       |
| ¿Qué se persiste o se expone? | `schema`, validators, queries, mutations, endpoints y conversión de datos    |
| ¿Quién lo consume?            | Web, Mobile, funciones internas, tipos generados y adaptadores               |
| ¿Coincide la forma?           | IDs, nombres, estados, campos requeridos, `null` y `undefined`               |
| ¿Qué pasa con lo existente?   | Filas antiguas, valores anteriores, migraciones y compatibilidad de lectura  |
| ¿Cómo se comprueba?           | Prueba del camino nuevo y, cuando corresponda, prueba legacy o de transición |

Registra una fila por cada contrato modificado. En un cambio trivial basta con la evidencia mínima que responda esas preguntas; no conviertas este bloque en una auditoría de todo el repositorio.

Usa `rg` para localizar definiciones y usos en todo el repositorio. Revisa el contexto alrededor de cada coincidencia, no solo la línea modificada. Busca especialmente:

- Tipos duplicados con nombres o propósitos equivalentes. Decide si corresponde reutilizar el canónico, adaptar una forma externa o eliminar el duplicado.
- Cambios de literales o nombres que ya pueden existir en la base de datos o en clientes publicados. Exige compatibilidad de lectura, migración explícita o una justificación documentada.
- Campos que el tipo declara obligatorios pero el schema o los datos legacy permiten ausentes. Comprueba también que las funciones de inserción y actualización realmente los llenen.
- Contratos que parecen completos pero no son usados por ninguna función pública, o respuestas que todavía construyen otra forma del mismo dato.
- Cambios en `convex/` que afecten a Mobile o Web. TI2 conserva el ownership de Backend y Web, pero debe dejar una forma coordinada y utilizable para TI4; exige un DTO, un adaptador o una evidencia de coordinación cuando corresponda.

Si no puedes confirmar una compatibilidad, escribe `No pude confirmarlo` y déjalo como pendiente de decisión. No lo conviertas en una observación menor solo para cerrar la revisión.

### 4. Chequeo de comportamiento, seguridad y alcance

Responde cada punto con `pasa`, `pendiente` o `no pasa`, citando archivo y línea, criterio o evidencia:

1. **Criterios:** cada criterio de aceptación está cubierto por el diff o declarado pendiente con una razón válida.
2. **Comportamiento:** estados, errores, casos límite, idempotencia y permisos siguen el lenguaje y las reglas del proyecto.
3. **Integración:** los contratos tienen consumidores identificados, forma compatible y una estrategia para datos existentes.
4. **Alcance:** nada queda fuera del issue, nada invade issues vecinas y se respetan los límites de equipo (`apps/mobile` es TI4; `convex/` y `apps/web` son TI2).
5. **Privacidad y secretos:** no hay tokens, contraseñas, datos reales ni `.env.local` en el diff, y los nuevos campos no exponen más información de la necesaria.
6. **Pruebas:** existe una prueba proporcional al riesgo. Si el cambio altera persistencia, contratos o compatibilidad, incluye una prueba de la forma antigua o explica por qué no aplica.
7. **Higiene:** `bun run lint`, `bun run format:check` y las pruebas o comprobaciones de tipos relevantes terminan correctamente. En los archivos de texto modificados, ejecuta también `bunx --package cspell --package @cspell/dict-es-es cspell lint --no-progress <archivo>`.
8. **Título PR:** sigue el formato `ID - tipo(scope): descripción`, con el issue ID primero.

No informes un check como exitoso si no lo ejecutaste. Anota `pendiente` y la razón concreta cuando el entorno no permita correrlo.

### 5. Router de revisión especializada

Ejecuta esta selección después de tener el diff completo; no cargues todas las skills por defecto. Si una condición coincide, lee y aplica únicamente la skill indicada, respetando sus límites. Toma de cada skill solo los hallazgos aplicables al diff y evita repetir la auditoría completa. Las skills específicas de mobile viven bajo `apps/mobile/.agents/skills` y las de web bajo `apps/web/.agents/skills`; usa cada una desde su alcance, nunca las reinstales en la raíz.

- **Mobile:** si el diff toca `apps/mobile/**`, usa `building-native-ui` para UI, navegación o animaciones; `native-data-fetching` para Convex, sincronización, caché, reconexión u offline; y `react-native-best-practices` solo si existe evidencia medible de rendimiento.
- **Web:** si hay UI nueva o rediseñada en `apps/web/**`, usa `frontend-design`; si corresponde una auditoría de accesibilidad, UX o interfaz existente, usa `web-design-guidelines`; usa `shadcn` solo si el diff toca `components.json`, componentes shadcn, registries, presets o composición basada en ellos.
- **Backend o contratos compartidos:** si el diff toca `convex/**`, contratos compartidos, schema, validators o una integración que pueda afectar Web y Mobile, ejecuta `blast-radius` antes del veredicto y aplica sus hallazgos a la tabla de contratos.
- **Dominio:** si cambia terminología, estados, invariantes, entidades o una decisión arquitectónica, consulta `domain-modeling` y verifica el glosario o ADR correspondiente.
- **Bugs:** `diagnosing-bugs` es un flujo de diagnóstico de inicio a fin; no lo dispares por reflejo al finalizar. En esta etapa solo exige evidencia de reproducción, regresión o prueba de la corrección si el issue era un bug.
- **Prosa visible:** pasa por `unslop` la prosa del comentario, títulos y textos dirigidos a usuarios, sin modificar código, identificadores, datos ni citas exactas.

`blast-radius` es una revisión de cierre: se ejecuta únicamente cuando ya existe un diff y hay una superficie de impacto que justificar. No se ejecuta al iniciar una tarea sin cambios concretos que analizar.

No enrutes automáticamente `grill-with-docs`, `to-questionnaire` ni `handoff`: son workflows manuales independientes que solo se usan si la persona los solicita.

### 6. Corregir y clasificar

Antes del veredicto, corrige los problemas que estén dentro del issue y tengan una solución segura. Si necesitas modificar la rama, pausa este informe, haz el cambio fuera de este flujo, vuelve a fijar el `head` y ejecuta las comprobaciones afectadas. Si el arreglo cambia el diseño, el alcance o el contrato entre equipos, deja la decisión para la persona responsable y no simules que quedó resuelto.

Clasifica los pendientes por impacto:

- **Bloqueante:** criterio central incompleto, contrato roto, incompatibilidad con datos existentes, pérdida o exposición de datos, autorización evadible, ownership incumplido o fallo que impide integrar o usar el incremento.
- **Importante:** error funcional real, integración sin coordinación, campos opcionales incompatibles, duplicación que puede producir respuestas distintas o prueba ausente para un riesgo concreto.
- **Menor:** documentación, título, formato o mejora acotada que no impide integrar ni deja una decisión abierta.
- **Revisar con TI4:** etiqueta de traspaso para una decisión que no puedes confirmar con la evidencia disponible. Si puede romper la integración o cambia un contrato público, el resultado debe ser `Falta`; si solo requiere una confirmación y no bloquea el uso, puede aparecer en `Lista con observaciones`, pero nunca se presenta como cerrado.

No uses `Lista con observaciones` para un contrato roto, una incompatibilidad de persistencia o un pendiente que obligaría a TI4 a descubrir el problema durante la revisión. Agrupa problemas que tengan la misma causa y evita llenar la PR con preferencias de estilo.

### 7. Título

Compara el título actual con el formato `ID - tipo(scope): descripción`, con tu issue ID primero. Si no calza, corrígelo tú con `gh pr edit <n> --title "..."` e informa el cambio.

### 8. Veredicto y comentario

Termina con uno de estos tres resultados:

- **Lista:** no hay bloqueantes ni importantes, todos los checks relevantes pasan y no queda una contradicción de contrato sin resolver.
- **Lista con observaciones:** solo quedan pendientes menores o una confirmación de TI4 que no cambia el contrato ni bloquea su uso, claramente separados de lo que ya está correcto.
- **Falta:** existe al menos un problema que impide integrar, un check obligatorio que el entorno permite ejecutar no se ejecutó o falló, o una decisión de integración que puede romper el uso del cambio y debe resolverse antes de pedir la revisión final.

Publica un único comentario en tu PR con `gh pr comment <n> --body-file <archivo-temporal>`. El comentario siempre empieza con una etiqueta Markdown que identifica el modelo y la herramienta usados:

Incluye al final del comentario una marca de control para que `review-ti2-pr` pueda comprobar que la `self-review` corresponde al commit actual:

```md
<!-- cereti:self-review head=<head_sha> result=<Lista|Lista con observaciones|Falta> -->
```

Reemplaza `<head_sha>` por el SHA exacto de `headRefOid` y `<result>` por el resultado publicado. Si el `head` cambia después de la revisión, vuelve a ejecutar la skill y publica una marca nueva; no reutilices una `self-review` anterior.

```md
## Review by <modelo> on <herramienta>
```

Ejemplo: `## Review by Muse Spark 1.3 on Opencode`.

Escribe el comentario en español natural y directo. Empieza por el resultado y el efecto que vería otro equipo; deja las rutas, tipos y comandos como respaldo. Habla del cambio y de su consecuencia, nunca de la capacidad o la intención de quien lo implementó. Cada pendiente debe indicar archivo y línea, qué ocurre, por qué importa, qué acción queda y cómo comprobarla.

Usa esta estructura:

```md
## Review by <modelo> on <herramienta>

### Resultado: <Lista | Lista con observaciones | Falta>

<Una explicación breve de si la PR está lista para pedir revisión independiente.>

### Correcciones realizadas

- <Qué corregiste durante esta pasada y cómo lo validaste.>
- Si no corregiste nada: `No fue necesario corregir la rama durante esta pasada.`

### Lo que comprobé

- <Criterio, contrato o validación con su evidencia.>

### Pendientes antes de pedir revisión

1. `ruta/al/archivo.ts:42` · **Bloqueante**

   **Qué pasa:** <efecto concreto.>

   **Qué falta:** <acción concreta y validación esperada.>

2. `ruta/al/otro-archivo.ts:18` · **Revisar con TI4**

   **Qué falta decidir:** <pregunta concreta, sin atribuir culpa.>

### Validaciones

- `<comando>`: <resultado real.>

### Entrega para TI4

- <Riesgo o decisión que la revisión final debe confirmar, si queda alguno.>

<!-- cereti:self-review head=<head_sha> result=<resultado> -->
```

Si no hay pendientes, dilo explícitamente y menciona las validaciones que sí ejecutaste. Si el entorno impide una comprobación, indícalo como pendiente de verificación y entrégalo a TI4; no lo conviertas automáticamente en un bloqueo. No uses una lista de checks para esconder una incompatibilidad que no pudiste confirmar. Entrega el mismo texto a la persona usuaria para que sepa qué corregir antes de solicitar la revisión independiente.
