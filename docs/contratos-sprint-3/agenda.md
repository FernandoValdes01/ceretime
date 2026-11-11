# Contrato de agenda de Sprint 3 — varios profesionales y acceso en línea privado (TI2-142)

Superficie que TI2-142 agrega a la agenda: una atención coordinada con varios profesionales, los apoyos de la atención en línea y su enlace privado. Todo es aditivo sobre el contrato v1 de `appointments` (TI2-87, TI2-111, TI2-121): ninguna operación existente cambia su forma y no se crea otra operación de reserva ni otra comprobación de ocupación.

Estado: el dominio está listo en `convex/domain/appointments/participants.ts`, `convex/domain/appointments/online_access.ts` y `convex/domain/notifications/notification.ts`, exportado por `convex/domain/index.ts`. Aplicación, repositorio y Presentación esperan el esquema de TI2-138; las operaciones de este documento son el contrato que esa integración debe cumplir.

## Varios profesionales por atención

La atención conserva `professionalId` como Profesional responsable, el mismo campo que ya consumen Web y Mobile, y suma `additionalProfessionalIds` con los demás profesionales que participan. Ninguna lista reemplaza a la otra: una atención de un solo profesional no trae el campo nuevo y se lee igual que antes.

`normalizeAppointmentProfessionals` recorta los identificadores, descarta repeticiones (incluido el responsable repetido entre los adicionales) y rechaza un responsable vacío (`professional_required`), un adicional vacío (`professional_invalid`) o más de `MAX_APPOINTMENT_PROFESSIONALS` en total (`too_many_professionals`). El máximo es 3 contando al responsable y es provisional hasta que CERETI confirme cuántos profesionales coordinan a la vez. Que cada identificador sea un Profesional vigente y asignado al acompañamiento lo comprueba Aplicación.

La detección de cruces sigue siendo una sola (`occupySlotAtomically`, TI2-84/TI2-96) y recorre `appointmentProfessionalIds`: el responsable primero y luego cada adicional, sin repetir. La reserva solo se confirma si el Estudiante, la sala y todos los profesionales están libres en `[startAt, endAt)`, y si cada profesional tiene disponibilidad vigente y compatible para ese cupo. Ante dos intentos por el mismo cupo, la transacción de Convex confirma uno y el otro recibe `conflict`, igual que hoy con un solo profesional.

Participan de la atención el Estudiante dueño y cada uno de sus profesionales (`isAppointmentParticipant`). El Practicante no participa por estar asignado al acompañamiento: su acceso sigue siendo la vista minimizada de TI2-127, que tampoco trae `additionalProfessionalIds` ni `onlineSupports`.

## Acceso privado de la atención en línea

Decisión del 08/11/2026: un Profesional de la atención agrega un enlace de Google Meet institucional y CERETI lo guarda en esa atención. No se genera desde Google Calendar, porque vincular Calendar es opcional y rechazarlo no puede impedir una atención en línea, y porque `docs/google-calendar.md` define que el evento no incluye enlaces privados. La generación automática con la API de Meet queda para una fase posterior, y Google ya figura como proveedor, así que no se agrega otro al inventario de TI2-139.

`normalizeOnlineAccessLink` exige `https`, el dominio exacto `meet.google.com` (sin subdominios parecidos, credenciales ni puerto) y un código de reunión `sol-casa-pan`. Descarta la consulta y el fragmento, que suelen traer la cuenta de quien copió el enlace, y guarda la forma canónica `https://meet.google.com/sol-casa-pan`. La forma canónica permite comparar enlaces: es un enlace por atención, no una sala fija reutilizada entre estudiantes.

`decideOnlineAccessUpdate` permite agregar o reemplazar el enlace solo a un profesional de la atención (responsable o adicional), solo en una atención en línea y solo mientras siga vigente (`scheduled` o `rescheduled`). Las causas se evalúan de la más general a la más específica: un actor ajeno recibe `actor_not_professional` antes de que se mire la atención o el enlace. El resultado distingue `added`, `replaced` y `unchanged`; un reintento con el mismo enlace es `unchanged`, no escribe y no avisa.

El enlace no forma parte de `Appointment` ni de sus proyecciones, así que ningún listado de agenda lo trae. Solo sale por la lectura dedicada, que usa `toOnlineAccessView`:

| Estado           | Cuándo                                                                     | Trae enlace |
| ---------------- | -------------------------------------------------------------------------- | ----------- |
| `pending`        | Atención en línea vigente sin enlace todavía                               | No          |
| `available`      | Atención en línea vigente con enlace                                       | Sí          |
| `not_applicable` | Atención presencial, o cancelada, realizada o con inasistencia             | No          |
| `null`           | Quien consulta no participa; Presentación responde `unauthorized` sin más | No          |

## Apoyos de la atención en línea

`onlineSupports` guarda los apoyos que ofrece la atención en línea, como subtítulos o interpretación, con la misma forma `AccessNeed` (`{id, label}`) que `CompatibilityOption.onlineSupports` de TI2-82. No hay un catálogo paralelo: la reserva comprueba con `assessCompatibility` que los apoyos cubran las necesidades vigentes del acompañamiento y nunca rebaja una necesidad. `normalizeOnlineSupports` recorta, exige identificador y etiqueta (`support_invalid`), deja el primero de cada identificador repetido y rechaza apoyos en una atención presencial (`not_online`), porque ahí los cubre la sala. Una lista vacía es válida.

Esto resuelve la limitación de TI2-111: hasta ahora la plataforma en línea no declaraba apoyos porque el esquema no tenía dónde guardarlos, y un acompañamiento con necesidades no recibía cupos en línea.

## Operaciones públicas previstas

Todas exigen `version: "v1"`, derivan la identidad con `ctx.auth.getUserIdentity()` y nunca aceptan `studentId` ni el actor como argumento.

| Operación                                    | Tipo     | Argumentos                                                                                                                                | Devuelve                                            | Quién                                                                                                                 |
| -------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `presentation/appointments.bookAppointment`  | mutation | Los de TI2-111 más `additionalProfessionalIds?: string[]` y `onlineSupports?: {id, label}[]`                                              | `{appointmentId}`                                   | Estudiante dueño de un acompañamiento activo, sin adicionales; o Profesional asignado que coordina con adicionales |
| `presentation/appointments.setOnlineAccessLink` | mutation | `appointmentId`, `link`, `version`                                                                                                     | `{appointmentId}`                                   | Profesional de la atención (responsable o adicional)                                                                 |
| `presentation/appointments.getOnlineAccess`  | query    | `appointmentId`, `version`                                                                                                                | `{status: "pending" \| "available" \| "not_applicable", link?, version}` | Estudiante dueño o profesional de la atención                                                    |

`bookAppointment` sigue siendo la única operación de reserva: el Estudiante reserva como hoy y el Profesional asignado la usa para coordinar una atención con otros profesionales del mismo acompañamiento. Cuando reserva un Profesional, el Estudiante sale del acompañamiento y el Profesional debe ser uno de los profesionales de la atención.

## Respuestas y errores

Se usan solo los códigos de TI2-88 (`ConvexError({code, message})` con esas dos claves) y los clientes distinguen por `code`. No se agrega un código nuevo: Web ya importa `convex/domain` y valida el enlace con `normalizeOnlineAccessLink` antes de enviarlo, así muestra la causa exacta con la misma regla del servidor.

| Operación             | `unauthorized`                                                                                                        | `conflict`                                                                                                                     | `no_availability`                                                                                    |
| --------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `bookAppointment`     | Los casos de TI2-111, y un Estudiante que envía `additionalProfessionalIds` no vacío                                  | Los casos de TI2-111, cruce de cualquiera de los profesionales, profesional vacío, más del máximo o apoyos inválidos           | Los casos de TI2-111, y un adicional que no está asignado, no está vigente o no tiene ese cupo libre |
| `setOnlineAccessLink` | Sin identidad, atención ajena o inexistente, o actor que no es profesional de la atención (`actor_not_professional`) | Atención presencial (`not_online`), atención que ya no está vigente (`not_actionable`) o enlace inválido (cualquier `link_*`) | —                                                                                                    |
| `getOnlineAccess`     | Sin identidad, atención ajena o inexistente, o quien consulta no participa                                           | —                                                                                                                              | —                                                                                                    |

## Aviso al Estudiante

Agregar o reemplazar el enlace emite `appointment_online_access_ready` solo al Estudiante, con `notificationEventsForOnlineAccess`. El texto externo es genérico («Tu atención tiene su acceso disponible») y no lleva el enlace: el Estudiante lo lee en su sesión con `getOnlineAccess`. La clave de idempotencia usa el instante persistido del cambio, así un reintento repite la misma clave y un reemplazo posterior produce otra. `unchanged` no emite aviso.

## Requisitos para el esquema (TI2-138)

- Convex no indexa elementos de un arreglo, así que `additionalProfessionalIds` no basta para detectar cruces. Se necesita una tabla de participación con `appointmentId`, `professionalId`, `startsAt` y `endsAt`, e índice por `professionalId` y `startsAt`, que responda «atenciones del profesional en `[a, b)`» sin importar si es responsable o adicional. Se recomienda que incluya también al responsable para que la comprobación lea un solo índice; `appointments.professionalId` se conserva por el contrato v1.
- El reagendamiento debe actualizar `startsAt` y `endsAt` de esas filas en la misma transacción que la atención.
- `onlineAccessLink` opcional en `appointments`, con la forma canónica. Es la «referencia de su acceso privado» de TI2-138; un índice por ese campo permite rechazar el mismo enlace en otra atención vigente.
- `onlineSupports` opcional en `appointments`, como lista de `{id, label}`.
- Las filas existentes no traen ninguno de estos campos y se leen como atención de un solo profesional, sin apoyos y con el enlace pendiente si son en línea.

## Compatibilidad

El cambio es aditivo. `Appointment` suma dos campos opcionales y la vista minimizada no los expone. `NOTIFICATION_EVENT_KIND_VALUES` suma una clase, que el validador de `notificationEvents` toma de la misma lista. Mobile no consume todavía la agenda en línea ni estas operaciones y no necesita cambios; Web las consume en TI2-164 (pantalla del profesional para el enlace) y TI2-163 (estudiante).

## Pendientes

- `NotificationSubject` tiene un solo `professionalId`: hoy la cancelación del Estudiante avisa solo al responsable. Al integrar Aplicación hay que decidir si avisa también a los adicionales.
- La búsqueda de cupos comunes a varios profesionales (`searchSlots` recibe un solo `professionalId`) queda para la coordinación en Web; la reserva igual revalida la disponibilidad de cada uno.
- El máximo de profesionales por atención es provisional.
- La comprobación del enlace se hace con una atención y un enlace reales al cerrar la integración: una simulación no cuenta como terminada.
