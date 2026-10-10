# R2D2: validación local del contexto y consumo

El cambio permite recuperar rutas de Expo con paréntesis, corchetes y Unicode desde Git; incorpora consumidores de variables CSS; conserva declaraciones enteras al ajustar el contexto; comparte evidencia idéntica entre base y head; y agrupa cambios relacionados. El modelo y los límites por llamada permanecen iguales. El presupuesto acumulado de 600000 tokens incluye análisis, recuperación, reintentos y verificación independiente; se hace una reserva conservadora antes de solicitar y se ajusta con el consumo informado por OpenRouter. Las solicitudes sin datos de consumo conservan su reserva.

Un candidato con coordenadas inválidas deja una limitación, conserva los demás candidatos y evita repetir el análisis entero. Los candidatos válidos siguen requiriendo verificación independiente. La revisión muestra un resumen breve, archivos pendientes y detalles de cobertura y consumo. La evidencia incompleta sigue bloqueando la aprobación y no recibe una nota de calidad.

## Comparación con las PR abiertas

Se construyeron solicitudes con los commits auditados de las siete PR, comparando la implementación de `2f12a27340858a3676f6881cb1aebbd209eeafbc` con este cambio. Se usaron respuestas simuladas sin hallazgos, sin hilos históricos ni caché de conclusiones. Esta comparación mide solamente las solicitudes iniciales: no mide tokens del modelo, rondas posteriores ni calidad de una revisión real. No se llamó a OpenRouter ni se ejecutaron workflows de GitHub.

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

`bun test ./.github/ai-review-score.test.ts ./.github/ci-publication.test.ts`: 216 pruebas aprobadas, incluidas siete regresiones nuevas sobre rutas literales, CSS, declaraciones completas, evidencia compartida, aislamiento de candidatos y presupuesto. Las pruebas usan respuestas simuladas. Se comprobaron también `bun run lint`, `bun run format:check` y CSpell sobre los archivos modificados.

La calidad de la inferencia permanece pendiente de una revisión real sobre el commit publicado. Para controlar el gasto, preparar la PR como Draft y ejecutar una sola revisión formal cuando el cambio esté listo; repetirla únicamente si hay una corrección concreta que comprobar.
