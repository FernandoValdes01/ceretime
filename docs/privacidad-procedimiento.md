---
created: 2026-11-14T00:00
updated: 2026-11-14T00:00
---

# Procedimiento de prueba para solicitudes de derechos de privacidad

Este documento acuerda cómo se presentan, revisan y resuelven las solicitudes de acceso, rectificación, supresión, oposición, bloqueo y portabilidad en el prototipo CERETI. Es un procedimiento de prueba con datos ficticios: no es una política aprobada por la UCT, no reemplaza la revisión jurídica y no habilita el uso con datos reales. El análisis de la Ley 21.719 que lo origina vive en [Aplicación de la Ley 21.719](producto/ley-21719.md).

La implementación ejecutable está en `convex/domain/privacy/`: `privacy_request.ts` define derechos, estados, transiciones y respuesta fundada; `privacy_deadlines.ts` calcula los plazos. Ambos módulos son dominio puro y no crean tablas, API ni pantallas. La persistencia corresponde a TI2-151 y las pantallas a las issues que las autoricen.

## Tipos de solicitud

| Derecho       | Valor en código | Qué pide el titular                                                        | Respuesta esperada                                                                          |
| ------------- | --------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Acceso        | `access`        | Saber qué datos se mantienen y obtener una copia comprensible.             | Copia o resumen de los datos propios y su contexto de tratamiento.                          |
| Rectificación | `rectification` | Corregir un dato inexacto, incompleto o desactualizado.                    | Corrección aplicada o explicación fundada de por qué no corresponde.                        |
| Supresión     | `erasure`       | Eliminar datos que ya no son necesarios o cuyo tratamiento no corresponde. | Eliminación, anonimización o explicación fundada cuando exista una obligación de conservar. |
| Oposición     | `objection`     | Oponerse a un tratamiento concreto por una razón legítima.                 | Cese del tratamiento o explicación fundada de la prevalencia que lo mantiene.               |
| Bloqueo       | `blocking`      | Suspender temporalmente el tratamiento mientras se revisa la solicitud.    | Bloqueo temporal con su plazo o denegación fundada; se responde en dos días hábiles.        |
| Portabilidad  | `portability`   | Exportar los datos propios en un formato que permita reutilizarlos.        | Entrega de una exportación o explicación fundada de la imposibilidad técnica.               |

El canal acordado para el Estudiante es la aplicación, aunque la pantalla todavía no existe. El Profesional, el Practicante y el Administrador también son titulares de sus propios datos, pero no usan el formulario estudiantil: presentan la solicitud por el canal institucional que defina la UCT. `privacyRequestChannelForRole` fija esa separación en dominio; la dirección del canal sigue pendiente.

## Estados y transiciones

Toda solicitud nace en `received`. El responsable la toma y pasa a `in_review`; desde ahí puede pedir información, resolver o recibir el retiro del titular. Una solicitud resuelta no se reabre y una retirada no se revive. El vencimiento del plazo no es un estado: se deriva al comparar la respuesta con el plazo calculado, porque el procedimiento no cambia por el solo paso del tiempo.

| Desde                  | Hasta                  | Exige                | Quién actúa                 |
| ---------------------- | ---------------------- | -------------------- | --------------------------- |
| `received`             | `in_review`            | Nada                 | Responsable de la solicitud |
| `in_review`            | `awaiting_information` | Motivo               | Responsable de la solicitud |
| `awaiting_information` | `in_review`            | Motivo o información | Titular que responde        |
| `in_review`            | `resolved`             | Respuesta fundada    | Responsable de la solicitud |
| `received`             | `withdrawn`            | Motivo               | Titular                     |
| `in_review`            | `withdrawn`            | Motivo               | Titular                     |
| `awaiting_information` | `withdrawn`            | Motivo               | Titular                     |

Cualquier otro par es una transición inválida y el dominio la rechaza como valor, sin persistir ni dejar entrada en el historial: saltos como `received → resolved`, retrocesos distintos de `awaiting_information → in_review` y salidas desde `resolved` o `withdrawn`. `PRIVACY_REQUEST_TRANSITIONS` es la única tabla de transiciones y `transitionPrivacyRequest` la aplica.

## Responsable, canal y respuesta fundada

La UCT es la responsable legal del tratamiento según el análisis vigente, pendiente de confirmación formal. El procedimiento de prueba asigna la respuesta al Administrador porque es el único rol institucional existente que puede operar sobre cuentas; la UCT debe designar al responsable definitivo y a su reemplazo. `PRIVACY_REQUEST_RESPONSIBLE_ROLE_VALUES` declara esa decisión provisional y `isPrivacyRequestResponsibleRole` la expone al borde.

Resolver exige una respuesta fundada con tres datos: `outcome` (`granted`, `partially_granted` o `denied`), `reasons` en lenguaje comprensible para el titular y `responsibleId` de la sesión autenticada. El actor que ejecuta la transición y quien firma la respuesta deben ser la misma persona; el dominio rechaza la discrepancia para que el historial no atribuya una decisión a otra persona. `respondedAt` lo fija el servidor. El dominio no conoce sesiones ni roles: que el retiro lo haga el titular y que la respuesta la firme el Administrador se verifica en Aplicación, con la identidad del servidor y `isPrivacyRequestResponsibleRole`.

Una respuesta de bloqueo concedida, total o parcialmente, lleva obligatoriamente `temporaryBlockUntil`: el instante hasta el que se mantiene la suspensión, que debe ser posterior a la respuesta. Un bloqueo denegado no lo lleva y ningún otro derecho puede usarlo, para no crear una representación paralela del bloqueo. La respuesta denegada debe informar que el titular puede reclamar ante la Agencia; el texto jurídico definitivo queda pendiente de validación.

`respondedAt` es el instante en que se emite la respuesta; la notificación al titular puede ocurrir después. El reclamo ante la Agencia se cuenta desde `notifiedAt`, no desde `respondedAt`, porque el plazo existe cuando el titular conoce la decisión.

## Plazos

Los plazos son dominio puro y deterministas: reciben el instante de recepción o notificación, la zona horaria IANA y los feriados explícitos. No leen `Date.now`, no usan la zona del servidor y no consultan un proveedor externo. La agenda institucional usa `America/Santiago`; los plazos de privacidad reciben la zona como dato y la capa de Aplicación deberá pasar esa misma zona. Los feriados son datos explícitos porque el calendario institucional todavía no está aprobado.

| Plazo                         | Regla                                                 | Cómputo                                                                 | Función canónica                           |
| ----------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------ |
| Respuesta general             | 30 días corridos                                      | Recepción como día 0; vencimiento exclusivo al inicio del día siguiente | `calculatePrivacyResponseDeadline`         |
| Prórroga                      | Una sola, de hasta 30 días corridos                   | Suma días corridos al vencimiento original; no se aplica al bloqueo     | `applyPrivacyResponseExtension`            |
| Respuesta de bloqueo temporal | 2 días hábiles                                        | Recepción como día 0; sábados, domingos y feriados no cuentan           | `calculatePrivacyBlockingResponseDeadline` |
| Reclamo ante la Agencia       | 30 días hábiles desde la notificación de la respuesta | Notificación como día 0; sábados, domingos y feriados no cuentan        | `calculatePrivacyAgencyClaimDeadline`      |

El vencimiento es exclusivo: una respuesta en el instante exacto del vencimiento queda fuera y cualquier instante anterior queda dentro (`isWithinPrivacyDeadline`). La prórroga no muta el plazo original y se rechaza si ya fue aplicada, si el plazo es de bloqueo o si los días no son un entero entre 1 y 30. La recepción en fin de semana o feriado no se mueve: es el día 0 y el conteo empieza al día siguiente.

Ejemplos con datos ficticios, sin feriados:

| Ejemplo                                           | Recepción o notificación          | Último día cubierto | Vencimiento exclusivo             |
| ------------------------------------------------- | --------------------------------- | ------------------- | --------------------------------- |
| Acceso recibido miércoles 4 de noviembre de 2026  | 2026-11-04 12:00 America/Santiago | 2026-12-04          | 2026-12-05 00:00 America/Santiago |
| Bloqueo recibido viernes 6 de noviembre de 2026   | 2026-11-06 15:00 America/Santiago | 2026-11-10          | 2026-11-11 00:00 America/Santiago |
| Reclamo notificado martes 10 de noviembre de 2026 | 2026-11-10 10:00 America/Santiago | 2026-12-22          | 2026-12-23 00:00 America/Santiago |

El cómputo exacto del plazo legal —incluido si el día de recepción debe contarse y qué feriados aplican— requiere validación institucional. Este documento fija una regla explícita y comprobable para la prueba, no una interpretación jurídica definitiva.

## Lo acordado para la prueba y lo que falta

Acordado y comprobable en dominio:

- Los seis derechos, sus valores de código y sus etiquetas en español.
- Los estados, las transiciones válidas y el rechazo de las inválidas.
- La respuesta fundada con resultado, fundamento, responsable y fecha.
- El bloqueo temporal solo en una solicitud de bloqueo.
- El canal del Estudiante y el canal institucional de los demás roles.
- Los plazos de 30 días corridos, la prórroga única de hasta 30, los 2 días hábiles del bloqueo y los 30 días hábiles del reclamo.
- Los límites del vencimiento y el efecto de feriados y fines de semana.

Requiere decisión institucional antes de usar datos reales:

- Designar al responsable institucional de privacidad y su reemplazo.
- Definir la dirección y el procedimiento del canal institucional para roles que no son estudiantes.
- Validar jurídicamente la fundamentación y el texto de la respuesta, incluida la indicación del reclamo ante la Agencia.
- Confirmar el cómputo de los plazos, el día de recepción que se cuenta y los feriados aplicables.
- Definir cómo se ejecutan el bloqueo, la supresión y la portabilidad sobre los datos reales.
- Aprobar este procedimiento como política de la UCT antes de un piloto con solicitudes reales.

`PENDING_INSTITUTIONAL_DECISIONS` enumera las cinco primeras en código para que ningún consumidor las presente como decisiones ya tomadas. La sexta es el acto institucional que las agrupa.
