# Contratos compartidos de Sprint 1 — operaciones, respuestas y errores (TI2-23)

Superficie pública versionada del Backend para los flujos comprometidos en Sprint 1: autenticación, solicitudes, acompañamiento resultante, habilitación institucional y acceso de Practicante. Todo lo que Web y Mobile consumen sale de `api.presentation.*` y de los tipos generados en `convex/_generated`; no existe API paralela y ningún consumidor debe inventar endpoints, estados o errores.

## Queries públicas

| Operación | Argumentos | Devuelve | Quién | Denegación |
|---|---|---|---|---|
| `presentation/session.getSessionState` | — | `{status: "authenticated", email, name, population}` o `{status: "unauthenticated"}` | Cualquiera | Sin identidad, correo no institucional o sesión expirada responden `unauthenticated` sin motivo |
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
| `presentation/requests.createRequest` | `accessNeeds: string` (tope 2000 pendiente de integración en TI2-10; hoy solo valida `string`) | Solicitud en `received` | Estudiante vigente | Error genérico |
| `presentation/requests.takeRequest` | `requestId` | Solicitud tomada | Profesional vigente | Fuera de `received` o con toma activa se rechaza |
| `presentation/requests.requestAdditionalInformation` | `requestId`, `reason` (motivo obligatorio) | Solicitud en espera | Profesional con toma activa | Transición inválida o sin motivo se rechaza |
| `presentation/requests.acceptRequest` | `requestId`, `objective` | Vista completa del acompañamiento aceptado; crea la asignación inicial | Profesional con toma activa | Solo desde estados que llevan a `accepted`; abre exactamente un acompañamiento |

## Operaciones internas (solo servidor)

No forman superficie pública y ningún cliente las llama directo. Se documentan porque la checklist las exige y sus contratos rigen la vigencia que ven los guards:

| Operación | Argumentos | Hace |
|---|---|---|
| `internal.assignments.assign` | `accompanimentId`, `userId`, `assignedRole` | Crea la fila activa con `grantedBy`/`grantedAt`; exige Profesional autorizado y Practicante habilitado |
| `internal.assignments.revoke` | `accompanimentId`, `userId`, `assignedRole` | Revoca todas las filas activas de la tripla con `revokedBy`/`revokedAt`, sin borrar historial |
| `internal.accounts.enableIntern` | `userId` | Habilita la cuenta del Practicante pendiente; solo Administrador vigente |
| `internal.accounts.ensureBootstrapAdmin` | `email`, `fullName`, `tokenIdentifier` | Arranque administrativo inicial de un solo uso |

## Respuestas y errores

Toda denegación de autorización responde `ConvexError("No autorizado")`: mismo mensaje sin motivo y sin revelar si el recurso existe. Las validaciones de entrada fallan con error de validador de Convex, también sin detalles sensibles.

Los resultados de dominio que pueden fallar usan `ApiResult<T>` (`{status: "ok", data}` o `{status: "error", error: PublicApiError}`) de `convex/domain/errors`, con `PublicApiError = {code, message}` sin stack traces ni datos internos. Primer uso: el serializador de solicitudes devuelve `access_needs_too_long` con mensaje genérico en español cuando el texto supera el tope.

## Topes y serialización (TI2-23)

`ACCESS_NEEDS_MAX_LENGTH = 2000`, centralizado en `convex/domain/request` y exportado por `convex/domain/index.ts` para que el Backend y los consumidores validen igual. La integración en el registro está pendiente en TI2-10: hoy la mutation solo valida `string`, así que un texto mayor aún se persiste. Se rechaza el exceso, nunca se trunca: recortar necesidades de acceso alteraría en silencio lo declarado (Ley 21.719).

`toStoredRequestFields` convierte el contenido estructurado a la forma persistida uniendo etiquetas de `accessNeeds` más `otherAccessNeed` con salto de línea. Solo cubre condiciones de acceso: `needSummary`, `expectedOutcome`, modalidad y disponibilidad aún no tienen columna en Sprint 1 y quedan pendientes sin inventarles ubicación.

## Compatibilidad con hooks y mocks Mobile (Sprint 1)

| Hook / puerto Mobile | Operación Backend | Estado |
|---|---|---|
| `useStudentArea` (`StudentAreaReader`, mock local) | `getSessionState` + `listOwnRequests` | Pendiente de cableado; mocks vigentes |
| `use-submit-student-request` (`StudentRequestSubmitter`, mock local) | `createRequest({accessNeeds})` | Pendiente; serializador y tope listos en TI2-23 |
| `use-professional-review` (`ProfessionalReviewPort`, mock local) | `listOpenRequests`, `listAuthorizedRequests`, `takeRequest`, `requestAdditionalInformation`, `acceptRequest` | Pendiente de cableado; mocks vigentes |
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

## Versionado

La superficie versionada es `api.presentation.*` (pública), `internal.*` (solo servidor) y los tipos generados en `convex/_generated`, verificados con `tsc` y `test:convex` en CI. Un cambio incompatible se documenta acá antes de implementarse. Comprobación de compatibilidad: espejo manual documentado en `convex/domain/request/request.test.ts` (copia local de la forma de `SubmitStudentRequestCommand`, no el tipo real de Mobile) y la matriz de arriba, que TI4-12 cierra con el cableado final.

## Pendientes

- TI2-10 integra la validación del tope en el registro de solicitudes.
- TI4-12 cablea los hooks al Backend y resuelve las divergencias de valores.
