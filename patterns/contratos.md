# Contratos compartidos

Aplica este patrón cuando una operación, campo, estado o error cruza el límite entre Backend, Web y Mobile. Un cambio que compila en un cliente puede dejar al otro sin una forma compatible de leerlo.

1. Identifica la fuente canónica, los consumidores y los valores ya persistidos o publicados. Consulta [los contratos existentes](../docs/contratos-sprint-1.md) y la issue vigente, además del código de cada consumidor.
2. Valida las entradas y salidas en el borde público y reutiliza las formas y códigos existentes cuando expresen la misma responsabilidad. Distingue errores por códigos estables y no por el texto que se muestra a una persona.
3. Para un cambio incompatible, acuerda con los equipos una transición o migración que cubra datos y clientes anteriores; documenta qué versión consume cada forma. No supongas que un diagrama objetivo ya está implementado.
4. Comprueba el camino nuevo y los casos antiguos o negativos afectados. Si no puedes demostrar compatibilidad, deja la integración pendiente y explica la evidencia que falta.

El contrato de [errores públicos](../convex/domain/errors/api_error.ts) define códigos y respuestas; las [funciones de solicitudes](../convex/presentation/requests.ts) muestran validadores de entrada y salida. El detalle vigente de cada operación y sus consumidores se comprueba en el código, no se duplica en este patrón.

## Errores en las pantallas

Una excepción del SDK puede incluir información interna. Por ejemplo, [professional-requests.tsx](../apps/web/src/presentation/gestion/professional-requests.tsx) muestra `err.message` en acciones de la pantalla; ese texto no es necesariamente un mensaje público. La pantalla debe recibir una respuesta interpretada por el adaptador, distinguir los códigos públicos conocidos y mostrar un mensaje genérico ante fallos desconocidos. Conserva los contratos existentes mientras se migra: algunos flujos antiguos aún devuelven la denegación como texto.

La detección de esa denegación aparece también en [student-requests.tsx](../apps/web/src/presentation/estudiante/student-requests.tsx), [student-accompaniments.tsx](../apps/web/src/presentation/estudiante/student-accompaniments.tsx) y [practitioner-accompaniments.tsx](../apps/web/src/presentation/gestion/practitioner-accompaniments.tsx). Una responsabilidad equivalente compartida evita que una corrección quede solo en una pantalla; antes de extraerla, verifica que las tres esperen la misma conducta y prueba errores conocidos y desconocidos.
