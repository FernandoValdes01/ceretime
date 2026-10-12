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

Toda denegación responde el error genérico, sin motivo ni existencia del recurso. El `studentId` siempre sale del perfil del servidor, nunca del cliente.

## Cierres sin acompañamiento (TI2-85)

Dos casos de uso de `commands.ts` que todavía no tienen entrada pública. Reciben la identidad ya resuelta, como los demás, y se prueban en `convex/tests/requests.test.ts` y `convex/tests/acceptance.test.ts` dentro de `t.run`.

| Caso de uso                        | Quién                                     | Qué hace                                                                                                            |
| ---------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `cancelRequest`                    | Estudiante vigente, dueño de la solicitud | Mueve `received`, `under_review` o `awaiting_information_or_acceptance` a `cancelled` con motivo obligatorio        |
| `closeRequestWithoutAccompaniment` | Profesional vigente con toma activa       | Mueve `under_review` o `awaiting_information_or_acceptance` a `closed_without_accompaniment` con motivo obligatorio |

Ninguno abre acompañamiento. Persisten el estado y el registro del cambio en la misma transacción, y un rechazo no escribe nada. Rechazos con mensaje específico: "Se requiere el motivo para cancelar la solicitud", "La solicitud no admite la cancelación en su estado actual", "Se requiere el motivo para cerrar la solicitud sin acompañamiento" y "La solicitud no admite el cierre sin acompañamiento en su estado actual". Una solicitud ajena, inexistente o sin toma recibe la denegación genérica.

Mientras tanto, `listOwnRequests` y `listAuthorizedRequests` omiten las solicitudes canceladas o cerradas, y `getRequest` y las mutations las rechazan.

Publicarlos exige ampliar el contrato de estados de `api.presentation.requests.*` y el mapeo de Mobile, coordinado con TI4: ver [`state-model.md`](../../domain/requests/state-model.md#contrato-público).

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

Los errores están normalizados: toda denegación responde `No autorizado` sin motivo ni existencia del recurso, y todo rechazo operativo responde un mensaje en español que indica qué corregir (motivo faltante, estado que no admite el paso, duplicados, objetivo o necesidad de acceso) sin modificar nada.

## Validación

`bun install --frozen-lockfile`, `bun run test:convex`, `tsc` de funciones y de pruebas, `bun run lint` y formato `oxfmt`, todo en verde.
