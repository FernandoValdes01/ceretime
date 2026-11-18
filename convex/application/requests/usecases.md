# Casos de uso — solicitudes (TI2-9)

Evidencia de cierre de TI2-9: endpoints públicos de solicitudes para Estudiante y Profesional. Solo servidor, sin UI y sin saltarse Aplicación ni Dominio. Todo opera con DATOS FICTICIOS.

## Operaciones

| Endpoint                                             | Quién               | Qué hace                                                                                                                  |
| ---------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `presentation/requests.createRequest`                | Estudiante vigente  | Registra en `received` y devuelve la entidad pública canónica (TI2-8)                                                     |
| `presentation/requests.listOwnRequests`              | Estudiante vigente  | Lista solo sus solicitudes, paginado                                                                                      |
| `presentation/requests.listAuthorizedRequests`       | Profesional vigente | Lista solicitudes tomadas por él, paginado                                                                                |
| `presentation/requests.listOpenRequests`             | Profesional vigente | Bandeja de triage: solo `received`, minimizada (sin `accessNeeds`), paginado                                              |
| `presentation/requests.takeRequest`                  | Profesional vigente | Toma una `received` para sí e inicia su revisión; fuera de recibida o con toma activa se rechaza                          |
| `presentation/requests.requestAdditionalInformation` | Profesional vigente | Mueve `under_review` a `awaiting_information_or_acceptance` con motivo obligatorio, aplicando la política de TI2-21       |
| `presentation/requests.acceptRequest`                | Profesional vigente | Acepta (`under_review` o espera hacia `accepted`) y abre exactamente un acompañamiento con su asignación inicial (TI2-24) |

Toda denegación responde `{ code: "unauthorized", message: "No autorizado" }`, sin motivo ni existencia del recurso, también en estas operaciones de Sprint 1 y en la forma anterior de `createRequest` desde TI2-181. Tomar una solicitud que ya no está recibida, o que ya tomaste, responde `conflict`. El `studentId` siempre sale del perfil del servidor, nunca del cliente.

## Cierres sin acompañamiento (TI2-85, TI2-141)

Dos casos de uso de `commands.ts`, con entrada pública desde TI2-141. Se prueban por `api.presentation.requests.*` en `convex/tests/requests.test.ts` y `convex/tests/acceptance.test.ts`.

| Endpoint                                                 | Quién                                     | Qué hace                                                                                                                                                           |
| -------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `presentation/requests.cancelRequest`                    | Estudiante vigente, dueño de la solicitud | Mueve `received`, `under_review` o `awaiting_information_or_acceptance` a `cancelled` con motivo obligatorio                                                       |
| `presentation/requests.closeRequestWithoutAccompaniment` | Profesional vigente con toma activa       | Mueve `under_review` o `awaiting_information_or_acceptance` a `closed_without_accompaniment` con razón obligatoria, que queda como `closureReason` de la solicitud |

Ninguno abre acompañamiento. Persisten el estado y el registro del cambio en la misma transacción, y un rechazo no escribe nada. Al cerrar, la razón se escribe además en `closureReason`, en esa misma transacción. Desde TI2-141 devuelven `ApiResult` y Presentación lo traduce con `unwrapApiResult` al contrato común `ConvexError({code, message})`: `request_fields_invalid` para "Se requiere el motivo para cancelar la solicitud." y "Se requiere el motivo para cerrar la solicitud sin acompañamiento.", y `conflict` para "La solicitud no admite la cancelación en su estado actual." y "La solicitud no admite el cierre sin acompañamiento en su estado actual.". Una solicitud ajena, inexistente o sin toma recibe `unauthorized`.

`listOwnRequests`, `listAuthorizedRequests` y `getRequest` entregan las solicitudes canceladas o cerradas con su estado: el contrato público declara los siete estados (ver [`state-model.md`](../../domain/requests/state-model.md#contrato-público)).

## Respuesta del Estudiante (TI2-141)

`presentation/requests.respondToInformationRequest` recibe `requestId` y `response`. Solo el Estudiante dueño con cuenta vigente, y solo mientras la solicitud está en `awaiting_information_or_acceptance`: la devuelve a `under_review` y guarda la respuesta como motivo del cambio, con actor y fecha, en la misma transacción. La respuesta la normaliza Dominio con `toInformationResponse`. Rechazos con el contrato común: `request_fields_invalid` para "Se requiere la respuesta a la información pedida." y "La respuesta supera el máximo permitido (2000 caracteres).", y `conflict` para "La solicitud no admite una respuesta en su estado actual.". Una solicitud ajena o inexistente recibe `unauthorized`.

`respond.ts` declara `RespondToInformationRequestDeps` con los puertos de `ports.ts` (perfil vigente, lectura de la solicitud, escritura del estado, registro del cambio y reloj), y `presentation/requests.ts` compone `activeStudentReader(ctx)` y `requestStore(ctx)`, los dos de Infraestructura, con el mismo `ctx`, así todo sigue en una sola mutation. Se prueba con dobles en memoria en `respond.test.ts`. Desde TI2-181 el resto del módulo sigue el mismo diseño (ver «Puertos y contrato común»).

`getRequest` entrega además `informationRequest` (lo pedido, solo mientras espera respuesta), `informationResponse` (la respuesta al último pedido: si el Profesional vuelve a pedir, la anterior deja de venir hasta que llegue la nueva) y `closureReason`, al Estudiante dueño y al Profesional con toma.

## Envío completo (TI2-141)

`presentation/requests.createRequest` acepta la forma completa (necesidad, resultado esperado, necesidades de acceso como lista y texto libre, modalidad, disponibilidad general, medio accesible e `idempotencyKey`) o la forma anterior, solo con `accessNeeds`. La forma completa autoriza antes de validar, exige sus campos con `toCompleteSubmission`, los valida en Dominio con `toRequestSubmission` y se guarda una sola vez por `idempotencyKey`: un reintento con la misma clave devuelve la solicitud ya creada. Sus rechazos usan `request_fields_invalid` (y `access_needs_*` para las necesidades de acceso) y su denegación `unauthorized`. Desde TI2-181 la forma anterior deniega con `unauthorized` y rechaza con `access_needs_empty` o `access_needs_too_long`. Topes, reglas y ejemplos en [`docs/contratos-sprint-3/solicitudes.md`](../../../docs/contratos-sprint-3/solicitudes.md).

## Canal oficial y derivaciones (TI2-143)

Cuatro casos de uso de `referrals.ts`, con las reglas en Dominio ([`referral.ts`](../../domain/requests/referral.ts) y la política de transición). El personal autorizado es el Profesional con cuenta vigente.

| Endpoint                                         | Quién                               | Qué hace                                                                                                                                |
| ------------------------------------------------ | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `presentation/requests.registerOfficialRequest`  | Profesional vigente                 | Registra en `received` la solicitud de un Estudiante, con procedencia `official_channel`; con `originUnit` es una derivación de entrada |
| `presentation/requests.recordReferralContact`    | Profesional vigente con toma activa | Guarda quién contactó al estudiante y cuándo, una sola vez, sin cambiar el estado                                                       |
| `presentation/requests.recordReferralAcceptance` | Profesional vigente con toma activa | Guarda cuándo aceptó el estudiante; exige el contacto previo                                                                            |
| `presentation/requests.referRequest`             | Profesional vigente con toma activa | Mueve `under_review` o `awaiting_information_or_acceptance` a `referred` con la unidad de destino y la razón, sin abrir acompañamiento  |

El registro reutiliza `toCompleteSubmission`, `toRequestSubmission` y la clave de idempotencia de `createRequest`: no hay otra forma de solicitud. El Estudiante se identifica por su correo, que el puerto `ActiveStudentByEmailReader` resuelve solo si es de una cuenta de Estudiante vigente.

`acceptRequest` consulta `referralAllowsAccompaniment` antes de escribir: una derivación de entrada sin contacto o sin aceptación responde `conflict` y no abre acompañamiento.

`referRequest` escribe el estado y la derivación de salida en una sola escritura, por el mismo camino que los demás cambios de estado: `toStatusChange` arma la variante `{ status: "referred", outgoingReferral }` de `RequestStatusChange` y `setRequestStatus` la guarda, igual que el cierre con su razón. El registro del cambio en `requestTransitions`, con la razón, el actor y la fecha, es el aviso al estudiante que queda en el sistema. El evento de aviso y su envío son de TI2-150.

Se prueban por `api.presentation.requests.*` en `convex/tests/requests.test.ts` (permisos, transiciones inválidas y rechazos sin escritura) y en `convex/domain/requests/referral.test.ts`.

## Puertos y contrato común (TI2-181)

Ningún caso de uso de `convex/application/requests/` importa el contexto de Convex ni repositorios concretos. Cada operación de `commands.ts` y `queries.ts` declara sus `deps` con los puertos de `ports.ts` y devuelve `ApiResult`; `presentation/requests.ts` compone los adaptadores de Infraestructura (`requestStore`, `requestReader`, `activeStudentReader`, `activeStudentByEmailReader`, `activeProfessionalReader`, `activeRequestViewerReader` y `accompanimentOpener`) con el mismo `ctx`, así cada mutation sigue siendo una sola transacción, y traduce el resultado con `unwrapApiResult`. La paginación usa solo los tipos `PaginationOptions` y `PaginationResult` de Convex, para que las opciones del cliente lleguen al índice sin rearmarlas. Se prueba con dobles en memoria en `take.test.ts`, `review.test.ts` y `register.test.ts`, y por la API pública en `convex/tests/requests.test.ts`.

## Alcance explícito

- El Profesional solo opera solicitudes con toma activa a su nombre; la toma es manual y queda auditada (quién y cuándo). Sin toma no hay acceso.
- Persiste el estado resultante y el registro del cambio (motivo, actor y fecha) en la misma transacción, en la bitácora `requestTransitions`.
- Se guarda el texto de necesidades de acceso; convertir el contenido estructurado a la forma persistida es alcance de TI2-23.

## Superficie API del Sprint 1 (TI2-26)

Evidencia de cierre de TI2-26: las mutations públicas son adaptadores delgados que validan la forma de entrada, resuelven la identidad en el servidor y delegan las reglas en Aplicación/Dominio. Solo servidor, sin UI y sin trasladar reglas de seguridad a los clientes. Todo opera con DATOS FICTICIOS.

Las cuatro mutations públicas del Sprint 1 son `createRequest`, `takeRequest`, `requestAdditionalInformation` y `acceptRequest` (ver tabla de arriba); no se agrega ninguna otra escritura pública en este alcance.

La habilitación de cuentas (`internal.operations.accounts.enableIntern`, `internal.operations.accounts.ensureBootstrapAdmin`) y la concesión o revocación de accesos (`internal.operations.assignments.assign`, `internal.operations.assignments.revoke`) siguen en sus vías internas guardadas con autorización en el servidor: ningún cliente las invoca directo y habilitar jamás concede acompañamientos (TI2-11, TI2-28).

El Sprint 1 no usa `action`: no hay integraciones ni trabajo que lo requiera y la autenticación institucional corre por las rutas HTTP de Better Auth (`convex/auth.ts`, `convex/http.ts`), así que no existe superficie de actions que validar.

La validación de forma vive en Aplicación/Dominio (`toAccessNeedsText`, política de TI2-21, `toOpeningObjective`): texto recortado, no vacío y hasta `ACCESS_NEEDS_MAX_LENGTH` (valor acordado con el responsable de TI2-23). Los permisos se evalúan en el servidor desde `ctx.auth.getUserIdentity()` y el `tokenIdentifier` vinculado, nunca desde identificadores del cliente.

Los errores están normalizados: desde TI2-181 toda denegación responde `unauthorized` sin motivo ni existencia del recurso, y todo rechazo operativo responde su código del contrato común (`request_fields_invalid`, `conflict` o `access_needs_*`) con un mensaje en español que indica qué corregir (motivo faltante, estado que no admite el paso, duplicados, objetivo o necesidad de acceso) sin modificar nada.

## Validación

`bun install --frozen-lockfile`, `bun run test:convex`, `tsc` de funciones y de pruebas, `bun run lint` y formato `oxfmt`, todo en verde.
