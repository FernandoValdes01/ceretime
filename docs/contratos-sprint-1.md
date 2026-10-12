# Contratos compartidos de Sprint 1 — operaciones, respuestas y errores (TI2-23)

Superficie pública versionada del Backend para los flujos comprometidos en Sprint 1: autenticación, solicitudes, acompañamiento resultante, habilitación institucional y acceso de Practicante. Todo lo que Web y Mobile consumen sale de `api.presentation.*` y de los tipos generados en `convex/_generated`; no existe API paralela y ningún consumidor debe inventar endpoints, estados o errores.

## Queries públicas

| Operación                                                | Argumentos                          | Devuelve                                                                                     | Quién                                                       | Denegación                                                                                       |
| -------------------------------------------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `presentation/session.getSessionState`                   | —                                   | `{status: "authenticated", email, name, population}` o `{status: "unauthenticated"}`         | Cualquiera                                                  | Sin identidad, correo no institucional o sesión expirada responden `unauthenticated` sin motivo  |
| `presentation/session.getSessionWithRole`                | —                                   | `{session, role}` atómicos de la misma identidad; rol con `role`+`email` o `unauthenticated` | Cualquiera                                                  | Sin identidad, sin perfil o sin vigencia responden `unauthenticated` en la mitad que corresponda |
| `presentation/session.getMyProfile`                      | —                                   | `{fullName, email, role, institutionalStatus, accountStatus}`                                | Titular con perfil (vigente o no, para entender un bloqueo) | Sin identidad o sin perfil: error genérico                                                       |
| `presentation/requests.getRequest`                       | `requestId`                         | Solicitud completa                                                                           | Estudiante dueño o Profesional con toma activa              | Error genérico, sin revelar existencia ni titularidad                                            |
| `presentation/requests.listOwnRequests`                  | `paginationOpts`                    | Página de solicitudes propias completas                                                      | Estudiante vigente                                          | Error genérico; solo sus filas                                                                   |
| `presentation/requests.listAuthorizedRequests`           | `paginationOpts`                    | Página de solicitudes tomadas por él                                                         | Profesional vigente con toma activa                         | Error genérico; sin toma no hay acceso                                                           |
| `presentation/requests.listOpenRequests`                 | `paginationOpts`                    | Bandeja `received` minimizada (sin `accessNeeds`)                                            | Profesional vigente                                         | Error genérico; solo descubrir, no autoriza a operar                                             |
| `presentation/accompaniments.getAccompaniment`           | `accompanimentId`                   | Vista completa o minimizada según rol                                                        | Estudiante dueño, Profesional o Practicante asignado        | Error genérico, sin revelar existencia                                                           |
| `presentation/accompaniments.listOwnedAccompaniments`    | `paginationOpts`                    | Página de acompañamientos propios                                                            | Estudiante vigente                                          | Error genérico                                                                                   |
| `presentation/accompaniments.listAssignedAccompaniments` | `limit`, `after?`                   | Acompañamientos asignados con paginado keyset                                                | Profesional o Practicante asignado                          | Error genérico; Administrador denegado                                                           |
| `presentation/accompaniments.getInternalNotes`           | `accompanimentId`, `paginationOpts` | Página de notas internas                                                                     | Profesional asignado                                        | Error genérico; Estudiante, Practicante y Administrador denegados                                |

## Mutations públicas

| Operación                                            | Argumentos                                        | Devuelve                                                               | Quién                       | Denegación                                                                                                                                                                |
| ---------------------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `presentation/requests.createRequest`                | `accessNeeds: string` (texto 1–2000 tras recorte) | Solicitud en `received`                                                | Estudiante vigente          | Vacío: "Se requiere describir la necesidad de acceso"; exceso: "La necesidad de acceso supera el máximo permitido (2000 caracteres)"; resto: error genérico               |
| `presentation/requests.takeRequest`                  | `requestId`                                       | Solicitud tomada                                                       | Profesional vigente         | "Solo se pueden tomar solicitudes recibidas"; "Ya tomaste esta solicitud"; "La solicitud no admite iniciar la revisión en su estado actual"; resto: error genérico        |
| `presentation/requests.requestAdditionalInformation` | `requestId`, `reason` (motivo obligatorio)        | Solicitud en espera                                                    | Profesional con toma activa | "Se requiere el motivo para pedir información adicional"; "La solicitud no admite pedir información adicional en su estado actual"; resto: error genérico                 |
| `presentation/requests.acceptRequest`                | `requestId`, `objective`                          | Vista completa del acompañamiento aceptado; crea la asignación inicial | Profesional con toma activa | "La solicitud ya fue aceptada"; "La solicitud no admite la aceptación en su estado actual"; "Se requiere el objetivo para abrir el acompañamiento"; resto: error genérico |

## Operaciones internas (solo servidor)

No forman superficie pública y ningún cliente las llama directo. Se documentan porque la checklist las exige y sus contratos rigen la vigencia que ven los guards:

| Operación                                           | Argumentos                                  | Hace                                                                                                   |
| --------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `internal.operations.assignments.assign`            | `accompanimentId`, `userId`, `assignedRole` | Crea la fila activa con `grantedBy`/`grantedAt`; exige Profesional autorizado y Practicante habilitado |
| `internal.operations.assignments.revoke`            | `accompanimentId`, `userId`, `assignedRole` | Revoca todas las filas activas de la tripla con `revokedBy`/`revokedAt`, sin borrar historial          |
| `internal.operations.accounts.enableIntern`         | `userId`                                    | Habilita la cuenta del Practicante pendiente; solo Administrador vigente                               |
| `internal.operations.accounts.ensureBootstrapAdmin` | `email`, `fullName`, `tokenIdentifier`      | Arranque administrativo inicial de un solo uso                                                         |

## Respuestas y errores

Toda denegación de autorización responde `ConvexError("No autorizado")`: mismo mensaje sin motivo y sin revelar si el recurso existe. Aplica a identidad ausente, perfil ausente o no vigente, rol ajeno, fila inexistente o ajena, y toma ausente. Las validaciones de tipo de argumentos fallan con error de validador de Convex, también sin detalles sensibles.

Los rechazos de regla y validación responden `Error` con mensaje específico en español (sin códigos, sin motivo interno):

| Operación                      | Rechazo con mensaje específico                                                                                                                     |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createRequest`                | Vacío: "Se requiere describir la necesidad de acceso"; exceso: "La necesidad de acceso supera el máximo permitido (2000 caracteres)"               |
| `takeRequest`                  | "Solo se pueden tomar solicitudes recibidas"; "Ya tomaste esta solicitud"; "La solicitud no admite iniciar la revisión en su estado actual"        |
| `requestAdditionalInformation` | "Se requiere el motivo para pedir información adicional"; "La solicitud no admite pedir información adicional en su estado actual"                 |
| `acceptRequest`                | "La solicitud ya fue aceptada"; "La solicitud no admite la aceptación en su estado actual"; "Se requiere el objetivo para abrir el acompañamiento" |

Los resultados de dominio que pueden fallar usan `ApiResult<T>` (`{status: "ok", data}` o `{status: "error", error: PublicApiError}`) de `convex/domain/errors`, con `PublicApiError = {code, message}` sin stack traces ni datos internos. El serializador devuelve `access_needs_empty` o `access_needs_too_long`, pero es solo dominio para que los clientes armen el texto antes de llamar: Aplicación y Presentación no lo invocan (verificado con `git grep toStoredRequestFields`) y la API rechaza con los mensajes de la tabla de arriba, no con estos códigos.

## Topes y serialización (TI2-23)

`ACCESS_NEEDS_MAX_LENGTH = 2000`, centralizado en `convex/domain/requests` y exportado por `convex/domain/index.ts`. El Backend aplica el límite (la validación de 1–2000 caracteres ya está integrada en `registerRequest`) y los clientes reusan el valor 2000 documentado acá hasta que exista un paquete compartido: Web y Mobile consumen vía `api` de `convex/_generated/api` y ningún cliente importa `convex/domain` (verificado contra sus imports reales). Se rechaza el exceso, nunca se trunca: recortar necesidades de acceso alteraría en silencio lo declarado (Ley 21.719).

`toStoredRequestFields` convierte el contenido estructurado a la forma persistida uniendo etiquetas de `accessNeeds` más `otherAccessNeed` con salto de línea. Destino de cada campo de `SubmitStudentRequestCommand` (verificado contra el tipo real de Mobile):

| Campo del comando                             | Destino en Sprint 1                                                    |
| --------------------------------------------- | ---------------------------------------------------------------------- |
| `accessNeeds` (etiquetas) + `otherAccessNeed` | Texto `accessNeeds` de la fila, vía `toStoredRequestFields`, tope 2000 |
| `needSummary`                                 | Sin columna: pendiente de persistencia futura, no se inventa ubicación |
| `expectedOutcome`                             | Sin columna: pendiente de persistencia futura, no se inventa ubicación |
| `modalityPreference`                          | Sin columna: pendiente de persistencia futura, no se inventa ubicación |
| `generalAvailability`                         | Sin columna: pendiente de persistencia futura, no se inventa ubicación |
| `preferredAccessibleInformationChannel`       | Sin columna: pendiente de persistencia futura, no se inventa ubicación |

## Consumo Web (Sprint 1)

La Web consume la misma superficie `api.presentation.*` sin endpoints propios: `apps/web/src/infrastructure/convex/convex-client.ts` abre el `ConvexReactClient` solo con `VITE_CONVEX_URL` y `VITE_CONVEX_SITE_URL` (localizadores públicos, sin secretos) y `apps/web/src/presentation/session/session-state.ts` expone `useSessionState` sobre `presentation/session.getSessionState` y `useSessionAndRole` sobre `presentation/session.getSessionWithRole` para el router y sus guards; la autorización efectiva siempre vive en Convex y las solicitudes y acompañamientos quedan documentados en las tablas de arriba para su cableado futuro, sin inventar estados ni errores.

## Cierre de seguridad y concurrencia (TI2-27)

La auditoría de TI2-27 no encontró identidad por argumento en funciones públicas (toda la presentación resuelve `ctx.auth.getUserIdentity()` y delega por `tokenIdentifier`), ni lecturas por identificador sin chequeo de titularidad o asignación activa, ni fugas de `accessNeeds`, `studentId` o `authorId` fuera de la vista que corresponde; el Practicante solo lee la vista minimizada (`_id`, `status`, `objective`, `view`) con asignación explícita y activa, las notas internas solo las lee el Profesional asignado y el Administrador siempre recibe denegación en acompañamientos. Criterio de cierre explícito de TI2-27: la apertura única queda garantizada por construcción porque `acceptRequest` comprueba y crea en la misma transacción (`findAccompanimentByRequest` con el índice `accompaniments.by_request` antes de insertar) y queda probada en `convex/tests/acceptance.test.ts` por duplicado (repetición secuencial rechazada con "La solicitud ya fue aceptada" y contienda entre dos profesionales con toma activa donde la segunda aceptación se rechaza sin duplicar); la demostración con transacciones solapadas contra un backend en vivo no es condición de cierre de TI2-27 porque exige el entorno con datos ficticios y clientes autenticados independientes que provee TI2-30, donde queda registrada como evidencia manual pendiente. Toda denegación responde `ConvexError("No autorizado")` sin motivo ni existencia del recurso y los rechazos de regla usan `Error` en español según la tabla de respuestas y errores.

### Prueba en vivo pendiente (guía para TI2-30)

Para demostrar la apertura única con transacciones solapadas, ejecuta dos llamadas `acceptRequest` simultáneas desde clientes independientes contra un backend Convex local o de demostración con datos ficticios: 1) levanta el entorno (`bun run dev:web`) y siembra un Estudiante, dos Profesionales, una solicitud en revisión y una toma activa por profesional; 2) autentica dos clientes independientes (dos sesiones de Profesional con toma) y dispara ambas aceptaciones a la vez; 3) comprueba que queda un solo acompañamiento vinculado a la solicitud (índice `accompaniments.by_request`), que la solicitud queda en `accepted` y que la llamada perdedora no crea otro (rechazada con "La solicitud ya fue aceptada").

## Compatibilidad con hooks y mocks Mobile (Sprint 1)

| Hook / puerto Mobile                                                 | Operación Backend                                                                                                          | Estado                                                                                                                                                                            |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `useStudentArea` (`StudentAreaReader`, mock local)                   | `getSessionState` + `listOwnRequests` + `listOwnedAccompaniments`                                                          | Pendiente de cableado; mocks vigentes. Perfil (`StudentIdentity`) ← `getMyProfile` (divergencia `fullName`/`displayName` pendiente); `accompaniments` ← `listOwnedAccompaniments` |
| `use-submit-student-request` (`StudentRequestSubmitter`, mock local) | `createRequest({accessNeeds})`                                                                                             | Pendiente; serializador y tope listos en TI2-23                                                                                                                                   |
| `use-professional-review` (`ProfessionalReviewPort`, mock local)     | `listOpenRequests`, `listAuthorizedRequests`, `getRequest`, `takeRequest`, `requestAdditionalInformation`, `acceptRequest` | Pendiente de cableado; mocks vigentes                                                                                                                                             |
| `use-practitioner-accompaniments` (mock local)                       | `listAssignedAccompaniments` (vista minimizada)                                                                            | Pendiente de cableado; mocks vigentes                                                                                                                                             |
| `use-professional-agenda` (mock local)                               | Sin operación: agenda fuera de Sprint 1                                                                                    | Fuera de alcance, sin backend                                                                                                                                                     |
| `use-administrator-accounts` (mock local)                            | `enableIntern` es interna, sin superficie pública                                                                          | Pendiente de diseño de superficie                                                                                                                                                 |
| `auth-port` (mock local)                                             | `getSessionState`                                                                                                          | Pendiente de cableado                                                                                                                                                             |

Divergencias de valores registradas (no inventar valores: lo que sigue lo acuerda TI4-12):

| Campo                   | Backend canónico                | Mobile actual             |
| ----------------------- | ------------------------------- | ------------------------- |
| Estado de solicitud     | snake_case (`under_review`)     | camelCase (`underReview`) |
| Identificador           | `_id` (`Id`)                    | `id` (`string`)           |
| Fecha de creación       | `createdAt` epoch (`number`)    | `IsoDateTime` (`string`)  |
| Necesidades persistidas | `accessNeeds` texto serializado | arreglo estructurado      |
| Nombre de perfil        | `fullName`                      | `displayName`             |

## Versionado

La superficie versionada es `api.presentation.*` (pública), `internal.*` (solo servidor) y los tipos generados en `convex/_generated`, verificados con `tsc` y `test:convex` en CI. Un cambio incompatible se documenta acá antes de implementarse. Comprobación de compatibilidad: espejo manual documentado en `convex/domain/requests/request.test.ts` (copia local de la forma de `SubmitStudentRequestCommand`, no el tipo real de Mobile) y la matriz de arriba, que TI4-12 cierra con el cableado final.

## Pendientes

- TI2-26 quedó integrada (PR #52): la validación y la documentación de esta superficie ya viven en este archivo y en `convex/tests/apiBackend.test.ts`.
- TI4-12 cablea los hooks al Backend y resuelve las divergencias de valores.
- TI2-85 habilitó cancelar (Estudiante) y cerrar sin acompañamiento (Profesional con toma) como casos de uso de Aplicación, sin entrada pública. El estado de `api.presentation.requests.*` sigue en los cuatro de Sprint 1. Agregar `closed_without_accompaniment` y `cancelled` es un cambio incompatible para Mobile, porque `mapCanonicalRequestStatus` en `apps/mobile/src/infrastructure/ti2-contract-mappers.ts` cubre solo cuatro estados y deja de compilar; se coordina con TI4 en la tarea que publique esas operaciones. El detalle está en [`state-model.md`](../convex/domain/requests/state-model.md#contrato-público).

## Evolución compatible de Sprint 2: disponibilidad, espacios y atención (TI2-87)

Contratos públicos compartidos v1 para Sprint 2, sin otra API ni tipos locales divergentes: la única fuente pura es `convex/domain/availability/`, `convex/domain/spaces/` y `convex/domain/appointments/`, exportada por el barrel `convex/domain/index.ts` para Web y Mobile. Reutilizan `ModalityPreference` de la solicitud, las clases de excepción de TI2-81 (`cancelled`/`added`) y los estados de TI2-83 (`scheduled`, `completed`, `cancelled_by_student`, `cancelled_by_cereti`, `rescheduled`, `no_show`); reserva y atención son una sola entidad y no existe un `domain/reservations` paralelo. La forma de errores públicos (`ApiResult`/`PublicApiError`) se conserva intacta; TI2-88 fija códigos y casos negativos.

| Contrato                                                        | Versión | Fuente                                       |
| --------------------------------------------------------------- | ------- | -------------------------------------------- |
| Disponibilidad (bloques, excepciones, rango y paginación)       | `v1`    | `convex/domain/availability/availability.ts` |
| Espacios (campus, edificio, piso, sala, acceso e instrucciones) | `v1`    | `convex/domain/spaces/space.ts`              |
| Atención reservada (una sola entidad, seis estados)             | `v1`    | `convex/domain/appointments/appointment.ts`  |

Contrato propuesto frente a endpoint disponible: estos DTO llevan identificadores genéricos (`string` plano) y campo `version`; las entradas nuevas se entregarán bajo `api.presentation.availability`/`appointments`/`spaces` en las tareas de endpoints (TI2-97/TI2-98/TI2-99/TI2-111), fuera de esta tarea, que no crea endpoints, casos de uso, repositorios, esquema ni adaptadores de calendario. Los clientes siguen compilando sin cambios: Web y Mobile aún no consumen estos DTO y Mobile conserva sus mocks tipados durante Sprint 2; todo dato es ficticio y la autorización contextual queda en Aplicación con la DB y los servicios externos en Infraestructura. Comprobación: espejo manual de los modelos provisionales de Mobile en `convex/domain/availability/availability.test.ts`, ida y vuelta JSON de cada DTO ficticio y regresión de `test:convex`, `test:web`, `build` Web y `typecheck`/`test` Mobile.

## Respuestas de conflicto, acceso denegado y ausencia de cupo (TI2-88)

Códigos estables del contrato público común en `convex/domain/errors/api_error.ts`, con `PublicApiError = {code, message}` y `ApiResult<T> = {status: "ok", data} | {status: "error", error}` sin envoltura paralela: los clientes distinguen por `code` y nunca interpretan el texto de `message` como código. Conflicto y ausencia de cupo usan códigos distintos y ninguno revela si el recurso existe; el identificador ajeno y el inexistente responden igual, sin pila, identificadores de terceros, necesidades ni notas.

| Código            | Significado                    | Mensaje comprensible                                                             |
| ----------------- | ------------------------------ | -------------------------------------------------------------------------------- |
| `unauthorized`    | Acceso denegado                | `No autorizado`                                                                  |
| `conflict`        | Conflicto con el estado actual | `La solicitud entra en conflicto con el estado actual.`                          |
| `no_availability` | Ausencia de cupo               | `Sin cupo disponible. Coordina por el canal oficial con la referencia indicada.` |

Compatibilidad con Sprint 1: se conservan `access_needs_empty`, `access_needs_too_long`, `ConvexError("No autorizado")` y los mensajes operativos en español de la tabla de respuestas y errores; ningún endpoint existente cambia su forma. La ausencia de cupo se coordina por el canal oficial con la referencia mínima ya entregada en la entrada, sin crear una reserva incompatible.

Traducción segura del borde Convex para endpoints nuevos: Dominio no importa Convex, React ni Expo y Aplicación conserva la autorización contextual sin importar Convex; Aplicación expone `deniedPublicError` en `convex/application/authorization/authorize.ts` reutilizando `unauthorizedError()` del dominio y Presentación expone la traducción compartida `toSecureConvexError`, `denyUnauthorized` y `throwPublicApiError` en `convex/presentation/session.ts`. Todo endpoint nuevo de disponibilidad, espacios y atención convierte su `PublicApiError` con esa única traducción a `ConvexError({code, message})` con solo esas dos claves, sin depender de autorización para adaptar sus respuestas. Comprobación: forma de éxito y error con claves exactas y códigos estables en `convex/domain/errors/api_error.test.ts`, e identificador ajeno frente a inexistente con la misma denegación sin filtrar en `convex/tests/apiBackend.test.ts`; el barrel `convex/domain/index.ts` sigue siendo la única fuente pura para Web y Mobile.
