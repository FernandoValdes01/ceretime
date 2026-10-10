# R2D2: validación local del contexto y consumo

El cambio permite recuperar rutas de Expo con paréntesis, corchetes y Unicode desde Git; incorpora consumidores de variables CSS; conserva declaraciones enteras al ajustar el contexto; comparte evidencia idéntica entre base y head; y agrupa cambios relacionados. El modelo y los límites por llamada permanecen iguales. El presupuesto acumulado de 600000 tokens incluye análisis, recuperación, reintentos y verificación independiente; se hace una reserva conservadora antes de solicitar y se ajusta con el consumo informado por OpenRouter. Las solicitudes sin datos de consumo conservan su reserva.

Un candidato con coordenadas inválidas deja una limitación, conserva los demás candidatos y evita repetir el análisis entero. Los candidatos válidos siguen requiriendo verificación independiente. La revisión muestra un resumen breve, archivos pendientes y detalles de cobertura y consumo. La evidencia incompleta sigue bloqueando la aprobación y no recibe una nota de calidad.

## Comparación con las PR abiertas

Se construyeron solicitudes con los commits auditados de las siete PR, comparando la implementación de `2f12a27340858a3676f6881cb1aebbd209eeafbc` con el primer arreglo publicado en `d5967fd`. Se usaron respuestas simuladas sin hallazgos, sin hilos históricos ni caché de conclusiones. Esta comparación mide solamente las solicitudes iniciales: no mide tokens del modelo, rondas posteriores ni calidad de una revisión real. No se llamó a OpenRouter ni se ejecutaron workflows de GitHub.

| PR    | Solicitudes antes | Solicitudes después | Caracteres antes | Caracteres después |
| ----- | ----------------: | ------------------: | ---------------: | -----------------: |
| #80   |                 5 |                   5 |           237992 |             212329 |
| #86   |                 8 |                   7 |           408336 |             333252 |
| #88   |                 1 |                   1 |            55597 |              52198 |
| #90   |                 9 |                   9 |           483953 |             417865 |
| #91   |                 4 |                   3 |           190237 |             135627 |
| #92   |                 4 |                   4 |           189584 |             185520 |
| #94   |                 2 |                   2 |            80725 |              73902 |
| Total |                33 |                  31 |          1646424 |            1410693 |

El texto inicial baja un 14,3 % en total y un 13,7 % en la PR #90. Los cuerpos HTTP bajan de 1775456 a 1548446 bytes en total; en #92 suben de 204099 a 206080 bytes al incluir contexto CSS adicional. Los caracteres y bytes no equivalen a tokens ni a costo monetario.

## Comprobaciones

`bun test --timeout 15000 ./.github/ai-review-score.test.ts ./.github/ci-publication.test.ts`: 231 pruebas aprobadas para la tercera corrección, incluidas las regresiones de las dos anteriores y ocho casos adicionales sobre solicitudes, verificación y reserva de presupuesto. Las pruebas usan respuestas simuladas y el verificador real para los casos nuevos. Se comprobaron también `bun run lint`, `bun run format:check` y CSpell sobre los once archivos modificados.

## Resultado real y corrección posterior

La ejecución [38061965001](https://github.com/FernandoValdes01/ceretime/actions/runs/38061965001), sobre `d5967fd` en la PR #90, quedó incompleta: 17 de 39 bloques, 47 solicitudes pendientes y 545989 tokens medidos. El primer arreglo no resolvió la revisión completa. Los logs muestran que las divisiones reiniciaban las rondas de recuperación, se repetían declaraciones y los errores de cursor o resolución repetían el análisis.

La corrección posterior recorre primero todos los bloques y difiere recuperación y verificación; conserva el análisis inicial para retomarlo sin repetir esa llamada; comparte declaraciones recuperadas y sus dependencias entre bloques; mantiene tres rondas por bloque original entre sus divisiones; y transmite los imports una vez por declaración. El servidor controla los cursores. Una resolución desconocida no elimina ninguna solicitud pendiente ni provoca un reintento del bloque completo. Las limitaciones reales y los candidatos sin verificación siguen impidiendo la aprobación.

Las pruebas comprueban el orden del recorrido, la reutilización entre consumidores, los límites compartidos, las continuaciones y la conservación de todas las coordenadas después de dividir. La segunda ejecución [38067356340](https://github.com/FernandoValdes01/ceretime/actions/runs/38067356340), sobre `edd7b28`, analizó inicialmente 35 archivos, completó 14 de 27 bloques, dejó 50 solicitudes pendientes y consumió 559230 tokens. Tampoco produjo hallazgos verificados.

La tercera corrección conserva decisiones válidas aunque otra solicitud o grupo falle; restaura continuaciones de Git sin exigir que la asociación al cambio sea idéntica; recupera evidencia dentro del verificador sin repetir detección; y reserva el 40 % del presupuesto para verificar. El informe incluye todos los resúmenes iniciales disponibles, los defectos comprobados y, por separado, candidatos pendientes. El modelo, el presupuesto total y la exigencia de pruebas para publicar defectos se mantienen.

Al preparar este cambio, su inferencia real todavía está pendiente. Una simulación no certifica una revisión completa; repetir la ejecución formal únicamente cuando exista una corrección concreta que comprobar.

La auditoría posterior está en [r2d2-audit.md](r2d2-audit.md). El informe parcial conserva los hallazgos verificados, analiza los patches válidos aunque otro sea ilegible y muestra las correcciones en el comentario principal.
