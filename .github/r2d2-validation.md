# R2D2: validación local del contexto y consumo

El cambio permite recuperar rutas de Expo con paréntesis, corchetes y Unicode desde Git; incorpora consumidores de variables CSS; conserva declaraciones enteras al ajustar el contexto; comparte evidencia idéntica entre base y head; y agrupa cambios relacionados. El modelo y los límites por llamada permanecen iguales. El presupuesto acumulado actual es de 450000 tokens e incluye análisis, recuperación, reintentos y verificación independiente; se hace una reserva conservadora antes de solicitar y se ajusta con el consumo informado por OpenRouter. Las solicitudes sin datos de consumo conservan su reserva.

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

`bun test --timeout 15000 ./.github/ai-review-score.test.ts ./.github/ci-publication.test.ts`: 237 pruebas aprobadas, incluidas las regresiones anteriores y seis casos adicionales sobre archivos completos, helpers, rangos, citas entre páginas, prioridad de aplicación y ausencia de llamadas por cambios de metadata. Las pruebas usan respuestas simuladas y el verificador real para los casos nuevos. Se comprobaron `bun run lint`, `bun run format:check` y CSpell sobre los doce archivos modificados.

## Resultado real y corrección posterior

La ejecución [38061965001](https://github.com/FernandoValdes01/ceretime/actions/runs/38061965001), sobre `d5967fd` en la PR #90, quedó incompleta: 17 de 39 bloques, 47 solicitudes pendientes y 545989 tokens medidos. El primer arreglo no resolvió la revisión completa. Los logs muestran que las divisiones reiniciaban las rondas de recuperación, se repetían declaraciones y los errores de cursor o resolución repetían el análisis.

La corrección posterior recorre primero todos los bloques y difiere recuperación y verificación; conserva el análisis inicial para retomarlo sin repetir esa llamada; comparte declaraciones recuperadas y sus dependencias entre bloques; mantiene tres rondas por bloque original entre sus divisiones; y transmite los imports una vez por declaración. El servidor controla los cursores. Una resolución desconocida no elimina ninguna solicitud pendiente ni provoca un reintento del bloque completo. Las limitaciones reales y los candidatos sin verificación siguen impidiendo la aprobación.

Las pruebas comprueban el orden del recorrido, la reutilización entre consumidores, los límites compartidos, las continuaciones y la conservación de todas las coordenadas después de dividir. La segunda ejecución [38067356340](https://github.com/FernandoValdes01/ceretime/actions/runs/38067356340), sobre `edd7b28`, analizó inicialmente 35 archivos, completó 14 de 27 bloques, dejó 50 solicitudes pendientes y consumió 559230 tokens. Tampoco produjo hallazgos verificados.

La tercera corrección conserva decisiones válidas aunque otra solicitud o grupo falle; restaura continuaciones de Git sin exigir que la asociación al cambio sea idéntica; recupera evidencia dentro del verificador sin repetir detección; y reserva el 40 % del presupuesto para verificar. El informe incluye todos los resúmenes iniciales disponibles, los defectos comprobados y, por separado, candidatos pendientes. El modelo, el presupuesto total y la exigencia de pruebas para publicar defectos se mantienen.

Al preparar este cambio, su inferencia real todavía está pendiente. Una simulación no certifica una revisión completa; repetir la ejecución formal únicamente cuando exista una corrección concreta que comprobar.

La tercera ejecución [38073982013](https://github.com/FernandoValdes01/ceretime/actions/runs/38073982013), sobre `265962c`, también falló: 562661 tokens, 23 de 29 bloques procesados, 28 solicitudes pendientes y cero defectos confirmados. La corrección actual reconstruye las páginas completas y sus citas, permite rangos acotados para funciones extensas, conserva las comprobaciones que refutan hipótesis y evita otra llamada cuando solo cambia la metadata. Se priorizan los cambios de aplicación y se reduce el límite total a 450000 tokens. La cuarta ejecución quedó incompleta: 397684 tokens, 10 de 24 bloques completos, seis solicitudes pendientes, una hipótesis refutada y ningún defecto confirmado.

La auditoría posterior está en [r2d2-audit.md](r2d2-audit.md). El informe parcial conserva los hallazgos verificados, analiza los patches válidos aunque otro sea ilegible y muestra las correcciones en el comentario principal.

## Regresiones del cuarto resultado

Se reprodujeron y corrigieron el rechazo de rangos válidos más largos, la pérdida de información sobre declaraciones completas repartidas entre diff y contexto y el rechazo de candidatos agrupados que cabían por separado en el saldo de tokens. La proyección omite copias idénticas del código y conserva contratos y helpers necesarios para comprobar los defectos reales archivados. Las pruebas negativas comprueban que una línea ausente, alterada o recortada no autoriza marcar un archivo o declaración completos. La inferencia real del ajuste sigue pendiente.

La comparación local del mismo diff real de la PR #90, en `cf4b161`, mantuvo 36 archivos y cero incidentes de preparación: pasó de 21 a 19 solicitudes iniciales y de 1130158 a 1014861 bytes HTTP, un descenso del 10,2 %. No incluye hilos históricos, caché ni rondas posteriores; las respuestas fueron simuladas y no se llamó al modelo. Este resultado mide tamaño de mensajes, no tokens ni calidad de revisión.

Las 243 pruebas locales aprobaron, incluidos seis casos nuevos que reproducen estos fallos y los defectos conocidos de la PR #73. También aprobaron lint, formato y CSpell sobre los diez archivos modificados. No se modifica la política de aprobación ni se publica una hipótesis como defecto comprobado.

## Contexto completo y llamadas acotadas

La ejecución sobre `19c8408` volvió a quedar incompleta: 403404 tokens, 15 de 27 bloques completos, una solicitud pendiente y cero defectos confirmados. Las cinco hipótesis pendientes no son defectos comprobados.

El ajuste actual conserva el archivo HEAD completo cuando cabe en un paquete amplio, en lugar de eliminar su última declaración al recortar contexto histórico. Los paquetes pasan a 180000 caracteres y la solicitud completa a 240000; el límite total sigue en 450000 tokens y el máximo de llamadas baja de 80 a 24. Las solicitudes se dividen también cuando no caben en la reserva conservadora restante; se conserva el saldo destinado a verificar hallazgos. El protocolo exige una entrada concreta, el efecto visible en el código y un contrato presente antes de emitir un candidato.

Aprobaron 245 pruebas locales, incluida una función modificada de 1703 líneas con contexto histórico parcial y un caso que divide dos archivos para respetar la reserva restante. La preparación local del diff real de la PR #90, sobre `19c8408`, produjo ocho solicitudes, 36 archivos, cero incidentes y 33 de 37 partes con HEAD completo comprobado. Las respuestas fueron simuladas; el tamaño HTTP fue 1478152 bytes. Estos datos prueban disponibilidad del código y límites del flujo, no ahorro de tokens ni calidad del modelo.

La ejecución real sobre `acc428d` siguió incompleta: 325654 tokens, 33 archivos analizados inicialmente, 1 de 9 bloques completos y cero verificaciones. Una solicitud individual no cabía en el saldo conservador de 124346 tokens, pero el flujo la interpretó como agotamiento de todo el presupuesto y terminó antes de comprobar candidatos diferidos. La corrección posterior conserva esos candidatos y el saldo de verificación cuando falla la reserva de una solicitud inicial. Una regresión reproduce dos paquetes con un presupuesto total de 120000 tokens: el segundo no cabe, pero el candidato del primero se verifica y se conserva en el informe parcial. Esta corrección posterior solo se valida localmente; la revisión real completa sigue sin estar demostrada.
