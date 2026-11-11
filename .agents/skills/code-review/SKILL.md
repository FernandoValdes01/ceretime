---
name: code-review
description: Revisa cambios de código y pull requests, propios o de otra persona, frente a la issue, arquitectura, legibilidad, contratos y pruebas. Úsala antes de hacer push o publicar una PR, y cuando pidan revisar una PR o cambios de un compañero.
---

# Revisión de código

Esta skill examina código propio o de otra persona y entrega hallazgos; no publica comentarios ni modifica archivos. También se aplica a revisiones entre integrantes del mismo equipo. Lee `CODING_STANDARDS.md`, los patrones pertinentes, `CONTEXT.md`, `docs/vocabulario-codigo.md` y los contratos afectados.

## Fijar el alcance

Identifica la issue, sus criterios y la base del cambio. Para una PR, consulta su descripción, issue, rama base y commit de cabecera; compara su diff con el merge-base de la base y la cabecera, sin incluir cambios locales ajenos a la PR. Para cambios locales, incluye los commits y cambios sin commit que se vayan a publicar. Registra los SHA y las rutas revisadas; para cambios locales, registra también el estado del árbol. Si no puedes identificar la base o el contenido, informa el límite y no declares aprobada la revisión.

## Revisar

Examina todos los archivos del cambio y el contexto necesario fuera de él. Contrasta los requisitos con el comportamiento y busca errores, omisiones y estados sin cubrir. Para estándares, evalúa especialmente legibilidad, nombres, responsabilidades, dirección de dependencias, reutilización y límites de arquitectura. Comprueba seguridad, contratos, consumidores y pruebas según el alcance. Usa [calidad de la base de código](references/calidad-codebase.md) para cambios de lógica o contratos.

Para cada hallazgo confirma el caso que lo activa, la ubicación, la regla o requisito aplicable y la consecuencia. Distingue errores y estándares incumplidos de sugerencias opcionales; no conviertas una preferencia de estilo en defecto. Ejecuta las comprobaciones proporcionales y registra sus resultados y límites.

## Resultado

Entrega los hallazgos por gravedad, con archivo y línea, efecto y comprobación esperada. Separa requisitos de estándares, y distingue problemas confirmados, dudas sin verificar y sugerencias opcionales. Indica qué código y base revisaste, qué comprobaciones pasaron o faltan y si la revisión está **aprobada** o **pendiente**. Está pendiente si hay defectos, incumplimientos de arquitectura o legibilidad, o falta evidencia necesaria para evaluar el código. Si no hay hallazgos, dilo.

La falta de acceso a un navegador, dispositivo o cuenta de prueba no bloquea por sí sola la revisión de código ni el push: registra el recorrido no verificado y la evidencia que falta. No declares verificado el comportamiento visual ni resuelvas por suposición un posible defecto que necesite ese recorrido. Antes de dejar lista una PR propia, completa la verificación requerida; mientras falte, déjala en Draft.

La revisión solo cubre el código examinado. Si cambia el código o la base, vuelve a revisar lo afectado y actualiza el resultado. El resultado en el informe no sustituye la aprobación humana requerida ni publica una revisión en la PR.
