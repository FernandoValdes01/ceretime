---
created: 2026-11-17T00:00
updated: 2026-11-17T00:00
---

# Inventario de datos personales, finalidades y bases propuestas

Este inventario describe los datos que el prototipo CERETI mantiene en `convex/schema.ts`, la finalidad de cada tabla, la base jurídica propuesta, el acceso por rol y el proveedor que los aloja. Es un borrador técnico para revisión de TI2 y de la UCT. No es una política aprobada, no reemplaza la revisión jurídica y no habilita el uso con datos reales.

La Ley 21.719 entra en vigencia el 1 de diciembre de 2026. El análisis general vive en [Aplicación de la Ley 21.719](producto/ley-21719.md), el procedimiento de derechos en [Procedimiento de prueba para solicitudes de privacidad](privacidad-procedimiento.md) y el texto para las personas en [Aviso de privacidad](privacidad-aviso.md).

## Cómo leer el inventario

- **Alcance.** Cubre las 17 tablas de `convex/schema.ts` y las tablas del componente de autenticación Better Auth. Las tablas sin datos personales se listan igual para que el inventario no tenga huecos.
- **Datos personales.** Cualquier dato que identifique o pueda identificar a una persona, sola o combinada con otros datos. Los identificadores internos (`_id`, `studentId`, `professionalId`, `actorId`) cuentan porque vinculan filas con una persona.
- **Datos sensibles.** El prototipo trata como sensibles las necesidades de acceso, los antecedentes de discapacidad o salud, las justificaciones de inasistencia y cualquier texto libre que pueda revelarlos. La calificación jurídica definitiva está pendiente.
- **Base propuesta.** Es una propuesta de TI2 para que la UCT la apruebe o la reemplace. Las etiquetas «relación de acompañamiento», «relación institucional», «seguridad» y «rendición de cuentas» son categorías de trabajo, no bases legales definitivas; la traducción a las bases de la Ley 21.719 y el análisis de interés legítimo quedan pendientes. Ninguna base está aprobada.
- **Acceso.** Describe la lectura y la escritura que existen hoy en el Backend o en los contratos. La matriz ejecutable vive en [`convex/domain/authorization/permissions-matrix.md`](../convex/domain/authorization/permissions-matrix.md).
- **Proveedor.** Indica dónde se aloja el dato y quién lo procesa. Los contratos, países y garantías se detallan en [Proveedores y transferencias](#proveedores-y-transferencias).
- **Fecha.** El inventario corresponde al esquema de `convex/schema.ts` y al código de la rama al 17 de noviembre de 2026.

## Resumen por tabla

| Tabla                      | Finalidad                                      | Datos personales | Datos sensibles | Base propuesta                                      | Proveedor                             |
| -------------------------- | ---------------------------------------------- | ---------------- | --------------- | --------------------------------------------------- | ------------------------------------- |
| `users`                    | Identificar, autenticar y habilitar cuentas    | Sí               | No              | Relación institucional y seguridad                  | Convex; Google Workspace como origen  |
| `accompaniments`           | Coordinar el acompañamiento                    | Sí               | Sí              | Consentimiento expreso y relación de acompañamiento | Convex                                |
| `accompanimentAssignments` | Controlar quién accede al acompañamiento       | Sí               | No              | Seguridad y control de acceso                       | Convex                                |
| `followUpNotes`            | Registrar notas internas                       | Sí               | Posible         | Relación de acompañamiento                          | Convex                                |
| `requests`                 | Recibir y revisar solicitudes                  | Sí               | Sí              | Consentimiento expreso y relación de acompañamiento | Convex                                |
| `requestTransitions`       | Auditar cambios de estado                      | Sí               | Posible         | Rendición de cuentas                                | Convex                                |
| `requestAssignments`       | Controlar la toma de solicitudes               | Sí               | No              | Seguridad y control de acceso                       | Convex                                |
| `spaces`                   | Publicar espacios accesibles                   | No               | No              | No aplica                                           | Convex                                |
| `availabilityBlocks`       | Publicar disponibilidad profesional            | Sí               | No              | Relación de acompañamiento                          | Convex                                |
| `availabilityExceptions`   | Ajustar la disponibilidad                      | Sí               | Posible         | Relación de acompañamiento                          | Convex                                |
| `appointments`             | Agendar y registrar atenciones                 | Sí               | Sí              | Consentimiento expreso y relación de acompañamiento | Convex; Google Calendar si se conecta |
| `appointmentProfessionals` | Coordinar varios profesionales en una atención | Sí               | No              | Relación de acompañamiento                          | Convex                                |
| `notificationEvents`       | Registrar avisos de cambios                    | Sí               | No              | Relación de acompañamiento                          | Convex; correo o push pendiente       |
| `appointmentAuditEvents`   | Auditar cambios de agenda                      | Sí               | No              | Rendición de cuentas y seguridad                    | Convex                                |
| `followUpRecords`          | Registrar el seguimiento                       | Sí               | Posible         | Relación de acompañamiento                          | Convex                                |
| `followUpAgreements`       | Registrar acuerdos del seguimiento             | Sí               | Posible         | Relación de acompañamiento                          | Convex                                |
| `followUpTasks`            | Registrar tareas del seguimiento               | Sí               | Posible         | Relación de acompañamiento                          | Convex                                |

La columna «Base propuesta» resume la propuesta principal de cada tabla. El detalle justifica las salvedades y señala cuándo un texto libre puede contener datos sensibles.

## Detalle por tabla

### `users`

- **Datos personales.** `email`, `fullName`, `role`, `institutionalStatus`, `accountStatus`, `tokenIdentifier`, `enabledBy`, `enabledAt`, `revokedBy` y `revokedAt`. `tokenIdentifier` es la clave estable de la identidad de Google. Los campos `enabledBy` y `revokedBy` identifican al administrador que habilitó o revocó la cuenta.
- **Finalidad.** Identificar a la persona, verificar su identidad con Google Workspace, decidir su rol, habilitar o revocar cuentas de personal y conservar el rastro de esas decisiones.
- **Base propuesta.** Ejecución de la relación institucional para la cuenta y el acceso, y seguridad para la auditoría. Pendiente de aprobación.
- **Acceso por rol.** El titular lee su propio perfil con `presentation/session.getMyProfile`. El Administrador lista y lee cuentas de personal con `presentation/accounts.listAccounts` y `getAccount`; no lee cuentas de estudiantes. Ningún otro rol lee perfiles ajenos.
- **Proveedor.** Convex almacena la fila. Google Workspace entrega la identidad durante el inicio de sesión.

### `accompaniments`

- **Datos personales.** `studentId`, `status`, `objective`, `accessNeeds` y `requestId`. `objective` y `accessNeeds` son texto libre y pueden revelar una discapacidad o una condición de salud.
- **Finalidad.** Mantener el objetivo del acompañamiento, su estado y las necesidades de acceso vigentes, y vincularlo con la solicitud que lo originó.
- **Base propuesta.** Consentimiento expreso para `accessNeeds` y relación de acompañamiento para el resto. Pendiente de aprobación.
- **Acceso por rol.** El Estudiante dueño lee la vista completa. El Profesional asignado lee la vista completa. El Practicante asignado lee la vista minimizada, sin `studentId` ni `accessNeeds`. El Administrador está denegado siempre.
- **Proveedor.** Convex.

### `accompanimentAssignments`

- **Datos personales.** `accompanimentId`, `userId`, `assignedRole`, `status`, `grantedBy`, `grantedAt`, `revokedBy`, `revokedAt`, `validFrom` y `validUntil`. Registra quién tiene acceso, qué rol cumple y quién concedió o revocó ese acceso.
- **Finalidad.** Autorizar el acceso a un acompañamiento concreto y conservar la trazabilidad de la concesión y la revocación.
- **Base propuesta.** Seguridad y control de acceso. Pendiente de aprobación.
- **Acceso por rol.** No hay un listado público de asignaciones. La capa de autorización lee la asignación vigente en cada operación. El Profesional de personal concede, modifica y revoca; el Practicante no puede hacerlo.
- **Proveedor.** Convex.

### `followUpNotes`

- **Datos personales.** `accompanimentId`, `authorId` y `body`. `body` es texto libre y puede contener datos sensibles.
- **Finalidad.** Guardar una nota interna breve y necesaria para el seguimiento. No es una ficha clínica; el sistema rechaza las etiquetas clínicas explícitas, pero un texto libre aún puede revelar datos sensibles.
- **Base propuesta.** Relación de acompañamiento, con minimización y acceso restringido. Si el texto contiene datos sensibles, consentimiento expreso o la excepción legal que corresponda. Pendiente de aprobación.
- **Acceso por rol.** Solo el Profesional asignado al acompañamiento lee las notas. El Estudiante dueño está denegado, aunque sea su acompañamiento. El Practicante y el Administrador también están denegados.
- **Proveedor.** Convex.

### `requests`

- **Datos personales.** `studentId`, `status`, `accessNeeds`, `createdAt`, `takenBy`, `needSummary`, `expectedOutcome`, `accessNeedSelections`, `otherAccessNeed`, `modalityPreference`, `generalAvailability`, `preferredAccessibleInformationChannel`, `provenance`, `incomingReferral`, `outgoingReferral`, `closureReason` e `idempotencyKey`. Varios campos son texto libre y pueden revelar una discapacidad, una condición de salud o una situación académica.
- **Finalidad.** Recibir la solicitud, revisarla, pedir información, aceptarla, derivarla o cerrarla sin acompañamiento. La solicitud aceptada origina un acompañamiento.
- **Base propuesta.** Relación de acompañamiento para los datos de contacto y gestión. Consentimiento expreso para las necesidades de acceso y los datos sensibles. Las derivaciones requieren revisar la base aplicable con la unidad de origen. Pendiente de aprobación.
- **Acceso por rol.** El Estudiante dueño lista y lee sus propias solicitudes. El Profesional con toma activa lista y lee las solicitudes que tomó. El Profesional vigente puede registrar una solicitud por canal oficial a nombre de un Estudiante activo. El Practicante y el Administrador están denegados.
- **Proveedor.** Convex.

### `requestTransitions`

- **Datos personales.** `requestId`, `from`, `to`, `actorId`, `reason` y `occurredAt`. `reason` es texto libre y puede contener datos personales o sensibles.
- **Finalidad.** Conservar una bitácora append-only de los cambios de estado de la solicitud, con actor, motivo y fecha.
- **Base propuesta.** Rendición de cuentas y cumplimiento. Pendiente de aprobación.
- **Acceso por rol.** No hay lectura pública del historial completo. Los casos de uso escriben la transición. El Estudiante ve el pedido de información, su respuesta y la razón de cierre en el detalle, no la bitácora completa.
- **Proveedor.** Convex.

### `requestAssignments`

- **Datos personales.** `requestId`, `userId`, `grantedBy`, `grantedAt`, `status`, `revokedBy` y `revokedAt`. Registra qué Profesional tomó una solicitud y cuándo.
- **Finalidad.** Controlar qué Profesional puede operar cada solicitud. La toma es personal: nadie asigna una solicitud a otra persona.
- **Base propuesta.** Seguridad y control de acceso. Pendiente de aprobación.
- **Acceso por rol.** No hay un listado público de tomas. La autorización lee la toma activa del Profesional. El Profesional toma su propia solicitud. El Practicante y el Administrador están denegados.
- **Proveedor.** Convex.

### `spaces`

- **Datos personales.** Ninguno. `campus`, `building`, `floor`, `room`, `accessConditions`, `accessInstructions` e `isActive` describen una sala y sus condiciones de acceso, no a una persona.
- **Finalidad.** Publicar el catálogo de espacios presenciales con sus condiciones e instrucciones de llegada.
- **Base propuesta.** No aplica, porque no contiene datos personales. El uso del catálogo se rige por la relación de acompañamiento.
- **Acceso por rol.** Cualquier cuenta habilitada y vigente, sin importar el rol, puede leer el catálogo. El catálogo no da acceso a acompañamientos.
- **Proveedor.** Convex.

### `availabilityBlocks`

- **Datos personales.** `professionalId`, `weekday`, `startMinute`, `endMinute`, `slotMinutes`, `modality`, `spaceId` e `isActive`. La combinación revela la disponibilidad laboral de una persona y, si es presencial, dónde atiende.
- **Finalidad.** Publicar los bloques recurrentes de disponibilidad del Profesional y calcular los cupos reservables.
- **Base propuesta.** Relación de acompañamiento y organización del trabajo. Pendiente de aprobación.
- **Acceso por rol.** El Profesional lee y edita su propia disponibilidad. El Estudiante y el Profesional asignado leen los cupos derivados para un acompañamiento. El Practicante y el Administrador están denegados.
- **Proveedor.** Convex.

### `availabilityExceptions`

- **Datos personales.** `professionalId`, `date`, `kind`, `blockId`, `startMinute`, `endMinute`, `slotMinutes`, `modality`, `spaceId` y `reason`. `reason` es opcional y puede contener datos personales o de salud.
- **Finalidad.** Cancelar o agregar una ventana puntual sobre la disponibilidad recurrente.
- **Base propuesta.** Relación de acompañamiento y organización del trabajo. El motivo se minimiza y no se publica. Pendiente de aprobación.
- **Acceso por rol.** El Profesional lee y edita sus propias excepciones. Los demás roles autorizados solo ven el efecto en los cupos, nunca el motivo. El Practicante y el Administrador están denegados.
- **Proveedor.** Convex.

### `appointments`

- **Datos personales.** `accompanimentId`, `studentId`, `professionalId`, `spaceId`, `modality`, `status`, `startsAt`, `endsAt`, `originalStartsAt`, `cancelReason`, `calendarEventId`, `calendarEventAddedAt`, `calendarEventStartsAt`, `calendarEventEndsAt`, `justificationExplanation`, `justificationSubmittedAt`, `justificationReview`, `supportingDocumentReceived`, `appliedAccessNeeds`, `onlineSupports`, `privateAccessReference` y `createdAt`. Las necesidades aplicadas, los apoyos en línea, la justificación y su revisión pueden ser datos sensibles. `privateAccessReference` es un enlace privado de la atención en línea.
- **Finalidad.** Agendar, mover, cancelar y registrar una atención, incluida la inasistencia y su justificación. También conserva el enlace privado de la atención en línea y la referencia del evento de Google Calendar cuando la persona lo agrega.
- **Base propuesta.** Relación de acompañamiento para la agenda y la atención. Consentimiento expreso para las necesidades de acceso, los apoyos y los datos de salud de la justificación. La conexión con Google Calendar usa un consentimiento separado. Pendiente de aprobación.
- **Acceso por rol.** El Estudiante dueño lee la vista compartida, sin el motivo de cancelación. El Profesional asignado lee la vista completa. El Practicante asignado lee la vista minimizada, sin necesidades de acceso, textos libres ni enlace privado. El Administrador está denegado. El enlace privado lo leen el Estudiante dueño y el Profesional que participa en la atención. Las referencias de Calendar son persistencia interna y no se exponen.
- **Proveedor.** Convex. Google Calendar recibe únicamente un evento genérico con fecha y hora si la persona conecta su cuenta.

### `appointmentProfessionals`

- **Datos personales.** `appointmentId`, `professionalId`, `startsAt` y `endsAt`. Vincula a los profesionales que participan en una atención y copia su ventana horaria.
- **Finalidad.** Coordinar una atención entre varios profesionales y detectar cruces de agenda sin duplicar la atención.
- **Base propuesta.** Relación de acompañamiento y organización del trabajo. Pendiente de aprobación.
- **Acceso por rol.** No tiene lectura pública propia. La autorización y la agenda la usan para decidir quién participa y para detectar cruces. Los participantes ven la atención a través de `appointments`.
- **Proveedor.** Convex.

### `notificationEvents`

- **Datos personales.** `kind`, `appointmentId`, `recipientId`, `occurredAt`, `version` e `idempotencyKey`. Vincula un aviso con una persona y una atención, aunque no guarda texto, motivos ni detalles del acompañamiento.
- **Finalidad.** Registrar los eventos de notificación de una atención para que un envío posterior no duplique avisos. El envío por correo o push todavía no está implementado.
- **Base propuesta.** Relación de acompañamiento para los avisos necesarios del servicio. Consentimiento para los canales opcionales, si la UCT los define así. Pendiente de aprobación.
- **Acceso por rol.** No hay lectura pública en esta entrega. El sistema escribe el evento en la misma transacción del cambio. El destinatario podrá leer sus avisos cuando exista esa pantalla.
- **Proveedor.** Convex. El proveedor de correo o push sigue pendiente.

### `appointmentAuditEvents`

- **Datos personales.** `action`, `actorId`, `appointmentId`, `result` y `occurredAt`. Identifica quién hizo un cambio de agenda, sobre qué atención y con qué resultado.
- **Finalidad.** Mantener una bitácora append-only de los cambios de agenda para rendir cuentas sin copiar motivos, notas ni necesidades.
- **Base propuesta.** Rendición de cuentas y seguridad. Pendiente de aprobación.
- **Acceso por rol.** No hay lectura pública, ni siquiera para el Administrador. Solo la infraestructura de auditoría escribe y pagina. No existe entrada para editar ni borrar.
- **Proveedor.** Convex.

### `followUpRecords`

- **Datos personales.** `appointmentId`, `authorId`, `nextSteps`, `suggestedNextAppointmentDate`, `internalNoteId`, `version` y `updatedAt`. `nextSteps` es texto libre y puede mencionar necesidades de acceso.
- **Finalidad.** Registrar el seguimiento posterior a una atención con los próximos pasos y la fecha sugerida. Los acuerdos y las tareas viven en sus propias tablas.
- **Base propuesta.** Relación de acompañamiento. Si el texto libre contiene datos sensibles, consentimiento expreso o la excepción legal que corresponda. Pendiente de aprobación.
- **Acceso por rol.** El Estudiante dueño lee la vista compartida, sin nota interna. El Profesional asignado lee la vista completa con nota interna. El Practicante asignado lee la vista minimizada, sin textos libres ni el vínculo con el acompañamiento. El Administrador está denegado.
- **Proveedor.** Convex.

### `followUpAgreements`

- **Datos personales.** `recordId`, `entryId` y `description`. `description` es texto libre y puede contener datos personales o sensibles.
- **Finalidad.** Guardar los acuerdos de un registro de seguimiento como filas propias.
- **Base propuesta.** Relación de acompañamiento, con la misma salvedad sobre datos sensibles que `followUpRecords`. Pendiente de aprobación.
- **Acceso por rol.** Se leen a través de `followUpRecords`: el Estudiante dueño y el Profesional asignado ven los acuerdos; el Practicante no los recibe en su vista minimizada; el Administrador está denegado.
- **Proveedor.** Convex.

### `followUpTasks`

- **Datos personales.** `recordId`, `entryId`, `description`, `responsible` y `status`. `description` es texto libre. `responsible` distingue estudiante, profesional o CERETI, sin guardar una identidad adicional.
- **Finalidad.** Guardar las tareas de un registro de seguimiento con su responsable y estado operativo.
- **Base propuesta.** Relación de acompañamiento, con la misma salvedad sobre datos sensibles que `followUpRecords`. Pendiente de aprobación.
- **Acceso por rol.** Se leen a través de `followUpRecords`: el Estudiante dueño y el Profesional asignado ven las tareas; el Practicante no las recibe en su vista minimizada; el Administrador está denegado.
- **Proveedor.** Convex.

## Tablas del componente de autenticación

Better Auth administra estas tablas dentro del componente `betterAuth` de Convex. No están en `convex/schema.ts`, pero contienen datos personales reales cuando una persona inicia sesión con su cuenta institucional.

| Tabla          | Datos personales                                                              | Finalidad                                   | Acceso                                                   |
| -------------- | ----------------------------------------------------------------------------- | ------------------------------------------- | -------------------------------------------------------- |
| `user`         | `name`, `email`, `emailVerified`, `image`, fechas de creación y actualización | Identidad de la cuenta autenticada          | Backend de autenticación; el titular ve su sesión        |
| `session`      | `userId`, token de sesión, `expiresAt`, `ipAddress`, `userAgent` y fechas     | Mantener la sesión y proteger el acceso     | Backend de autenticación; no se expone a otros roles     |
| `account`      | `userId`, `providerId`, `accountId`, tokens OAuth, alcances y fechas          | Vincular Google Workspace y Google Calendar | Backend de autenticación; los tokens se guardan cifrados |
| `verification` | `identifier`, `value` y `expiresAt`                                           | Verificaciones temporales del proveedor     | Backend de autenticación                                 |

La base propuesta para estas tablas es la autenticación y la seguridad de la cuenta. La vinculación con Google Calendar usa un consentimiento OAuth separado que solo pide `calendar.events`. La revisión de la base jurídica definitiva sigue pendiente.

## Datos personales reales en las cuentas de prueba

El prototipo distingue los datos ficticios de los datos reales de quienes prueban. La separación no elimina todas las obligaciones: una cuenta de prueba con una identidad real sigue siendo un dato personal.

| Origen                                         | Datos                                                                                                              | ¿Son reales?                                      | Observación                                                                                                                                   |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Dataset ficticio (`operations/fictitiousData`) | Nombres como «Estudiante Ficticio Uno», correos `@alu.uct.cl` y un `tokenIdentifier` con emisor `dataset-ficticio` | No, por diseño. El emisor impide iniciar sesión   | Los correos usan el dominio institucional y podrían coincidir con una dirección real. Verificar que no existan o usar direcciones reservadas. |
| Cuentas de integrantes que prueban             | `fullName`, `email`, `tokenIdentifier`, rol, estado de cuenta, sesiones con IP y agente de usuario                 | Sí. Son personas reales y su cuenta institucional | Es el dato personal más expuesto del entorno de prueba. No reutilizar cuentas de estudiantes reales para demostraciones.                      |
| Vinculación con Google Calendar                | Identificador de la cuenta de Google, tokens OAuth cifrados, alcance `calendar.events` y referencia del evento     | Sí, si la persona conecta su cuenta real          | Los tokens se guardan cifrados y no se devuelven al cliente. La persona puede revocar el acceso desde Google.                                 |
| Evidencia de pruebas en `docs/evidence`        | Correos e identificadores que la guía pide registrar en el acta                                                    | Sí, si se usan cuentas reales                     | Usar alias o identificadores internos. No guardar contraseñas, tokens ni enlaces privados en la evidencia.                                    |
| Registros de Convex, Vercel y GitHub           | IP, agente de usuario, correo, fecha y errores de las peticiones                                                   | Sí, según lo que cada proveedor registre          | La retención y el acceso a estos registros aún no tienen política aprobada.                                                                   |
| Entornos locales de desarrollo                 | Datos de las tablas y de las sesiones del entorno local                                                            | Sí, cuando se inicia sesión con una cuenta real   | Mantener los entornos separados y no exportar la base de desarrollo a producción.                                                             |

El nombre y el correo de una cuenta de prueba son datos personales aunque la cuenta se use solo para demostrar el flujo. La recomendación es usar un alias en las demostraciones, exponer el correo solo cuando sea imprescindible y no publicar capturas con nombres reales.

## Flujo de datos

1. Google Workspace entrega nombre, correo y un identificador estable al iniciar sesión. Better Auth guarda la cuenta y la sesión; `users` guarda el perfil y el rol.
2. La persona envía una solicitud. `requests` guarda el contenido y `requestTransitions` registra cada cambio de estado. Un Profesional la toma y `requestAssignments` deja la toma activa.
3. La aceptación abre `accompaniments`. `accompanimentAssignments` decide qué profesionales y practicantes acceden.
4. La agenda usa `availabilityBlocks`, `availabilityExceptions`, `spaces` y `appointments`. `appointmentProfessionals` registra a los participantes y `notificationEvents` los avisos.
5. Después de la atención, `followUpRecords`, `followUpAgreements`, `followUpTasks` y `followUpNotes` guardan el seguimiento.
6. `appointmentAuditEvents` y `requestTransitions` conservan la trazabilidad. La futura consulta de derechos deberá usar el mismo conjunto de datos para responder al titular; su persistencia y su pantalla siguen pendientes.

## Consentimiento

Hoy no existe una tabla de consentimientos en `convex/schema.ts`. El inicio de sesión con Google no es consentimiento para tratar datos personales: es la autenticación institucional. Leer el aviso de privacidad tampoco es una autorización general. La vinculación con Google Calendar es un consentimiento OAuth limitado a `calendar.events`, no una autorización para el resto del sistema.

Si la UCT decide que el consentimiento es la base para una finalidad, la propuesta de TI2 es esta:

- Pedirlo antes de recoger el dato, con una acción separada y sin opciones marcadas por defecto. No se mezcla con el inicio de sesión ni con la lectura del aviso.
- Explicar la finalidad concreta, los datos que se piden, el carácter obligatorio u opcional, la versión del aviso y el efecto de negarse.
- Guardar evidencia de la versión, la fecha, el alcance y la persona que consintió. Esa tabla no existe todavía y su implementación requiere una issue aparte.
- Permitir la revocación por el mismo canal o mediante una solicitud de privacidad. La revocación no afecta la licitud del tratamiento anterior y puede impedir que el servicio continúe si el dato es esencial.
- Tratar las necesidades de acceso, la justificación de inasistencia y cualquier dato de salud como sensibles. Si se usa consentimiento, debe ser expreso y separado.
- Resolver aparte el consentimiento de menores de edad. La UCT debe definir si el servicio atiende menores y qué procedimiento aplica.

La revocación del consentimiento no borra automáticamente los registros de auditoría ni los datos que una obligación legal obligue a conservar. Esa excepción debe explicarse en la respuesta a la solicitud.

Si un dato sensible es indispensable para prestar el acompañamiento, la UCT debe revisar si el consentimiento es realmente libre o si corresponde otra base legal. Presentarlo como una casilla obligatoria no resuelve ese problema.

## Proveedores y transferencias

| Proveedor             | Servicio                                             | Datos que trata                                                                                        | País                                                                           | Contrato o garantía                                            | Estado            |
| --------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ | -------------------------------------------------------------- | ----------------- |
| Convex, Inc.          | Backend, base de datos, autenticación y auditoría    | Todas las tablas de `convex/schema.ts`, las tablas de Better Auth y las sesiones                       | No consta en el repositorio                                                    | Pendiente de contrato, subencargados y ubicación               | Activo            |
| Vercel Inc.           | Hosting de la aplicación web y red de entrega        | Contenido estático y registros de peticiones, como IP y agente de usuario                              | No consta en el repositorio                                                    | Pendiente de contrato, subencargados y ubicación               | Activo            |
| Google LLC            | Google Workspace, inicio de sesión y Google Calendar | Identidad institucional que administra Google; evento genérico de Calendar y token OAuth si se conecta | No consta; Google puede procesar en Estados Unidos y otras regiones; confirmar | Pendiente de contrato y garantías de transferencia             | Activo            |
| Expo (650 Industries) | Compilación y distribución de la aplicación móvil    | Metadatos del proyecto y del build; no recibe la base de datos de producción                           | No consta en el repositorio                                                    | Pendiente de contrato y ubicación                              | Previsto          |
| GitHub, Inc.          | Repositorio, revisión y CI                           | Código, pull requests, registros de CI y evidencia de pruebas                                          | Estados Unidos, según la cuenta de GitHub; confirmar                           | Términos de GitHub; revisar si basta un acuerdo de tratamiento | Activo            |
| Proveedor de correo   | Envío de correo institucional                        | No implementado                                                                                        | No definido                                                                    | No existe                                                      | Pendiente         |
| Proveedor de push     | Notificaciones push                                  | No implementado                                                                                        | No definido                                                                    | No existe                                                      | Pendiente         |
| Servicio de voz       | Reconocimiento de voz de la aplicación móvil         | Audio o texto de los comandos, según el servicio del sistema                                           | Google en Android o Apple en iOS, según el sistema; confirmar                  | Pendiente de verificar si el audio sale del dispositivo        | Activo y opcional |

Ningún contrato de encargado está firmado ni documentado en este repositorio. Esta tabla es un inventario para la revisión institucional, no una autorización para transferir datos. La UCT debe confirmar países, subencargados, garantías, retorno y eliminación antes de usar datos reales.

El reconocimiento de voz es una función de accesibilidad de la aplicación móvil. CERETI no almacena el audio en su base de datos. En Android la aplicación declara el servicio de voz de Google (`com.google.android.googlequicksearchbox`); en iOS usa el servicio del sistema. Si el sistema operativo envía el audio a un servicio externo, esa transferencia debe quedar cubierta por el proveedor correspondiente y por el aviso.

## Conservación

No hay un plazo de conservación aprobado. El ADR [Configurar la conservación de los datos](adr/0003-conservacion-configurable-de-datos.md) deja la duración en manos de la UCT y el prototipo no ejecuta eliminación ni anonimización automática.

Mientras no exista esa decisión, el comportamiento técnico es este:

- Los datos del acompañamiento se mantienen mientras el acompañamiento está activo y después de su cierre, porque el historial se conserva en solo lectura.
- Las solicitudes, sus transiciones y las atenciones anteriores no se borran al cerrar el acompañamiento.
- Las tablas de auditoría son append-only y no tienen borrado desde la aplicación.
- Las sesiones expiran o se revocan, pero los registros de autenticación pueden permanecer mientras el proveedor los conserve.
- Los eventos de Google Calendar viven en la cuenta de Google de la persona. Borrarlos allí no borra la atención en CERETI.
- Una obligación legal o una solicitud de privacidad abierta puede suspender una eliminación futura.

La UCT debe fijar plazos por categoría, el procedimiento de eliminación o anonimización y las excepciones que suspenden el borrado.

## Derechos y reclamaciones

El procedimiento de prueba reconoce acceso, rectificación, supresión, oposición, bloqueo y portabilidad. Los plazos, estados y la respuesta fundada están en [Procedimiento de prueba para solicitudes de privacidad](privacidad-procedimiento.md). La implementación persistente corresponde a TI2-151 y las pantallas a las issues que las autoricen.

El canal del Estudiante será la aplicación cuando exista la pantalla. Los demás roles usan un canal institucional cuya dirección sigue pendiente. La UCT debe designar al responsable institucional de privacidad y su reemplazo. La respuesta denegada debe informar del reclamo ante la Agencia de Protección de Datos Personales, con el texto jurídico pendiente de validación.

## Aprobaciones pendientes

| Decisión pendiente                                                  | Por qué bloquea el uso real                                                                 | Quién debe resolverla           |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------- |
| Base jurídica de cada finalidad, incluida la de los datos sensibles | Sin base aprobada no se puede tratar el dato ni sostener una respuesta fundada              | UCT y revisión jurídica         |
| Necesidad y alcance del consentimiento                              | Define si se pide, cómo se registra y cómo se revoca                                        | UCT, revisión jurídica y TI2    |
| Contratos con proveedores y subencargados                           | Fija instrucciones, acceso, retorno y eliminación                                           | UCT                             |
| Países de los proveedores y garantías de transferencia              | Determina si hay transferencia internacional y qué resguardo corresponde                    | UCT y TI2                       |
| Procedimiento para estudiantes menores de edad                      | Cambia el consentimiento y las reglas de datos sensibles de menores de dieciséis años       | UCT y revisión jurídica         |
| Plazo de conservación y reglas de eliminación o anonimización       | Sin plazo no hay política de retención ni borrado verificable                               | UCT                             |
| Evaluación de impacto                                               | La naturaleza sensible de los datos hace prudente evaluarla, aunque la UCT debe decidirlo   | UCT                             |
| Excepciones para datos sensibles                                    | La regla general exige consentimiento expreso salvo excepciones legales                     | UCT y revisión jurídica         |
| Responsable institucional, contacto y canal para ejercer derechos   | Sin contacto no se puede cumplir la transparencia ni recibir solicitudes de los demás roles | UCT                             |
| Revisión del aviso antes de publicarlo                              | El texto tiene marcadores pendientes y no puede presentarse como política aprobada          | UCT, CERETI y revisión jurídica |
| Tratamiento de las cuentas de prueba con identidad real             | Define alias, evidencia y acceso para no exponer nombres ni correos de personas reales      | TI2 y UCT                       |

## Mantenimiento

Este inventario se actualiza cuando cambia una tabla, un campo personal, una base propuesta, un acceso por rol o un proveedor. El cambio debe indicar la fecha y la issue que lo origina. Si una tabla nueva contiene datos personales y no aparece acá, el inventario está incompleto y no debe usarse como evidencia de cierre.

Las decisiones de este documento no reemplazan la aprobación institucional. La fuente de verdad del producto sigue en `CONTEXT.md`, `DESIGN.md`, `docs/` y los ADR; la issue vigente en Linear manda sobre el alcance operativo.
