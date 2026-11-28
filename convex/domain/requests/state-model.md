# Modelo de estados — Solicitud de acompañamiento

Fuente: TI2-7, TI2-21 y TI2-22 (Sprint 1), TI2-85 (Sprint 2), TI2-141, TI2-143 y la revisión TI4-84 (Sprint 3) y el documento de requerimientos, sección "Estados y ciclos de vida". Este archivo es la evidencia de cierre de esos issues; el modelo ejecutable vive en [`state.ts`](./state.ts), [`transitions.ts`](./transitions.ts) y [`transition_policy.ts`](./transition_policy.ts).

## Diagrama

```mermaid
stateDiagram-v2
    direction LR

    [*] --> received

    received --> under_review
    under_review --> awaiting_information_or_acceptance : exige motivo
    under_review --> accepted
    awaiting_information_or_acceptance --> accepted
    awaiting_information_or_acceptance --> under_review : exige motivo

    under_review --> received
    awaiting_information_or_acceptance --> received

    received --> cancelled : exige motivo
    under_review --> cancelled : exige motivo
    awaiting_information_or_acceptance --> cancelled : exige motivo
    under_review --> closed_without_accompaniment : exige motivo
    awaiting_information_or_acceptance --> closed_without_accompaniment : exige motivo

    under_review --> referred : exige motivo
    awaiting_information_or_acceptance --> referred : exige motivo

    accepted --> [*] : abre exactamente un acompañamiento
    referred --> [*]
    cancelled --> [*]
    closed_without_accompaniment --> [*]

    classDef sprint1 fill:#dbeafe,stroke:#1d4ed8,color:#1e3a8a
    classDef closure fill:#f3f4f6,stroke:#4b5563,color:#111827
    classDef referral fill:#fef3c7,stroke:#b45309,color:#78350f
    class received,under_review,awaiting_information_or_acceptance,accepted sprint1
    class closed_without_accompaniment,cancelled closure
    class referred referral
```

Las transiciones del diagrama son exactamente las de `SPRINT_1_REQUEST_TRANSITIONS`, `RESPONSE_REQUEST_TRANSITIONS`, `RELEASE_REQUEST_TRANSITIONS`, `REFERRAL_REQUEST_TRANSITIONS` y `CLOSURE_REQUEST_TRANSITIONS`. Cualquier otro par origen-destino es inválido, incluidos los saltos hacia adelante, los demás retrocesos y cualquier salida de un estado terminal.

[`state_model.test.ts`](./state_model.test.ts) lee este archivo y falla si el diagrama o las tablas dejan de coincidir con `state.ts` y `transitions.ts`; si editas cualquiera de ellos, corre `bunx vitest run convex/domain/requests`.

## Implementado en Sprint 1

| Estado                               | Etiqueta en interfaz               | Rol que lo provoca                                          |
| ------------------------------------ | ---------------------------------- | ----------------------------------------------------------- |
| `received`                           | Recibida                           | Estudiante, o personal autorizado desde canal institucional |
| `under_review`                       | En revisión                        | Profesional de CERETI                                       |
| `awaiting_information_or_acceptance` | Esperando información o aceptación | Profesional de CERETI                                       |
| `accepted`                           | Aceptada                           | Profesional de CERETI                                       |

`received` es el estado inicial. La revisión es humana: no hay aceptación automática, según RN-23 del documento de requerimientos.

La columna de rol describe quién provoca cada estado en el flujo, no la autorización efectiva. Esa vive en [`permissions-matrix.md`](../authorization/permissions-matrix.md), que en este incremento cubre acompañamientos y notas internas y deja las solicitudes explícitamente fuera. Mientras eso no cambie, ningún control de acceso se apoya en esta columna.

## Implementado en Sprint 2 (TI2-85)

| Estado                         | Etiqueta en interfaz       | Rol que lo provoca                    |
| ------------------------------ | -------------------------- | ------------------------------------- |
| `closed_without_accompaniment` | Cerrada sin acompañamiento | Profesional de CERETI con toma activa |
| `cancelled`                    | Cancelada                  | Estudiante dueño de la solicitud      |

Los dos son terminales: cierran la solicitud sin abrir acompañamiento y de ellos no sale ninguna transición. Una necesidad posterior empieza con una solicitud nueva.

## Implementado en Sprint 3 (TI2-143)

| Estado     | Etiqueta en interfaz | Rol que lo provoca                    |
| ---------- | -------------------- | ------------------------------------- |
| `referred` | Derivada             | Profesional de CERETI con toma activa |

Es terminal: la derivación de salida cierra la solicitud en CERETI sin abrir acompañamiento y de ella no sale ninguna transición. Una necesidad posterior empieza con una solicitud nueva.

## Cierres sin acompañamiento

| Origen                               | Destino                        | Quién lo intenta                 | Exige motivo |
| ------------------------------------ | ------------------------------ | -------------------------------- | ------------ |
| `received`                           | `cancelled`                    | Estudiante dueño, cuenta vigente | Sí           |
| `under_review`                       | `cancelled`                    | Estudiante dueño, cuenta vigente | Sí           |
| `awaiting_information_or_acceptance` | `cancelled`                    | Estudiante dueño, cuenta vigente | Sí           |
| `under_review`                       | `closed_without_accompaniment` | Profesional vigente con toma     | Sí           |
| `awaiting_information_or_acceptance` | `closed_without_accompaniment` | Profesional vigente con toma     | Sí           |

Los orígenes son una decisión provisional de TI2-85: el documento de requerimientos deja los estados completos y sus excepciones pendientes (PV-04). La regla que los ordena es que la solicitud se puede cancelar o cerrar mientras sigue abierta y nunca después de aceptarla, porque la aceptación ya abrió su acompañamiento. El Profesional no cierra desde `received` porque tomarla ya la pasa a `under_review`.

El motivo es obligatorio en los cinco pasos. Al cerrar es la "razón comprensible" que pide la especificación del prototipo; al cancelar deja trazado por qué terminó la solicitud. Esta regla es de solicitudes y no se mezcla con la de cancelar una atención, donde CERETI debe dar motivo y para el estudiante es opcional.

La columna "Quién lo intenta" la exige la capa de aplicación (`cancelRequest` y `closeRequestWithoutAccompaniment` en [`commands.ts`](../../application/requests/commands.ts)), no esta tabla: el dominio decide qué pares existen y si falta el motivo.

## Respuesta del Estudiante (TI2-141)

| Origen                               | Destino        | Quién lo intenta                 | Exige motivo |
| ------------------------------------ | -------------- | -------------------------------- | ------------ |
| `awaiting_information_or_acceptance` | `under_review` | Estudiante dueño, cuenta vigente | Sí           |

Cuando el Profesional pide información, la solicitud queda en espera. El Estudiante responde y la solicitud vuelve a revisión, para que quien la tomó la retome: aceptarla, pedir más información o cerrarla. Es un retroceso, como la liberación de la toma. El motivo es la respuesta misma, por eso es obligatorio; queda en el historial de cambios con el Estudiante como actor, sin un campo nuevo en la solicitud. La respuesta tiene un tope de `REQUEST_RESPONSE_MAX_LENGTH` caracteres, que aplica la capa de aplicación.

El par `received -> under_review` también existe en las tablas, pero es la toma del Profesional. Que el Estudiante solo pueda responder desde la espera lo exige `respondToInformationRequest` en [`respond.ts`](../../application/requests/respond.ts), igual que la columna "Quién lo intenta".

El detalle de la solicitud (`getRequest`) entrega al Estudiante dueño y al Profesional con toma lo pedido mientras la solicitud espera respuesta (`informationRequest`), la respuesta al último pedido (`informationResponse`) y la razón de cierre (`closureReason`). Son textos libres: no viajan en los listados ni en la bandeja.

## Liberación de la toma (TI4-84)

| Origen                               | Destino    | Quién lo intenta                                                        | Exige motivo |
| ------------------------------------ | ---------- | ----------------------------------------------------------------------- | ------------ |
| `under_review`                       | `received` | Profesional con la toma activa, o el Administrador al revocar su cuenta | No           |
| `awaiting_information_or_acceptance` | `received` | Profesional con la toma activa, o el Administrador al revocar su cuenta | No           |

Liberar devuelve la solicitud a `received` y la deja otra vez en la bandeja, para que otro Profesional la tome. La toma (`requestAssignments`, `TOMAS_SOLICITUD` del MER) tiene su propia unión de estados en [`take.ts`](./take.ts): `active`, `revoked` y `finished`. Liberar deja la toma `revoked` con quién la liberó y cuándo, que es `liberadaEn` del MER, y quien la liberó deja de leer la solicitud. Nadie reasigna una toma a otro Profesional: administrar cuentas no da acceso a las solicitudes.

Si la solicitud esperaba información del Estudiante, lo pedido queda en el historial pero deja de esperarse: una solicitud recibida no admite respuesta, y quien la tome después decide si vuelve a pedirlo. La liberación no avisa al Estudiante, porque es interna de CERETI.

Cuando la solicitud llega a un estado terminal (aceptada, cerrada, derivada o cancelada), sus tomas activas pasan a `finished` con `finishedAt`. Quien la revisó la sigue leyendo y la sigue viendo en sus tomadas, pero ya no la opera.

## Derivación de salida (TI2-143)

| Origen                               | Destino    | Quién lo intenta             | Exige motivo |
| ------------------------------------ | ---------- | ---------------------------- | ------------ |
| `under_review`                       | `referred` | Profesional vigente con toma | Sí           |
| `awaiting_information_or_acceptance` | `referred` | Profesional vigente con toma | Sí           |

CERETI deriva al estudiante a otra unidad mientras revisa su solicitud. Los orígenes son los mismos del cierre sin acompañamiento y por la misma razón: el Profesional no deriva una recibida porque tomarla ya la pasa a `under_review`, y no deriva una aceptada porque ya abrió su acompañamiento.

El motivo es obligatorio: es la razón comprensible que lee el estudiante. Junto al estado se guarda la derivación (`outgoingReferral`): la unidad de destino por su nombre, la fecha, quién derivó y esa razón. No se piden destinatarios ni antecedentes, porque la comunicación con la unidad de destino ocurre fuera de la aplicación.

El aviso al estudiante queda registrado como el cambio de estado en el historial de la solicitud, con actor y fecha, más la derivación legible en el detalle. El envío real del aviso no es de esta capa.

## Derivación de entrada (TI2-143)

Una derivación de entrada es el aviso de otra unidad de la Universidad sobre una posible necesidad de un estudiante. La registra personal de CERETI por el canal oficial y nace como una solicitud `received` con su procedencia y la unidad de origen (`incomingReferral`). No es un estado: recorre los mismos estados que cualquier solicitud.

Lo que cambia es la apertura del acompañamiento. Según RN-24, CERETI debe contactar al estudiante y este debe aceptar antes de abrir un acompañamiento. [`referral.ts`](./referral.ts) fija ese orden sin leer ni escribir la base de datos:

| Paso       | Regla                                                             | Rechazo                                                  |
| ---------- | ----------------------------------------------------------------- | -------------------------------------------------------- |
| Contacto   | Se registra una sola vez, con quién contactó y cuándo             | `not_a_referral`, `already_contacted`                    |
| Aceptación | Exige el contacto previo y se registra una sola vez, con su fecha | `not_a_referral`, `contact_required`, `already_accepted` |

`referralAllowsAccompaniment` es falso mientras falte el contacto o la aceptación, y la aceptación de la solicitud lo consulta antes de abrir: una derivación sin aceptación no abre acompañamiento. Una solicitud que no viene de una derivación no tiene esta condición.

## Política de transición

La política la entregó TI2-21 y vive en [`transition_policy.ts`](./transition_policy.ts). Es dominio puro: recibe un intento, decide si procede y devuelve el resultado como valor, sin leer ni escribir la base de datos. Persistir y decidir cuánto se le revela al cliente son responsabilidad de la capa de aplicación.

Un intento trae origen, destino, actor, instante y, cuando corresponde, motivo. El origen y el destino admiten cualquier estado declarado: la política es el único punto que rechaza un par, así ninguna capa superior necesita filtrarlo antes.

Hay cuatro causas de rechazo. Se evalúan de la más general a la más específica, de modo que la causa reportada es la primera que el llamador tiene que resolver.

| Causa                    | Cuándo se devuelve                                                                                                         |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `transition_not_allowed` | El par origen-destino no está en las tablas: saltos, retrocesos, quedarse en el mismo estado y salir de un estado terminal |
| `actor_required`         | El identificador del actor llega vacío o solo con espacios                                                                 |
| `occurred_at_invalid`    | El instante no es un número finito y positivo                                                                              |
| `reason_required`        | La fila exige motivo y no llegó, o llegó en blanco                                                                         |

Un intento rechazado no deja entrada en el historial, y no por disciplina: la política retorna antes de construirla, así que nunca llega a existir. Un intento aplicado sí la devuelve, con origen, destino, actor sin espacios sobrantes, instante y el motivo recortado cuando lo hubo. La entrada se arma desde la fila de la tabla y no desde el intento, así solo puede contener estados declarados.

## Apertura del acompañamiento

CA-04 del documento de requerimientos exige que una solicitud aceptada cree exactamente el acompañamiento asociado. El dominio llega hasta la puerta: cuando un intento aplicado termina en `accepted`, el resultado marca que corresponde abrir el acompañamiento. Cancelar, cerrar o derivar nunca lo marcan.

Esa marca no garantiza unicidad, y es deliberado. La política no conoce la solicitud ni su historial, así que repetir un intento válido la vuelve a emitir. Garantizar que se abra uno solo exige leer y actualizar el estado persistido de forma atómica, y eso es el caso de uso de TI2-24.

Lo que sí garantiza esta capa es que, partiendo del estado real, no hay segunda aceptación: [`transitions.test.ts`](./transitions.test.ts) fija que de la aceptación no sale ninguna fila, y [`transition_policy.test.ts`](./transition_policy.test.ts) acepta de verdad y comprueba que el segundo intento, partiendo del estado que dejó el primero, se rechaza. Con los cierres y la derivación pasa lo mismo: tras cancelar, cerrar o derivar, ningún intento posterior procede.

## Cómo se protege el alcance

`SPRINT_1_REQUEST_TRANSITIONS` tipa `from` y `to` como `Sprint1RequestState`, `CLOSURE_REQUEST_TRANSITIONS` tipa `from` como `Sprint1RequestState` y `to` como `ClosureRequestState`, y `REFERRAL_REQUEST_TRANSITIONS` tipa `from` como `Sprint1RequestState` y `to` como `ReferralRequestState`. Agregar a la primera un cierre o una derivación, o agregar a cualquiera de las otras una salida desde un estado terminal, no compila. La garantía es del compilador, no de la disciplina de quien edite el archivo.

`RequestStatusChange`, la escritura del estado vigente, solo admite `referred` junto con su derivación de salida, igual que el cierre con su razón: una solicitud derivada que no diga a dónde no compila.

## Contrato público

Desde TI2-141, `api.presentation.requests.*` declara los siete estados de `REQUEST_STATES` (`requestStatusUnion` en `convex/infrastructure/validators.ts`). `referred` forma parte del contrato desde entonces, para que Web y Mobile mapeen el conjunto completo una sola vez, y desde TI2-143 una fila puede traerlo. Declarar los siete fue un cambio incompatible para un cliente con mapeo exhaustivo de cuatro estados, y está descrito en `docs/contratos-sprint-3/solicitudes.md`.

`cancelRequest` y `closeRequestWithoutAccompaniment` tienen entrada pública. Las lecturas ya no omiten ni rechazan una solicitud cerrada o cancelada: `listOwnRequests`, `listAuthorizedRequests` y `getRequest` la entregan con su estado. La bandeja `listOpenRequests` sigue trayendo solo `received`.

## Casos cubiertos por pruebas

Las pruebas del dominio de la solicitud viven en [`state.test.ts`](./state.test.ts), [`transitions.test.ts`](./transitions.test.ts), [`transition_policy.test.ts`](./transition_policy.test.ts), [`state_model.test.ts`](./state_model.test.ts), [`request.test.ts`](./request.test.ts) y [`referral.test.ts`](./referral.test.ts). `bun run test:convex` las corre junto al resto del backend; para correr solo estas:

```bash
bunx vitest run convex/domain/requests
```

Positivos: las transiciones declaradas se aplican y devuelven actor, origen, destino, instante y el motivo cuando llega; el paso a espera, los cinco cierres y la derivación de salida conservan el motivo recortado; llegar a la aceptación marca que corresponde abrir el acompañamiento y ningún cierre ni derivación lo marca; el estado inicial es `received` y queda reconocido como estado con operación; los siete estados tienen etiqueta visible y una sola definición; el diagrama dibuja exactamente las transiciones de las tablas, marca "exige motivo" donde la tabla lo exige, entra por el estado inicial y sale por los cuatro estados terminales; la derivación de entrada registra el contacto y, después, la aceptación; las tablas no repiten filas, no dejan la solicitud donde ya estaba, alcanzan todos los estados desde el inicial, y desde todo estado abierto se puede cancelar; la proyección adapta una fila cerrada o cancelada.

Negativos: todo par ausente de las tablas se rechaza sin tocar el estado, incluidos los saltos, los retrocesos, quedarse en el mismo estado, aceptar dos veces, cancelar o cerrar una aceptada y repetir un cierre, tanto con el par escrito a mano como partiendo del estado que dejó el primer intento; el paso a espera y los cierres sin motivo, o con un motivo en blanco, se rechazan; el actor vacío o solo con espacios se rechaza; un instante que no es un número finito y positivo se rechaza; un rechazo no trae entrada de historial y deja el intento intacto, y cada causa declarada tiene un intento que la provoca; una recibida o una aceptada no se derivan y de `referred` no sale ningún intento; la aceptación de una derivación de entrada sin contacto se rechaza y una derivación sin aceptación no permite abrir acompañamiento; el Profesional no cierra una recibida.

Lo que estas pruebas no cubren, porque vive fuera del dominio: quién está autorizado a intentar una transición, la persistencia del estado y de su historial, el evento de auditoría y la unicidad del acompañamiento. Las pruebas de integración de los dos cierres viven en [`requests.test.ts`](../../tests/requests.test.ts) y [`acceptance.test.ts`](../../tests/acceptance.test.ts).

## Historial de cambios y auditoría

Una transición aplicada deja dos rastros distintos, y no deben confundirse.

El **historial de cambios de estado** es parte de la solicitud. Cada transición aplicada produce una entrada con origen, destino, actor, instante y, cuando lo hubo, el motivo; la capa de aplicación la guarda en `requestTransitions`, junto al estado resultante y en la misma transacción, como hacen los casos de uso de TI2-9. El actor es el Profesional o, al cancelar o responder, el propio Estudiante. El motivo se conserva ahí porque le explica al estudiante qué información falta o por qué se cerró o, al cancelar, deja trazado por qué el Estudiante terminó la solicitud, y queda protegido por el mismo control de acceso que la solicitud.

El **evento de auditoría** es lo que exige RD-03: registra solo actor, fecha, acción, recurso y resultado, sin contenido sensible, como piden también RF-31, RN-19 y RNF-11. **El motivo no se copia a la bitácora de auditoría**: es texto libre y puede traer necesidades de acceso u otros datos sensibles. El evento de auditoría de las transiciones de solicitud todavía no tiene tabla y no se crea en este issue.

Quien escribe el motivo no debe incluir diagnósticos ni etiquetas clínicas, por la Ley 21.719. Como el sistema no puede garantizar qué texto recibe, el motivo se trata como potencialmente sensible. Todo lo que se prueba acá opera con datos ficticios.

## Qué queda para otros issues

| Issue   | Qué le corresponde                                                                                                                   |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| TI2-21  | La función que aplica una transición, rechaza las inválidas y exige motivo.                                                          |
| TI2-16  | La persistencia: tabla de solicitudes y validadores de Convex derivados de estos literales.                                          |
| TI2-8   | Los contratos compartidos, incluida la entidad de solicitud y el mapa de estado a etiqueta en español.                               |
| TI2-24  | La apertura única del acompañamiento: leer y actualizar el estado persistido de forma atómica, según CA-04.                          |
| TI2-22  | Entregado: el diagrama y las tablas atados al código, las pruebas propias de los estados y de la tabla como grafo, y este documento. |
| TI2-85  | Entregado: los cierres sin acompañamiento en dominio y aplicación, con sus pruebas.                                                  |
| TI2-141 | Entregado: la entrada pública de cancelar y cerrar, los siete estados en el contrato público y la respuesta del Estudiante.          |
| TI2-143 | Entregado: la derivación de salida, las reglas de la derivación de entrada y el registro por canal oficial.                          |
| TI2-150 | El evento de aviso al estudiante sobre los cambios de su solicitud, incluida la derivación.                                          |
