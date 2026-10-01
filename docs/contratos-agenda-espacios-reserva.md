# Contratos versionados de agenda, espacios, reserva y errores — v1 (TI2-87)

Superficie pública versionada para Sprint 2 sin duplicar la API Convex: todo lo que Web y Mobile consumen sale de `api.presentation.agenda.*` y de los tipos generados en `convex/_generated`; ningún consumidor inventa endpoints, estados o errores. La forma v1 vive en `convex/domain` (puro, sin Convex) y el borde la refleja en `convex/validators.ts`; `convex/schema.ts` no se edita y los casos de uso o repositorios de otros módulos no se tocan en esta tarea.

## Versiones vigentes

| Contrato | Versión | Fuente canónica |
| --- | --- | --- |
| Disponibilidad (bloques, excepciones, franjas) | `v1` | `convex/domain/agenda/availability.ts` |
| Catálogo de espacios | `v1` | `convex/domain/spaces/space.ts` |
| Reserva (estados y forma) | `v1` | `convex/domain/reservations/reservation.ts` |
| Errores públicos | `v1` | `convex/domain/errors/api_error.ts` |
| Puerto externo de calendario y `.ics` | `v1` | `convex/infrastructure/external/calendar.ts` |

Las entradas públicas son `presentation/agenda.getAgendaContractVersion` (versiones vigentes) y `presentation/agenda.listSpaceCatalog` (lectura propia del catálogo con datos ficticios y tope 50). Ambas validan la entrada, resuelven la identidad con `ctx.auth.getUserIdentity()` y no tocan `ctx.db` ni deciden reglas de negocio; la recurrencia efectiva, los cruces entre estudiantes, profesionales y salas, y las transiciones de reserva pertenecen a otros módulos.

## Compatibilidad

El cambio es aditivo: suma `convex/domain/agenda`, `convex/domain/spaces`, `convex/domain/reservations`, la extensión de `convex/domain/errors`, `convex/presentation/agenda.ts`, `convex/infrastructure/external/calendar.ts` y los adaptadores Web temporales, sin alterar `presentation/session`, `presentation/requests`, `presentation/accompaniments` ni sus mensajes. Un cambio incompatible futuro sumaría `v2` sin alterar `v1` y se documentaría acá antes de implementarse. Comprobación: `convex/agendaContracts.test.ts` verifica que el rechazo operativo de Sprint 1 (`createRequest` con necesidad vacía) sigue respondiendo el mensaje de necesidad y no el genérico.

## Impacto en Web y Mobile

Web consume sin duplicar: `apps/web/src/application/agenda/agenda-contracts.ts` tipa `getAgendaContractVersion` y `listSpaceCatalog` con `FunctionReturnType`/`FunctionArgs` de `api.presentation.agenda.*`, y `apps/web/src/presentation/agenda/use-agenda-contract.ts` cablea esas queries directo (`undefined` mientras carga, autorización en Convex). La disponibilidad y el catálogo siguen en adaptadores temporales con datos ficticios y respuestas tipadas a `v1` (`fictitious-agenda-reader.ts`, `fictitious-calendar-preview.ts`), sin reglas de negocio y reemplazables por la API en las tareas de conexión. Mobile no se modifica en esta tarea; la forma v1 es compatible con sus modelos provisionales (`ProfessionalAgendaDay`, `GeneralAvailability`, `ModalityPreference`) y el cableado queda pendiente de TI4: `ProfessionalAgendaReader` seguirá con mocks hasta la conexión, sin inventar estados nuevos.

## Disponibilidad (forma, sin reglas)

`RecurringAvailabilityBlock` (`id`, `professionalId`, `weekday` 0–6, `from`/`to` en `HH:MM`, `durationMinutes`, `modality` `inPerson`/`online`, `spaceId?`, `version: "v1"`), `AvailabilityException` (`id`, `professionalId`, `date` `YYYY-MM-DD`, `kind` `unavailable`/`extra`, `from`/`to`/`reason?`, `version`) y `AvailabilitySlot` (`id`, `professionalId`, `startAt`/`endAt`, `modality`, `spaceId?`, `version`). Topes de forma: duración 15–480 minutos y lectura propia hasta 50 ítems. Solo se comprueba forma (`toVersionedAvailabilityBlock`); los cruces y la recurrencia los resuelven otros módulos.

## Espacios (lectura propia)

`Space` (`id`, `campus`, `building`, `floor`, `room`, `accessConditions`, `arrivalInstructions`, `version: "v1"`), con `toSpaceLabel` para listados y `SPACE_CATALOG_MAX_ITEMS = 50`. La entrada `listSpaceCatalog({limit, cursor?})` exige identidad, rechaza límites fuera de 1–50 con "El límite debe estar entre 1 y 50." y cursores vacíos, y devuelve ficticios versionados sin filtrar por compatibilidad ni ocupación. Ejemplo ficticio: Campus San Francisco (ficticio), Edificio C (ficticio), Piso 2, Sala C-204.

## Reserva (estados y forma, sin transiciones)

Estados v1: `reserved` (Reservada), `rescheduled` (Reagendada), `completed` (Realizada), `cancelled_by_student` (Cancelada por el estudiante), `cancelled_by_cereti` (Cancelada por CERETI), `no_show_pending` (Inasistencia pendiente de justificación), `no_show_justified` (Inasistencia justificada), `no_show_unjustified` (Inasistencia sin justificar). `Reservation` (`_id`, `accompanimentId`, `modality`, `startAt`/`endAt`, `status`, `spaceId?`, `slotId?`, `version: "v1"`) y `JUSTIFICATION_WINDOW_BUSINESS_DAYS = 5` como constante de contrato; `toReservation` solo valida forma y rechaza estados desconocidos como corrupción, sin decidir transiciones.

## Errores y autorización

Toda denegación responde `ConvexError("No autorizado")` sin motivo ni existencia del recurso (anónimo en `getAgendaContractVersion` y `listSpaceCatalog`, verificado en `convex/agendaContracts.test.ts`). Los rechazos de forma usan `Error` en español con códigos estables de `PUBLIC_ERROR_CODES` (Sprint 1 conservado: `access_needs_empty`, `access_needs_too_long`; nuevos aditivos de disponibilidad, espacios y reserva en `PUBLIC_ERROR_MESSAGES`), sin stack traces ni datos internos, construibles con `toPublicApiError` y versionables con `withContractVersion`. La integración mínima de calendario usa títulos genéricos ("Atención programada") y `.ics` alternativo sin revelar CERETI fuera de sesión; el puerto ficticio solo valida rango y devuelve `fictitious-<reservationId>`.

## Pendientes

Las tareas de conexión reemplazan los adaptadores Web temporales por `api.presentation.agenda.*` sin cambiar la forma `v1`, implementan la persistencia y las reglas en los módulos dueños (sin editarse acá), y TI4 cablea `ProfessionalAgendaReader` y declara las divergencias restantes. La evidencia reproducible de esta tarea es `bun run test:convex`, `bun run test:web`, `tsc` de Convex, `lint`, `format:check` y `build` Web, con revisión TI4 y CI verde antes de integrar.
