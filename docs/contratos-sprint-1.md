# Contratos compartidos de Sprint 1 — operaciones, respuestas y errores (TI2-23)

Superficie pública versionada del Backend para los flujos comprometidos en Sprint 1: autenticación, solicitudes, acompañamiento resultante, habilitación institucional y acceso de Practicante. Todo lo que Web y Mobile consumen sale de `api.presentation.*` y de los tipos generados en `convex/_generated`; no existe API paralela y ningún consumidor debe inventar endpoints, estados o errores.

## Queries públicas

| Operación | Argumentos | Devuelve | Quién | Denegación |
|---|---|---|---|---|
| `presentation/session.getSessionState` | — | `{status: "authenticated", email, name, population}` o `{status: "unauthenticated"}` | Cualquiera | Sin identidad, correo no institucional o sesión expirada responden `unauthenticated` sin motivo |
| `presentation/session.getSessionWithRole` | — | `{session, role}` atómicos de la misma identidad; rol con `role`+`email` o `unauthenticated` | Cualquiera | Sin identidad, sin perfil o sin vigencia responden `unauthenticated` en la mitad que corresponda |
| `presentation/session.getMyProfile` | — | `{fullName, email, role, institutionalStatus, accountStatus}` | Titular con perfil (vigente o no, para entender un bloqueo) | Sin identidad o sin perfil: error genérico |
| `presentation/requests.getRequest` | `requestId` | Solicitud completa | Estudiante dueño o Profesional con toma activa | Error genérico, sin revelar existencia ni titularidad |
| `presentation/requests.listOwnRequests` | `paginationOpts` | Página de solicitudes propias completas | Estudiante vigente | Error genérico; solo sus filas |
| `presentation/requests.listAuthorizedRequests` | `paginationOpts` | Página de solicitudes tomadas por él | Profesional vigente con toma activa | Error genérico; sin toma no hay acceso |
| `presentation/requests.listOpenRequests` | `paginationOpts` | Bandeja `received` minimizada (sin `accessNeeds`) | Profesional vigente | Error genérico; solo descubrir, no autoriza a operar |
| `presentation/accompaniments.getAccompaniment` | `accompanimentId` | Vista completa o minimizada según rol | Estudiante dueño, Profesional o Practicante asignado | Error genérico, sin revelar existencia |
| `presentation/accompaniments.listOwnedAccompaniments` | `paginationOpts` | Página de acompañamientos propios | Estudiante vigente | Error genérico |
| `presentation/accompaniments.listAssignedAccompaniments` | `limit`, `after?` | Acompañamientos asignados con paginado keyset | Profesional o Practicante asignado | Error genérico; Administrador denegado |
| `presentation/accompaniments.getInternalNotes` | `accompanimentId`, `paginationOpts` | Página de notas internas | Profesional asignado | Error genérico; Estudiante, Practicante y Administrador denegados |

## Mutations públicas

| Operación | Argumentos | Devuelve | Quién | Denegación |
|---|---|---|---|---|
| `presentation/requests.createRequest` | `accessNeeds: string` (texto 1–2000 tras recorte) | Solicitud en `received` | Estudiante vigente | Vacío: "Se requiere describir la necesidad de acceso"; exceso: "La necesidad de acceso supera el máximo permitido (2000 caracteres)"; resto: error genérico |
| `presentation/requests.takeRequest` | `requestId` | Solicitud tomada | Profesional vigente | "Solo se pueden tomar solicitudes recibidas"; "Ya tomaste esta solicitud"; "La solicitud no admite iniciar la revisión en su estado actual"; resto: error genérico |
| `presentation/requests.requestAdditionalInformation` | `requestId`, `reason` (motivo obligatorio) | Solicitud en espera | Profesional con toma activa | "Se requiere el motivo para pedir información adicional"; "La solicitud no admite pedir información adicional en su estado actual"; resto: error genérico |
| `presentation/requests.acceptRequest` | `requestId`, `objective` | Vista completa del acompañamiento aceptado; crea la asignación inicial | Profesional con toma activa | "La solicitud ya fue aceptada"; "La solicitud no admite la aceptación en su estado actual"; "Se requiere el objetivo para abrir el acompañamiento"; resto: error genérico |

## Operaciones internas (solo servidor)

No forman superficie pública y ningún cliente las llama directo. Se documentan porque la checklist las exige y sus contratos rigen la vigencia que ven los guards:

| Operación | Argumentos | Hace |
|---|---|---|
| `internal.assignments.assign` | `accompanimentId`, `userId`, `assignedRole` | Crea la fila activa con `grantedBy`/`grantedAt`; exige Profesional autorizado y Practicante habilitado |
| `internal.assignments.revoke` | `accompanimentId`, `userId`, `assignedRole` | Revoca todas las filas activas de la tripla con `revokedBy`/`revokedAt`, sin borrar historial |
| `internal.accounts.enableIntern` | `userId` | Habilita la cuenta del Practicante pendiente; solo Administrador vigente |
| `internal.accounts.ensureBootstrapAdmin` | `email`, `fullName`, `tokenIdentifier` | Arranque administrativo inicial de un solo uso |

## Respuestas y errores

Toda denegación de autorización responde `ConvexError("No autorizado")`: mismo mensaje sin motivo y sin revelar si el recurso existe. Aplica a identidad ausente, perfil ausente o no vigente, rol ajeno, fila inexistente o ajena, y toma ausente. Las validaciones de tipo de argumentos fallan con error de validador de Convex, también sin detalles sensibles.

Los rechazos de regla y validación responden `Error` con mensaje específico en español (sin códigos, sin motivo interno):

| Operación | Rechazo con mensaje específico |
|---|---|
| `createRequest` | Vacío: "Se requiere describir la necesidad de acceso"; exceso: "La necesidad de acceso supera el máximo permitido (2000 caracteres)" |
| `takeRequest` | "Solo se pueden tomar solicitudes recibidas"; "Ya tomaste esta solicitud"; "La solicitud no admite iniciar la revisión en su estado actual" |
| `requestAdditionalInformation` | "Se requiere el motivo para pedir información adicional"; "La solicitud no admite pedir información adicional en su estado actual" |
| `acceptRequest` | "La solicitud ya fue aceptada"; "La solicitud no admite la aceptación en su estado actual"; "Se requiere el objetivo para abrir el acompañamiento" |

Los resultados de dominio que pueden fallar usan `ApiResult<T>` (`{status: "ok", data}` o `{status: "error", error: PublicApiError}`) de `convex/domain/errors`, con `PublicApiError = {code, message}` sin stack traces ni datos internos. Primer uso: el serializador de solicitudes devuelve `access_needs_too_long` con mensaje genérico en español cuando el texto supera el tope.

## Topes y serialización (TI2-23)

`ACCESS_NEEDS_MAX_LENGTH = 2000`, centralizado en `convex/domain/request` y exportado por `convex/domain/index.ts` para que el Backend y los consumidores validen igual. La validación de 1–2000 caracteres ya está integrada en `registerRequest` (recorta, rechaza vacío y exceso). Se rechaza el exceso, nunca se trunca: recortar necesidades de acceso alteraría en silencio lo declarado (Ley 21.719).

`toStoredRequestFields` convierte el contenido estructurado a la forma persistida uniendo etiquetas de `accessNeeds` más `otherAccessNeed` con salto de línea. Destino de cada campo de `SubmitStudentRequestCommand` (verificado contra el tipo real de Mobile):

| Campo del comando | Destino en Sprint 1 |
|---|---|
| `accessNeeds` (etiquetas) + `otherAccessNeed` | Texto `accessNeeds` de la fila, vía `toStoredRequestFields`, tope 2000 |
| `needSummary` | Sin columna: pendiente de persistencia futura, no se inventa ubicación |
| `expectedOutcome` | Sin columna: pendiente de persistencia futura, no se inventa ubicación |
| `modalityPreference` | Sin columna: pendiente de persistencia futura, no se inventa ubicación |
| `generalAvailability` | Sin columna: pendiente de persistencia futura, no se inventa ubicación |
| `preferredAccessibleInformationChannel` | Sin columna: pendiente de persistencia futura, no se inventa ubicación |

## Compatibilidad con hooks y mocks Mobile (Sprint 1)

| Hook / puerto Mobile | Operación Backend | Estado |
|---|---|---|
| `useStudentArea` (`StudentAreaReader`, mock local) | `getSessionState` + `listOwnRequests` + `listOwnedAccompaniments` | Pendiente de cableado; mocks vigentes. Perfil (`StudentIdentity`) ← `getMyProfile` (divergencia `fullName`/`displayName` pendiente); `accompaniments` ← `listOwnedAccompaniments` |
| `use-submit-student-request` (`StudentRequestSubmitter`, mock local) | `createRequest({accessNeeds})` | Pendiente; serializador y tope listos en TI2-23 |
| `use-professional-review` (`ProfessionalReviewPort`, mock local) | `listOpenRequests`, `listAuthorizedRequests`, `getRequest`, `takeRequest`, `requestAdditionalInformation`, `acceptRequest` | Pendiente de cableado; mocks vigentes |
| `use-practitioner-accompaniments` (mock local) | `listAssignedAccompaniments` (vista minimizada) | Pendiente de cableado; mocks vigentes |
| `use-professional-agenda` (mock local) | Sin operación: agenda fuera de Sprint 1 | Fuera de alcance, sin backend |
| `use-administrator-accounts` (mock local) | `enableIntern` es interna, sin superficie pública | Pendiente de diseño de superficie |
| `auth-port` (mock local) | `getSessionState` | Pendiente de cableado |

Divergencias de valores registradas (no inventar valores: lo que sigue lo acuerda TI4-12):

| Campo | Backend canónico | Mobile actual |
|---|---|---|
| Estado de solicitud | snake_case (`under_review`) | camelCase (`underReview`) |
| Identificador | `_id` (`Id`) | `id` (`string`) |
| Fecha de creación | `createdAt` epoch (`number`) | `IsoDateTime` (`string`) |
| Necesidades persistidas | `accessNeeds` texto serializado | arreglo estructurado |
| Nombre de perfil | `fullName` | `displayName` |

## Versionado

La superficie versionada es `api.presentation.*` (pública), `internal.*` (solo servidor) y los tipos generados en `convex/_generated`, verificados con `tsc` y `test:convex` en CI. Un cambio incompatible se documenta acá antes de implementarse. Comprobación de compatibilidad: espejo manual documentado en `convex/domain/request/request.test.ts` (copia local de la forma de `SubmitStudentRequestCommand`, no el tipo real de Mobile) y la matriz de arriba, que TI4-12 cierra con el cableado final.

## Pendientes

- Coordinar con TI2-26 (PR #52, abierta): trae validación y documentación equivalentes sobre los mismos archivos; falta definir cuál implementación se integra y el orden de merge.
- TI4-12 cablea los hooks al Backend y resuelve las divergencias de valores.
