# Contrato de agenda de Sprint 3 — varios profesionales y acceso en línea privado (TI2-142)

Superficie que TI2-142 agrega a la agenda: una atención coordinada con varios profesionales, los apoyos de la atención en línea y su enlace privado. Todo es aditivo sobre el contrato v1 de `appointments` (TI2-87, TI2-111, TI2-121): ninguna operación existente cambia su forma, no se crea otra operación de reserva ni otra comprobación de ocupación, y la persistencia es la de TI2-138 (`appointmentProfessionals`, `onlineSupports` y `privateAccessReference`).

Recorrido por capas: las reglas viven en `convex/domain/appointments/participants.ts`, `convex/domain/appointments/online_access.ts`, `convex/domain/availability/availability.ts` (`slotsCoverInterval`) y `convex/domain/authorization/permissions.ts` (`canCoordinateAppointment`, `canUseAppointmentOnlineAccess`); los casos de uso, en `convex/application/appointments/booking.ts`, `changes.ts` y `online_access.ts`; la persistencia y los cruces, en `convex/infrastructure/appointments/repository.ts`; y la API pública, en `convex/presentation/appointments.ts`.

## Varios profesionales por atención

La atención conserva `professionalId` como Profesional responsable, el mismo campo que ya consumen Web y Mobile, y suma profesionales adicionales. En el dominio viajan como `additionalProfessionalIds`; en la base son filas de `appointmentProfessionals`, que TI2-138 creó con el conjunto completo (responsable incluido) y la ventana copiada de la atención. Una atención de un solo profesional se lee igual que antes.

`normalizeAppointmentProfessionals` recorta los identificadores, descarta repeticiones (incluido el responsable repetido entre los adicionales) y rechaza un responsable vacío (`professional_required`), un adicional vacío (`professional_invalid`) o más de `MAX_APPOINTMENT_PROFESSIONALS` en total (`too_many_professionals`). El máximo es 3 contando al responsable y es provisional hasta que CERETI confirme cuántos profesionales coordinan a la vez. El repositorio tiene aparte `MAX_APPOINTMENT_PROFESSIONAL_ROWS`, un tope técnico de lectura que no es la regla de negocio.

Disponibilidad de todos: el cupo del responsable se revalida como siempre (`resolveBookableSlot`). Cada adicional debe seguir asignado y vigente en el acompañamiento y tener disponibilidad vigente de la misma modalidad durante toda la atención (`confirmAdditionalProfessionals` con `slotsCoverInterval`); su agenda puede estar partida en cupos de otra duración, por ejemplo dos de 30 minutos cubren una atención de 60. La sala la fija el cupo del responsable. Un adicional que no cumple responde `no_availability`.

Cruces de todos: la ocupación atómica (`occupySlotAtomically`, TI2-84/TI2-96) comprueba en la misma transacción al Estudiante, a la sala y a cada profesional. Un profesional está ocupado si se cruza con una atención no cancelada donde es responsable (índice `appointments.by_professionalId_and_startsAt`) o participante (índice `appointmentProfessionals.by_professionalId_and_startsAt`); se leen ambos porque una atención anterior a la migración de TI2-138 todavía no tiene su fila de participante. Ante dos intentos por el mismo cupo, la transacción confirma uno y el otro recibe `conflict`.

Reagendar una atención coordinada conserva a sus profesionales adicionales y sus apoyos: cada adicional que siga siendo reservable debe tener disponibilidad que cubra el destino, la ocupación comprueba los cruces de todos y el repositorio mueve la ventana de todas las filas de participante. Un adicional que ya no es reservable (asignación revocada o cuenta no vigente) sale de la atención en el mismo cambio y su fila de participante se retira: no hay otra vía para retirarlo y ya no podría atenderla, así que no impide reagendar. Si el destino cambia al responsable, la fila del anterior pasa a ser la del nuevo (comportamiento de TI2-138).

Participan de la atención el Estudiante dueño y cada uno de sus profesionales (`isAppointmentParticipant`). El Practicante no participa por estar asignado al acompañamiento: su acceso sigue siendo la vista minimizada de TI2-127, que tampoco trae `additionalProfessionalIds` ni `onlineSupports`.

## Acceso privado de la atención en línea

Decisión del 08/11/2026: un Profesional de la atención agrega un enlace de Google Meet institucional y CERETI lo guarda en `appointments.privateAccessReference`. No se genera desde Google Calendar, porque vincular Calendar es opcional y rechazarlo no puede impedir una atención en línea, y porque `docs/google-calendar.md` define que el evento no incluye enlaces privados. La generación automática con la API de Meet queda para una fase posterior, y Google ya figura como proveedor, así que no se agrega otro al inventario de TI2-139.

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

`onlineSupports` guarda los apoyos que ofrece la atención en línea, como subtítulos o interpretación, con la misma forma `AccessNeed` (`{id, label}`) que `CompatibilityOption.onlineSupports` de TI2-82. No hay un catálogo paralelo: la reserva suma los apoyos declarados a los de la plataforma y comprueba con `assessCompatibility` que cubran las necesidades vigentes del acompañamiento, sin rebajar ninguna. Como las necesidades del acompañamiento se guardan como texto y cada línea es su propio identificador (decisión de TI2-111), un apoyo cubre una necesidad cuando su `id` repite esa línea. `normalizeOnlineSupports` recorta, exige identificador y etiqueta (`support_invalid`), deja el primero de cada identificador repetido y rechaza apoyos en una atención presencial (`not_online`), porque ahí los cubre la sala. Los apoyos los escribe el personal como texto, así que se acotan para no guardar listas ni textos arbitrarios en la atención (minimización, Ley 21.719): hasta `MAX_ONLINE_SUPPORTS` (10) apoyos distintos (`too_many_supports`) y hasta `ONLINE_SUPPORT_TEXT_MAX_LENGTH` (300) caracteres en el identificador y en la etiqueta (`support_too_long`). Ambos topes son provisionales hasta que CERETI confirme su catálogo; una necesidad de más de 300 caracteres no se puede declarar como apoyo. Una lista vacía es válida.

Esto resuelve la limitación de TI2-111 para la coordinación: un acompañamiento con necesidades recibe una atención en línea cuando quien coordina declara los apoyos que las cubren. La búsqueda de cupos del Estudiante no cambia: la plataforma sigue sin declarar apoyos propios.

## Operaciones públicas

Todas exigen `version: "v1"`, derivan la identidad con `ctx.auth.getUserIdentity()` y nunca aceptan `studentId` ni el actor como argumento.

| Operación                                       | Tipo     | Argumentos                                                                                                 | Devuelve                                                                 | Quién                                                                                                                          |
| ----------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `presentation/appointments.bookAppointment`     | mutation | Los de TI2-111 más `additionalProfessionalIds?: string[]` y `onlineSupports?: {id, label}[]`              | `{appointmentId}`                                                        | Estudiante dueño de un acompañamiento activo, sin adicionales ni apoyos; o Profesional asignado que participa en la atención |
| `presentation/appointments.setOnlineAccessLink` | mutation | `appointmentId`, `link`, `version`                                                                         | `{appointmentId}`                                                        | Profesional de la atención (responsable o adicional) con asignación activa                                                    |
| `presentation/appointments.getOnlineAccess`     | query    | `appointmentId`, `version`                                                                                 | `{status: "pending" \| "available" \| "not_applicable", link?, version}` | Estudiante dueño o profesional de la atención con asignación activa                                                          |

`bookAppointment` sigue siendo la única operación de reserva. El Estudiante reserva como antes. El Profesional asignado la usa para coordinar en nombre del Estudiante dueño, que sale del acompañamiento leído en el servidor; el Profesional que coordina debe ser uno de los profesionales de la atención. Es la única ampliación de permisos: hasta ahora un Profesional que llamaba a `bookAppointment` recibía `unauthorized`.

## Respuestas y errores

Se usan solo los códigos de TI2-88 (`ConvexError({code, message})` con esas dos claves) y los clientes distinguen por `code`. No se agrega un código nuevo: Web ya importa `convex/domain` y puede validar el enlace con `normalizeOnlineAccessLink` antes de enviarlo, así muestra la causa exacta con la misma regla del servidor.

| Operación             | `unauthorized`                                                                                                                                 | `conflict`                                                                                                                              | `no_availability`                                                                                                  |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `bookAppointment`     | Los casos de TI2-111; un Estudiante que envía adicionales o apoyos; un Profesional que no participa en la atención que coordina                 | Los casos de TI2-111; cruce de cualquiera de los profesionales; adicional vacío o más del máximo; apoyos inválidos, demasiados, demasiado largos o en presencial | Los casos de TI2-111; un adicional sin asignación activa o vigencia, o cuya disponibilidad no cubre la atención    |
| `rescheduleAppointment` | Los casos de TI2-121                                                                                                                         | Los casos de TI2-121, incluido el cruce de cualquiera de los profesionales                                                              | Los casos de TI2-121, y un adicional reservable cuya disponibilidad no cubre el destino (el que ya no es reservable sale de la atención) |
| `setOnlineAccessLink` | Sin identidad, atención ajena o inexistente, acompañamiento no activo, o actor que no es profesional de la atención                            | Atención presencial o que ya no está vigente, enlace inválido o enlace que ya usa otra atención                                         | —                                                                                                                  |
| `getOnlineAccess`     | Sin identidad, atención ajena o inexistente, acompañamiento no activo, o quien consulta no participa                                           | —                                                                                                                                       | —                                                                                                                  |

## Aviso al Estudiante

Agregar o reemplazar el enlace emite `appointment_online_access_ready` solo al Estudiante, con `notificationEventsForOnlineAccess`, y lo registra en `notificationEvents` en la misma mutation (repositorio de TI2-118). El texto externo es genérico («Tu atención tiene su acceso disponible») y no lleva el enlace: el Estudiante lo lee en su sesión con `getOnlineAccess`. La clave de idempotencia usa el instante del cambio, así un reemplazo posterior produce otra. `unchanged` no emite aviso. El envío del aviso sigue siendo de TI2-122/TI2-145.

## Compatibilidad

El cambio es aditivo. `bookAppointment` suma argumentos opcionales; `Appointment` y sus vistas no cambian, porque ninguna lectura de agenda entrega todavía los adicionales ni los apoyos. `StoredAppointmentForChange` suma `additionalProfessionalIds` y `onlineSupports` opcionales. `NOTIFICATION_EVENT_KIND_VALUES` suma una clase, que el validador de `notificationEvents` toma de la misma lista. `appointments` suma el índice `by_privateAccessReference` sobre un campo que ya existía. Mobile no consume todavía la agenda en línea ni estas operaciones y no necesita cambios; Web las consume en TI2-164 (pantalla del profesional para coordinar y agregar el enlace) y TI2-163 (estudiante).

## Comprobación

`convex/tests/appointmentCoordinationApi.test.ts` recorre la API con datos ficticios y el reloj fijo: coordinación con dos profesionales, apoyos que cubren la necesidad, adicional no asignado, segundo intento por el mismo cupo, adicional ocupado en otro acompañamiento, reagendamiento que exige la agenda del adicional, mueve a todos y saca al adicional revocado, el enlace (quién lo agrega y lo lee, validación, aviso único, reemplazo, reutilización rechazada y atención cancelada) y que cancelar libere al adicional. Las reglas tienen pruebas propias en `participants.test.ts`, `online_access.test.ts`, `availability.test.ts`, `permissions.test.ts`, `notification.test.ts` y `booking.test.ts`.

## Pendientes

- `NotificationSubject` tiene un solo `professionalId`: la cancelación del Estudiante avisa solo al responsable. Falta decidir si avisa también a los adicionales.
- El detalle de la atención (`getAppointment`) todavía no devuelve los profesionales adicionales ni los apoyos, y `Appointment` no los declara para no anunciar campos que nunca llegan; TI2-164 puede pedirlos si su pantalla los muestra.
- Un adicional que sale al reagendar no recibe aviso: la política de notificación solo conoce al Estudiante y al responsable.
- La búsqueda de cupos comunes a varios profesionales (`searchSlots` recibe un solo `professionalId`) queda para la coordinación en Web; la reserva igual revalida la disponibilidad de cada uno.
- Agregar o reemplazar el enlace no deja evento en la bitácora de TI2-128, porque su lista de acciones no lo contempla; sumarlo cambia ese contrato.
- El máximo de profesionales por atención es provisional.
- La comprobación del enlace con una atención y un enlace de Meet reales en un deployment queda para el cierre de la integración: las pruebas con `convex-test` no cuentan como esa comprobación.
