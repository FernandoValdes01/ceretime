# Contrato de agenda de Sprint 3 — varios profesionales, acceso en línea privado y coordinación por canal oficial (TI2-142, TI2-144)

Superficie que TI2-142 agrega a la agenda: una atención coordinada con varios profesionales y el enlace privado de la atención en línea. Todo es aditivo sobre el contrato v1 de `appointments` (TI2-87, TI2-111, TI2-121): ninguna operación existente cambia su forma, no se crea otra operación de reserva ni otra comprobación de ocupación, y la persistencia es la de TI2-138 (`appointmentProfessionals` y `privateAccessReference`).

Recorrido por capas: las reglas viven en `convex/domain/appointments/participants.ts`, `convex/domain/appointments/online_access.ts`, `convex/domain/availability/availability.ts` (`slotsCoverInterval`) y `convex/domain/authorization/permissions.ts` (`canCoordinateAppointment`, `canUseAppointmentOnlineAccess`); los casos de uso, en `convex/application/appointments/booking.ts`, `changes.ts` y `online_access.ts`; la persistencia y los cruces, en `convex/infrastructure/appointments/repository.ts`; y la API pública, en `convex/presentation/appointments.ts`.

## Varios profesionales por atención

La atención conserva `professionalId` como Profesional responsable, el mismo campo que ya consumen Web y Mobile, y suma profesionales adicionales. En el dominio viajan como `additionalProfessionalIds`; en la base son filas de `appointmentProfessionals`, que TI2-138 creó con el conjunto completo (responsable incluido) y la ventana copiada de la atención. Una atención de un solo profesional se lee igual que antes.

`normalizeAppointmentProfessionals` recorta los identificadores, descarta repeticiones (incluido el responsable repetido entre los adicionales) y rechaza un responsable vacío (`professional_required`), un adicional vacío (`professional_invalid`) o más de `MAX_APPOINTMENT_PROFESSIONALS` en total (`too_many_professionals`). El máximo es 3 contando al responsable y es provisional hasta que CERETI confirme cuántos profesionales coordinan a la vez. El repositorio tiene aparte `MAX_APPOINTMENT_PROFESSIONAL_ROWS`, un tope técnico de lectura que no es la regla de negocio.

Disponibilidad de todos: el cupo del responsable se revalida como siempre (`resolveBookableSlot`). Cada adicional debe seguir asignado y vigente en el acompañamiento y tener disponibilidad vigente de la misma modalidad durante toda la atención (`confirmAdditionalProfessionals` con `slotsCoverInterval`); su agenda puede estar partida en cupos de otra duración, por ejemplo dos de 30 minutos cubren una atención de 60. La sala la fija el cupo del responsable. Un adicional que no cumple responde `no_availability`.

Cruces de todos: la ocupación atómica (`occupySlotAtomically`, TI2-84/TI2-96) comprueba en la misma transacción al Estudiante, a la sala y a cada profesional. Un profesional está ocupado si se cruza con una atención no cancelada donde es responsable (índice `appointments.by_professionalId_and_startsAt`) o participante (índice `appointmentProfessionals.by_professionalId_and_startsAt`); se leen ambos porque una atención anterior a la migración de TI2-138 todavía no tiene su fila de participante. Ante dos intentos por el mismo cupo, la transacción confirma uno y el otro recibe `conflict`.

Reagendar una atención coordinada conserva a sus profesionales adicionales: cada adicional que siga siendo reservable debe tener disponibilidad que cubra el destino, la ocupación comprueba los cruces de todos y el repositorio mueve la ventana de todas las filas de participante. Un adicional que ya no es reservable (asignación revocada o cuenta no vigente) sale de la atención en el mismo cambio y su fila de participante se retira: no hay otra vía para retirarlo y ya no podría atenderla, así que no impide reagendar. Si el destino cambia al responsable, la fila del anterior pasa a ser la del nuevo (comportamiento de TI2-138).

Participan de la atención el Estudiante dueño y cada uno de sus profesionales (`isAppointmentParticipant`). El Practicante no participa por estar asignado al acompañamiento: su acceso sigue siendo la vista minimizada de TI2-127, que tampoco trae `additionalProfessionalIds`.

## Acceso privado de la atención en línea

Decisión del 08/11/2026: un Profesional de la atención agrega un enlace de Google Meet institucional y CERETI lo guarda en `appointments.privateAccessReference`. No se genera desde Google Calendar, porque vincular Calendar es opcional y rechazarlo no puede impedir una atención en línea, y porque `docs/integraciones/google-calendar.md` define que el evento no incluye enlaces privados. La generación automática con la API de Meet queda para una fase posterior, y Google ya figura como proveedor, así que no se agrega otro al inventario de TI2-139.

`normalizeOnlineAccessLink` exige `https`, el dominio exacto `meet.google.com` (sin subdominios parecidos, credenciales ni puerto) y un código de reunión de tres, cuatro y tres letras, como `sol-casa-pan`. Descarta la consulta y el fragmento, que suelen traer la cuenta de quien copió el enlace, y guarda la forma canónica `https://meet.google.com/sol-casa-pan`. La forma canónica permite comparar enlaces: el índice `appointments.by_privateAccessReference` rechaza el mismo enlace en otra atención, así es un enlace por atención y no una sala fija reutilizada entre estudiantes.

`decideOnlineAccessUpdate` permite agregar o reemplazar el enlace solo a un profesional de la atención (responsable o adicional), solo en una atención en línea y solo mientras siga vigente (`scheduled` o `rescheduled`). Un actor ajeno recibe `actor_not_professional` antes de que se mire la atención o el enlace. El resultado distingue `added`, `replaced` y `unchanged`; un reintento con el mismo enlace es `unchanged`, no escribe y no avisa.

El enlace no forma parte de `Appointment` ni de sus proyecciones, así que ningún listado ni detalle de agenda lo trae. Solo sale por `getOnlineAccess`, que usa `toOnlineAccessView`:

| Estado           | Cuándo                                                                     | Trae enlace |
| ---------------- | -------------------------------------------------------------------------- | ----------- |
| `pending`        | Atención en línea vigente sin enlace todavía                               | No          |
| `available`      | Atención en línea vigente con enlace                                       | Sí          |
| `not_applicable` | Atención presencial, o cancelada, realizada o con inasistencia             | No          |
| `unauthorized`   | Quien consulta no participa, o la atención es ajena o no existe            | No          |

## Apoyos de la atención en línea

TI2-142 permitía que quien coordina declarara apoyos de la atención en línea, como subtítulos, en el argumento `onlineSupports` de `bookAppointment`, y los guardaba en la atención. TI2-165 los quitó, porque ATENCIONES del MER no tiene apoyos: `bookAppointment` ya no recibe ese argumento (Convex rechaza la llamada que lo envía), la atención no los guarda, el reagendamiento no los relee y `normalizeOnlineSupports` dejó de existir junto con sus topes. Ni Web ni Mobile lo enviaban.

La compatibilidad en línea se sigue comprobando con `assessCompatibility` sobre los apoyos de la plataforma (`CompatibilityOption.onlineSupports` de TI2-82), que hoy son ninguno. Mientras no exista el catálogo CONDICIONES_ACCESO del MER, una atención en línea solo es compatible con un acompañamiento sin necesidades de acceso, tanto para el Estudiante como para quien coordina.

## Operaciones públicas

Todas exigen `version: "v1"`, derivan la identidad con `ctx.auth.getUserIdentity()` y nunca aceptan `studentId` ni el actor como argumento.

| Operación                                       | Tipo     | Argumentos                                                                                                 | Devuelve                                                                 | Quién                                                                                                                          |
| ----------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `presentation/appointments.bookAppointment`     | mutation | Los de TI2-111 más `additionalProfessionalIds?: string[]`                                                 | `{appointmentId}`                                                        | Estudiante dueño de un acompañamiento activo, sin adicionales; o Profesional asignado que participa en la atención |
| `presentation/appointments.setOnlineAccessLink` | mutation | `appointmentId`, `link`, `version`                                                                         | `{appointmentId}`                                                        | Profesional de la atención (responsable o adicional) con asignación activa                                                    |
| `presentation/appointments.getOnlineAccess`     | query    | `appointmentId`, `version`                                                                                 | `{status: "pending" \| "available" \| "not_applicable", link?, version}` | Estudiante dueño o profesional de la atención con asignación activa                                                          |

`bookAppointment` sigue siendo la única operación de reserva. El Estudiante reserva como antes. El Profesional asignado la usa para coordinar en nombre del Estudiante dueño, que sale del acompañamiento leído en el servidor; el Profesional que coordina debe ser uno de los profesionales de la atención. Es la única ampliación de permisos: hasta ahora un Profesional que llamaba a `bookAppointment` recibía `unauthorized`.

## Respuestas y errores

Se usan solo los códigos de TI2-88 (`ConvexError({code, message})` con esas dos claves) y los clientes distinguen por `code`. No se agrega un código nuevo: Web ya importa `convex/domain` y puede validar el enlace con `normalizeOnlineAccessLink` antes de enviarlo, así muestra la causa exacta con la misma regla del servidor.

| Operación             | `unauthorized`                                                                                                                                 | `conflict`                                                                                                                              | `no_availability`                                                                                                  |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `bookAppointment`     | Los casos de TI2-111; un Estudiante que envía adicionales; un Profesional que no participa en la atención que coordina                 | Los casos de TI2-111; cruce de cualquiera de los profesionales; adicional vacío o más del máximo | Los casos de TI2-111; un adicional sin asignación activa o vigencia, o cuya disponibilidad no cubre la atención    |
| `rescheduleAppointment` | Los casos de TI2-121                                                                                                                         | Los casos de TI2-121, incluido el cruce de cualquiera de los profesionales                                                              | Los casos de TI2-121, y un adicional reservable cuya disponibilidad no cubre el destino (el que ya no es reservable sale de la atención) |
| `setOnlineAccessLink` | Sin identidad, atención ajena o inexistente, acompañamiento no activo, o actor que no es profesional de la atención                            | Atención presencial o que ya no está vigente, enlace inválido o enlace que ya usa otra atención                                         | —                                                                                                                  |
| `getOnlineAccess`     | Sin identidad, atención ajena o inexistente, acompañamiento no activo, o quien consulta no participa                                           | —                                                                                                                                       | —                                                                                                                  |

## Aviso al Estudiante

Agregar o reemplazar el enlace emite `appointment_online_access_ready` solo al Estudiante, con `notificationEventsForOnlineAccess`, y lo registra en `notificationEvents` en la misma mutation (repositorio de TI2-118). El texto externo es genérico («Tu atención tiene su acceso disponible») y no lleva el enlace: el Estudiante lo lee en su sesión con `getOnlineAccess`. La clave de idempotencia usa el instante del cambio, así un reemplazo posterior produce otra. `unchanged` no emite aviso. El envío del aviso sigue siendo de TI2-122/TI2-145.

## Compatibilidad

El cambio es aditivo. `bookAppointment` suma argumentos opcionales; `Appointment` y sus vistas no cambian, porque ninguna lectura de agenda entrega todavía los adicionales. `StoredAppointmentForChange` suma `additionalProfessionalIds` opcional. `NOTIFICATION_EVENT_KIND_VALUES` suma una clase, que el validador de `notificationEvents` toma de la misma lista. `appointments` suma el índice `by_privateAccessReference` sobre un campo que ya existía. Mobile no consume todavía la agenda en línea ni estas operaciones y no necesita cambios; Web las consume en TI2-164 (pantalla del profesional para coordinar y agregar el enlace) y TI2-163 (estudiante).

## Comprobación

`convex/tests/appointmentCoordinationApi.test.ts` recorre la API con datos ficticios y el reloj fijo: coordinación con dos profesionales, rechazo del argumento `onlineSupports`, adicional no asignado, segundo intento por el mismo cupo, adicional ocupado en otro acompañamiento (también en la búsqueda de cupos), adicional ya ocupado que impide coordinar o reagendar, reagendamiento que exige la agenda del adicional, mueve a todos y saca al adicional revocado, el enlace (quién lo agrega y lo lee, validación, aviso único, reemplazo, reutilización rechazada y atención cancelada) y que cancelar libere al adicional. Las reglas tienen pruebas propias en `participants.test.ts`, `online_access.test.ts`, `availability.test.ts`, `permissions.test.ts`, `notification.test.ts` y `booking.test.ts`.

Comprobación real del enlace (criterio de aceptación): sobre `0c19dac`, desplegado con `bunx convex dev --once` en el deployment de desarrollo `dev/ray` y con el dataset ficticio, se reservó por la API una atención en línea coordinada por el Profesional Ficticio y se le agregó un enlace de Google Meet real creado con una cuenta institucional. `getOnlineAccess` lo entregó en forma canónica al Estudiante y al Profesional, la practicante y otro Estudiante recibieron `unauthorized`, repetirlo no dejó un segundo aviso y el enlace devuelto abrió la reunión. Los cambios posteriores a `0c19dac` no tocan la escritura ni la lectura del enlace.

## Sin horario compatible: coordinación por canal oficial (TI2-144)

Cuando `presentation/availability.searchSlots` no encuentra un cupo compatible y libre, ya no lanza `no_availability`: devuelve un resultado explícito. `ConvexError` solo lleva `code` y `message` (TI2-88), así que no podía entregar el código de referencia ni los canales. La búsqueda es la misma de TI2-97: no hay otra búsqueda ni otra regla de compatibilidad, y `assessCompatibility` (TI2-82) sigue decidiendo sin rebajar necesidades.

`searchSlots` devuelve una unión discriminada por `status`:

| `status`             | Campos                                                    | Cuándo                                                                  |
| -------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------- |
| `available`          | `items`, `hasMore`, `nextCursor`, `version`               | Hay al menos un cupo compatible y libre en el rango                     |
| `no_compatible_slot` | `coordination: {reason, explanation, referenceCode, channels}`, `version` | Ningún cupo del rango es compatible y libre                |

Cada cupo presencial de `items` suma `space` con `campus`, `building`, `floor`, `room`, `accessConditions` y `arrivalInstructions` de su sala, leídos del catálogo en el servidor (`toSpaceFields`). El cupo en línea no lo trae. `spaceId` se conserva.

El motivo (`reason`) sale de lo que la búsqueda descartó, con `decideNoCompatibleSlotReason`, y la explicación en español está en `NO_COMPATIBLE_SLOT_EXPLANATIONS`. La búsqueda evalúa la compatibilidad antes que la ocupación: un horario ocupado solo cuenta como ocupado si cubría las necesidades, así el motivo no depende de cuánto ocupan otras personas. En orden de prioridad:

| `reason`             | Cuándo                                                                                               |
| -------------------- | ---------------------------------------------------------------------------------------------------- |
| `slots_occupied`     | Hay horarios que cubren las necesidades, pero todos están ocupados por el profesional, el Estudiante o la sala. Prima aunque otros horarios sean incompatibles |
| `needs_not_met`      | Ningún horario del rango cubre las necesidades, esté ocupado o libre: sala que no las cubre o modalidad en línea sin apoyos |
| `no_published_slots` | No hay horarios que se puedan ofrecer en el rango: no se publicaron o su sala ya no está en el catálogo. Un profesional no reservable responde igual, sin revelar si existe |

El código de referencia (`deriveCoordinationReferenceCode`) tiene la forma `CER-XXXX-XXXX` en Base32 de Crockford, sin I, L, O ni U. Se deriva con FNV-1a del identificador del acompañamiento: no contiene nombre, correo, RUT, necesidades ni fechas, y no se revierte al identificador. Es determinista, así el mismo acompañamiento entrega siempre el mismo código aunque busque otra semana u otro profesional. No es un secreto ni prueba identidad. El hash se comparte con la clave del evento de calendario en `convex/domain/hashing/fnv1a.ts`. La vista completa del acompañamiento entrega el mismo código en `referenceCode` (TI2-183, ver «Vínculo con el acompañamiento» en `solicitudes.md`), para que el Profesional autorizado lo reconozca cuando el Estudiante coordina por un canal oficial.

Los canales (`OFFICIAL_CHANNELS`, en `convex/domain/availability/official_channel.ts`) son una unión por `kind`: `inPerson` con `location` (los mismos campos de ubicación y acceso de un espacio), `email` con `address` y `phone` con `phoneNumber`; todos llevan `id`, `name` y `hours`. Son datos ficticios: la especificación deja los canales reales como pendiente de validación con CERETI, y se reemplazan en ese único archivo.

Web consume el resultado en `convex-agenda-adapter.ts`: junta los cupos de todos los profesionales reservables y, si ninguno tiene, entrega `no_availability` con la `coordination` del motivo de mayor prioridad (`combineNoCompatibleSlotReasons`). La pantalla que la muestra es de TI2-163. Mobile no consume `searchSlots` y no necesita cambios. `bookAppointment` y `rescheduleAppointment` siguen respondiendo `no_availability` como error.

Compatibilidad: el cambio de forma de `searchSlots` rompe a un cliente que leía `items` directamente o esperaba el error `no_availability`. El único consumidor es el adaptador Web, que se actualiza en el mismo cambio; la versión sigue siendo `v1`.

Comprobación: `convex/domain/availability/official_channel.test.ts` prueba motivo, código y canales; `convex/application/availability/availability.test.ts` prueba cupo ocupado, sala incompatible (también cuando cubre solo una de dos necesidades), sala retirada (que no se atribuye a las necesidades), que todos los horarios ocupados e incompatibles responden `needs_not_met` y que el único compatible ocupado responde `slots_occupied`, que la página tras el último cupo llega vacía, que el código no lleva datos personales y es estable, y que el cupo presencial trae su sala; `convex/tests/apiBackend.test.ts` recorre la API con datos ficticios, y `calendar_event.test.ts` fija una clave literal para que mover el hash no cambie los eventos ya creados.

## Pendientes

Siguen en otras issues, que se apoyan en lo que entrega esta:

- Mostrar la explicación, el código de referencia y los canales oficiales al Estudiante: TI2-163.
- Avisar a los profesionales adicionales cuando el Estudiante cancela o cuando uno sale al reagendar: TI2-150. `NotificationSubject` tiene un solo `professionalId` y hoy solo se avisa al responsable.
- Mostrar en la agenda los profesionales adicionales, los apoyos y qué atenciones en línea no tienen enlace: TI2-164. `getAppointment` todavía no los entrega y `Appointment` no los declara para no anunciar campos que nunca llegan.
- Registrar en la bitácora que se agregó o reemplazó el enlace: TI2-176, porque la lista de acciones de TI2-128 no lo contempla.
- Sacar de las atenciones futuras a un profesional que se retira del acompañamiento: TI2-152. Hoy solo sale al reagendar la atención.
- La búsqueda de cupos comunes a varios profesionales (`searchSlots` recibe un solo `professionalId`) queda para la coordinación en Web; la reserva igual revalida la disponibilidad de cada uno.
- El máximo de profesionales por atención y los topes de apoyos son provisionales.
