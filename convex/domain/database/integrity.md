# Database mínima: migraciones, índices y pruebas — TI2-17

Fuente: lenguaje de `CONTEXT.md` (Practicante con asignación explícita y acceso minimizado, Administrador sin acceso irrestricto), seguridad mínima de `docs/especificacion-prototipo.md` (autorización en backend, habilitación previa de cuentas y datos ficticios) y alcance de la issue TI2-17 (migraciones, índices y pruebas, sin módulo general de auditoría). Este archivo es la evidencia de cierre; el modelo ejecutable vive en [`schema.ts`](../../schema.ts), la auditoría de filas legacy en [`migrations.ts`](../../migrations.ts), la persistencia en `infrastructure/*/repository.ts` y la prueba reproducible en [`database.test.ts`](../../database.test.ts). Todo opera con datos ficticios.

## Reproducción desde cero

La persistencia mínima se reproduce con tres pasos: sincronizar el esquema con `bunx convex dev` desde la raíz (crea tablas e índices), crear la cuenta administrativa inicial con `internal.accounts.ensureBootstrapAdmin` según el procedimiento por entorno de `domain/accounts/enablement.md` y verificar con `bun run test:convex`, que levanta una base vacía por prueba con el esquema real. Cada prueba de `database.test.ts` parte vacía y siembra solo lo que necesita, por lo que el conjunto completo es la demostración de que las consultas necesarias funcionan de forma consistente sin datos previos.

## Catálogo de índices

Cada índice declarado tiene una consulta que lo usa y una prueba que lo demuestra. Por identidad: `users.by_email` (unicidad de correo en semillas y arranque), `users.by_token_identifier` (vínculo perfil-identidad en todos los repositorios), `users.by_role` (detección del primer administrador) y `users.by_institutional_status` (cuentas pendientes de habilitación). Por pertenencia: `accompaniments.by_student` (listado propio del estudiante), `accompaniments.by_request` (trazabilidad solicitud-acompañamiento), `accompanimentAssignments.by_user_and_status_and_assigned_role_and_accompaniment` (listado asignado con paginado keyset), `accompanimentAssignments.by_accompaniment_and_user_and_status_and_assigned_role` (chequeo de presencia exacta), `followUpNotes.by_accompaniment` (notas del acompañamiento) y `requests.by_student`, `requests.by_status` y `requests.by_student_and_status` (solicitudes propias, cola de revisión y propias en un estado, sin filtrar en memoria). Los nombres incluyen todos sus campos y las consultas los recorren en el orden declarado.

## Unicidad e integridad

El identificador de identidad (`tokenIdentifier`) y el correo son únicos: las semillas guardadas y el arranque normalizan el correo antes de buscar e insertar, por lo que diferencias de mayúsculas o espacios no crean duplicados lógicos, y rechazan el duplicado con `Ya existe un perfil para esta identidad` y `Ya existe un perfil con este correo`. Cada asignación activa es única por acompañamiento, usuario y rol: la vía guardada rechaza el duplicado con `Ya existe una asignación activa` y el rol del perfil debe coincidir con el rol asignado. La escritura guardada exige que el acompañamiento y el usuario existan; una solicitud aceptada origina su acompañamiento mediante `requestId` (TI2-24), que aquí solo se persiste y se consulta. No se agregan entidades funcionales fuera del modelo mínimo.

## Trazabilidad mínima de Sprint 1

Cada operación sensible deja su rastro en el propio documento: la habilitación fija `enabledBy` y `enabledAt` (TI2-11), la solicitud fija `createdAt`, el acompañamiento conserva `requestId`, la asignación fija `grantedBy` y `grantedAt` al conceder y `revokedBy` y `revokedAt` al revocar (TI2-16). La auditoría de `migrations.auditAssignmentTraceability` confirma que lo escrito por la vía guardada nace completo y detecta las filas anteriores a TI2-16 sin inventar actor ni fecha, porque rellenar auditoría con datos falsos violaría la trazabilidad que exige la Ley 21.719.

## Aislamiento del practicante

La habilitación sola no concede nada: las consultas de persistencia acotadas por el `userId` del Practicante solo devuelven sus asignaciones activas, el chequeo de presencia sobre un acompañamiento ajeno vuelve vacío y el borde responde `No autorizado` ante lectura ajena, notas internas y listados fuera de alcance, con vista minimizada en lo asignado. Revocar cierra todas las filas de la combinación y el acceso desaparece en persistencia y en borde.

## Auditoría de filas legacy

El operador ejecuta `bunx convex run migrations:auditAssignmentTraceability '{"paginationOpts":{"numItems":200,"cursor":null}}'` con el selector del entorno objetivo (`--deployment <nombre>` fuera de producción y `--prod` en producción, nunca sin selector contra producción) y repite con el `continueCursor` devuelto hasta que `isDone` sea verdadero, sumando los conteos de cada página. Un barrido completo con `missingGrant` y `missingRevoke` en cero deja el entorno apto; cada identificador de `sampleLegacyIds` se revisa a mano porque corresponde a una fila escrita fuera de la vía guardada. Esta auditoría cubre solo la trazabilidad mínima de Sprint 1 y no es un módulo general de auditoría, estadísticas ni reportes.

## Casos cubiertos por pruebas

Positivos: cada índice responde lo sembrado; la cadena completa (arranque, habilitación, solicitud, acompañamiento vinculado, asignación y revocación) deja todo su rastro; el Practicante lee minimizado lo asignado; la auditoría aprueba la vía guardada. Negativos: correo o identidad duplicados y arranque con correo existente se rechazan; asignar con acompañamiento o usuario inexistente se rechaza; el Practicante no lee lo ajeno ni notas internas por persistencia ni por borde; la auditoría detecta filas activas sin concesión y revocadas sin revocación, con muestra acotada y paginado del barrido.
