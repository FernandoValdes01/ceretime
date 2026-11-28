# Contrato Sprint 3 — Registro de seguimiento (TI2-146)

Superficie pública versionada para que el Profesional guarde y confirme el seguimiento de una atención, y para que cada rol lea el registro de una atención o el historial de un acompañamiento con su vista. Todo lo que Web y Mobile consumen sale de `api.presentation.follow_up` y de los tipos generados en `convex/_generated`. La forma del registro es la de TI2-106, la persistencia la de TI2-118 y las vistas por rol las de TI2-127 (`convex/domain/authorization/permissions-matrix.md`). Opera con datos ficticios.

## Operaciones públicas

| Operación                                                         | Argumentos                                                                                                             | Devuelve                                                                            | Quién                                                                                   | Denegación                                                                                                                                                      |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `presentation.follow_up.saveFollowUpRecord` (mutation)            | `appointmentId`, `agreements`, `tasks`, `nextSteps`, `suggestedNextAppointmentDate?`, `internalNote?`, `version: "v1"` | `{appointmentId}`                                                                   | Profesional con asignación activa, cuenta vigente y el acompañamiento `active`          | `unauthorized` sin permiso o con una atención ajena, inexistente o de otra tabla; `follow_up_fields_invalid` con datos inválidos; `conflict` con una atención que no admite seguimiento o un registro ya confirmado con otro contenido |
| `presentation.follow_up.getFollowUpRecord` (query)                | `appointmentId`, `version: "v1"`                                                                                       | La proyección de la vista del rol, o `null` si la atención aún no tiene seguimiento | Estudiante dueño, Profesional con asignación activa y Practicante con asignación activa | `unauthorized` para el Administrador, sin sesión o con una atención ajena, inexistente o de otra tabla                                                          |
| `presentation.follow_up.listAccompanimentFollowUpRecords` (query) | `accompanimentId`, `limit`, `cursor?`, `version: "v1"`                                                                 | `{items, hasMore, nextCursor, version}` con la vista del rol en cada elemento       | Los mismos roles que la lectura por atención                                            | `unauthorized` igual que la lectura por atención; `conflict` con un `limit` fuera de 1 a 20 o un `cursor` que Convex rechaza                                                                     |

No hay operaciones de edición, reemplazo ni eliminación: el primer guardado confirma el registro y desde ese momento ningún rol puede cambiarlo.

## Entrada del guardado

- `agreements`: hasta 20 objetos `{description}`.
- `tasks`: hasta 20 objetos `{description, responsible, status}`. `responsible` es `"student"`, `"professional"` o `"cereti"`; `status` es `"pending"`, `"in_progress"`, `"done"` o `"cancelled"`.
- `nextSteps`: obligatorio.
- `suggestedNextAppointmentDate`: opcional, fecha civil `AAAA-MM-DD` válida.
- `internalNote`: opcional. Para no guardar nota se omite la clave; una nota vacía se rechaza.
- Cada texto, incluida la nota, se recorta y admite de 1 a 500 caracteres.
- Acuerdos y tareas no llevan identificador, porque ACUERDOS_SEGUIMIENTO y TAREAS_SEGUIMIENTO del MER no tienen uno del cliente (TI2-165). Los distingue su posición: se guardan y se leen en el orden en que se enviaron.
- El cliente no envía el acompañamiento, el autor ni el estado de la atención: el servidor los toma de la atención y de la sesión. Un campo de más, otra versión o un valor fuera de las listas anteriores falla con el error de validador de Convex antes de llegar al caso de uso.

## Reglas

- Versión del contrato: `"v1"` (`FOLLOW_UP_CONTRACT_VERSION`), obligatoria en las tres operaciones.
- Solo admiten seguimiento las atenciones `completed`, `no_show`, `no_show_justified` y `no_show_unjustified`. Una atención agendada, reagendada o cancelada responde `conflict`.
- Guardar es confirmar. Repetir el guardado con el mismo contenido, aunque cambien los espacios que se recortan, responde el mismo `{appointmentId}` sin escribir. Cualquier diferencia en acuerdos, tareas (descripción, responsable, estado u orden), próximos pasos, fecha sugerida o nota responde `conflict` con `"El seguimiento de esta atención ya está confirmado y no se puede cambiar."` y no escribe, también si el contenido nuevo es inválido. Por eso el estado de una tarea tampoco cambia después de confirmar.
- Guardados simultáneos de la misma atención dejan un solo registro: Convex reintenta el que pierde y ese reintento ya encuentra el registro confirmado.
- Cada registro pertenece a su atención y, por ella, a su acompañamiento. Un Profesional asignado a otro acompañamiento recibe `unauthorized` al guardar o leer esa atención.
- Un acompañamiento cerrado o en pausa no admite guardar, pero su historial se sigue leyendo con la vista de cada rol. Los estados y sus cambios están en «Estado del acompañamiento y cambio de profesionales».
- La nota interna se guarda solo en `followUpNotes`, la única tabla de notas. Solo la vista `professional` la incluye, y solo si la nota pertenece al mismo acompañamiento del registro.
- El seguimiento no admite contenido clínico: un texto con la etiqueta `Diagnóstico:` o con el nombre de un documento clínico (por ejemplo, «informe psicológico», «evaluación psicológica», «CIE-10» o «DSM-5») responde `follow_up_fields_invalid`.

## Vistas y claves exactas

Los validadores de salida fijan estas claves: si una proyección trajera otra clave, la respuesta falla en vez de entregarla. Las claves opcionales solo aparecen cuando el registro tiene ese dato.

| Vista          | Quién la recibe                     | Claves                                                                                                                                                           |
| -------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `professional` | Profesional con asignación activa   | `appointmentId`, `accompanimentId`, `appointmentStatus`, `appointmentStartsAt`, `agreements`, `tasks`, `nextSteps`, `suggestedNextAppointmentDate?`, `internalNote?`, `version`, `view` |
| `shared`       | Estudiante dueño del acompañamiento | Las mismas sin `internalNote`                                                                                                                                    |
| `minimized`    | Practicante con asignación activa   | `appointmentId`, `appointmentStatus`, `appointmentStartsAt`, `agreements`, `tasks`, `nextSteps`, `suggestedNextAppointmentDate?`, `version`, `view`                                       |

`appointmentStatus` es el estado vigente de la atención y `appointmentStartsAt`, su inicio en milisegundos desde la época (el atributo `inicio` de ATENCIONES en el MER), ambos leídos de la atención al responder; el seguimiento no guarda una copia. `appointmentStartsAt` se agregó en TI2-166 para que los clientes distingan cada registro del historial por la fecha de su atención; es obligatorio en las tres vistas, y un cliente que no lo use puede ignorarlo. Decisión del 2026-11-15 (TI2-186): gana el diagrama, así que la vista `minimized` incluye acuerdos, tareas y próximos pasos con la misma forma que la vista `shared`. Esto reemplaza, solo para el seguimiento, la minimización de TI2-127, que los omitía porque esos textos pueden mencionar necesidades de acceso. La vista `minimized` mantiene fuera la nota interna y el vínculo con el acompañamiento, que el diagrama no asigna al practicante.

```json
{
  "appointmentId": "k57abc...",
  "accompanimentId": "j97def...",
  "appointmentStatus": "completed",
  "appointmentStartsAt": 1794841200000,
  "agreements": [{ "description": "Recibir los apuntes en formato digital" }],
  "tasks": [
    {
      "description": "Enviar los apuntes de la semana",
      "responsible": "professional",
      "status": "pending"
    }
  ],
  "nextSteps": "Revisar el avance en la próxima atención",
  "suggestedNextAppointmentDate": "2026-11-23",
  "version": "v1",
  "view": "shared"
}
```

## Historial por acompañamiento

El historial recorre las atenciones del acompañamiento pedido, de la que empieza más tarde a la que empieza antes, y entrega las que tienen registro. `limit` cuenta atenciones, no registros: una página puede traer menos elementos que `limit`, incluso ninguno, y aun así tener `hasMore: true`. Para seguir, se envía el `nextCursor` recibido sin modificarlo; cuando llega `null`, no hay más páginas. Un cursor que Convex rechaza, por ejemplo uno alterado, responde `conflict`. Solo se recorren atenciones de ese acompañamiento, así que el historial no mezcla acompañamientos.

## Errores

Los errores usan el contrato común de TI2-88 (`ConvexError({ code, message })`): los clientes distinguen por `error.data.code`, nunca por el texto.

- `unauthorized` (`"No autorizado"`): sin sesión, perfil o vigencia, rol sin permiso, asignación revocada, acompañamiento que no admite guardar, o atención o acompañamiento ajeno, inexistente o de otra tabla. No revela si el recurso existe.
- `conflict` con `"La atención todavía no admite seguimiento: debe estar realizada o con la inasistencia registrada."` cuando la atención no está realizada ni tiene la inasistencia registrada. Depende del estado de la atención, así que se responde solo ese motivo aunque los campos también fallen.
- `follow_up_fields_invalid` con el mensaje de lo que hay que corregir en el formulario. Si hay varias causas, los mensajes se unen con un espacio en este orden:

| Causa                                        | Mensaje                                                                                                          |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Texto vacío, incluida una nota enviada vacía | `"Hay textos vacíos: completa los acuerdos, las tareas, los próximos pasos y, si la incluyes, la nota interna."` |
| Texto largo                                  | `"Cada texto admite hasta 500 caracteres."`                                                                      |
| Demasiadas entradas                          | `"Se admiten hasta 20 acuerdos y 20 tareas."`                                                                    |
| Fecha inválida                               | `"La fecha sugerida debe ser una fecha válida con formato AAAA-MM-DD."`                                          |
| Contenido clínico                            | `"El seguimiento no admite diagnósticos, evaluaciones psicológicas ni documentos clínicos."`                     |

- `conflict` con `"El seguimiento de esta atención ya está confirmado y no se puede cambiar."` cuando el registro ya existe con otro contenido.
- `conflict` con el mensaje genérico (`"La solicitud entra en conflicto con el estado actual."`) cuando `limit` no es un entero entre 1 y 20, que se rechaza antes de leer, o cuando Convex rechaza el `cursor` (por ejemplo, porque está alterado). Ante ese segundo caso, el cliente vuelve a pedir el historial sin `cursor`. Cualquier otro error al leer el historial llega como error interno («Server Error»), no como `conflict`, así que el cliente no reinicia en ciclo.

## Ejemplos para Web y Mobile

```ts
import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { api } from "./_generated/api";

const saveFollowUp = useMutation(api.presentation.follow_up.saveFollowUpRecord);

try {
  await saveFollowUp({
    appointmentId,
    agreements: [{ description: "Recibir los apuntes en formato digital" }],
    tasks: [
      {
        description: "Enviar los apuntes",
        responsible: "professional",
        status: "pending",
      },
    ],
    nextSteps: "Revisar el avance en la próxima atención",
    version: "v1",
  });
} catch (error) {
  muestraMensaje(mensajeDeError(error));
}

const MENSAJE_POR_DEFECTO = "No pudimos completar la acción. Intenta de nuevo.";
const MENSAJE_SIN_ACCESO = "No tienes acceso a este seguimiento.";

// Distingue por código estable. Lo que no es un código conocido, incluido el
// «Server Error» de producción, usa el mensaje genérico: nunca se muestra el
// texto del SDK.
function mensajeDeError(error: unknown): string {
  if (!(error instanceof ConvexError)) return MENSAJE_POR_DEFECTO;
  const data: unknown = error.data;
  if (typeof data !== "object" || data === null || !("code" in data)) return MENSAJE_POR_DEFECTO;
  const message = "message" in data && typeof data.message === "string" ? data.message : null;
  switch (data.code) {
    case "unauthorized":
      return MENSAJE_SIN_ACCESO;
    case "follow_up_fields_invalid":
    case "conflict":
      return message ?? MENSAJE_POR_DEFECTO;
    default:
      return MENSAJE_POR_DEFECTO;
  }
}

const followUp = useQuery(api.presentation.follow_up.getFollowUpRecord, {
  appointmentId,
  version: "v1",
});

const history = useQuery(api.presentation.follow_up.listAccompanimentFollowUpRecords, {
  accompanimentId,
  limit: 10,
  ...(cursor === null ? {} : { cursor }),
  version: "v1",
});
```

## Estado del acompañamiento y cambio de profesionales — TI2-152

Superficie pública para que el Profesional pause, reactive y cierre un acompañamiento. Vive en `api.presentation.accompaniments`, junto a las lecturas del acompañamiento, y no lleva `version` porque ese módulo no la usa.

### Operaciones públicas

| Operación | Argumentos | Devuelve | Quién | Denegación |
| --- | --- | --- | --- | --- |
| `presentation.accompaniments.pauseAccompaniment` (mutation) | `accompanimentId` | `{accompanimentId, status: "paused"}` | Profesional con asignación activa y cuenta vigente | `unauthorized` sin permiso o con un acompañamiento ajeno o inexistente; `conflict` si no está `active` |
| `presentation.accompaniments.reactivateAccompaniment` (mutation) | `accompanimentId` | `{accompanimentId, status: "active"}` | El mismo | `unauthorized` igual; `conflict` si no está `paused` |
| `presentation.accompaniments.getAccompanimentClosurePreview` (query) | `accompanimentId` | `{appointmentsToCancel, unrecordedAppointments}` | El mismo | `unauthorized` igual; `conflict` si ya está `closed` |
| `presentation.accompaniments.closeAccompaniment` (mutation) | `accompanimentId`, `reason?` | `{accompanimentId, status: "closed", cancelledAppointments}` | El mismo | `unauthorized` igual; `conflict` si ya está `closed`, si `unrecordedAppointments` no es cero o si el motivo supera 500 caracteres |
| `presentation.accompaniments.updateAccompanimentNeeds` (mutation, TI2-156) | `accompanimentId`, `accessNeeds` (texto no vacío, máx 2000) | `null` | Solo Estudiante dueño con cuenta vigente, acompañamiento `active` o `paused` | `unauthorized` sin permiso o con acompañamiento ajeno/inexistente; `conflict` si está `closed`, si el texto está vacío o supera el tope, o si la lectura de futuras se trunca (sin escribir) |

Estudiante, Practicante y Administrador reciben `unauthorized` en las cuatro. Solo el cierre recibe motivo, y es opcional: se recorta, y uno en blanco equivale a no enviarlo. Pausar y reactivar no lo reciben, porque el MER no lo guarda. Los `conflict` de estas operaciones traen el mensaje genérico.

### Necesidades de acceso versionadas (TI2-156)

`updateAccompanimentNeeds` versiona en `accompanimentNeeds` (NECESIDADES_ACCESO del MER, `validFrom`/`validUntil?`): cierra la vigente con `validUntil` y crea la nueva con `validFrom` en el instante del cambio, además de la copia en `accompaniments.accessNeeds`. Las atenciones se evalúan con la versión vigente a su `startsAt`, así las anteriores conservan lo que regía y no se reescriben. Compara antes/después en la misma mutación y avisa `appointment_needs_updated` solo a los profesionales de las futuras que pasan de compatibles a incompatibles, sin cancelar. Si la lectura de futuras se trunca, responde `conflict` sin escribir. La migración `auditAccompanimentNeeds`/`migrateAccompanimentNeeds` crea la primera versión (`validFrom: 1`) de los acompañamientos sin versiones.

**Formato que envían los clientes (TI2-166).** `accessNeeds` es texto, pero los clientes lo arman con el formato estructurado de TI2-135: las opciones de `ACCESS_NEED_OPTIONS` elegidas y una necesidad libre aparte (`otherAccessNeed`), convertidas con `toStoredAccessNeeds` del dominio, que deja una línea por opción en el orden de la lista y la necesidad libre al final. Es la misma regla que arma el texto del acompañamiento al aceptar una solicitud. Para editar lo vigente, la Web hace el camino inverso: cada línea igual a la etiqueta de una opción la marca, y las demás forman la necesidad libre. Mobile debe usar la misma función para que las dos superficies guarden lo mismo.

### Estados que llegan a las lecturas

`getAccompaniment`, `listOwnedAccompaniments` y `listAssignedAccompaniments` entregan `status` con uno de estos tres valores, sin otros:

| `status` | Significado | Operar sobre sus atenciones | Leer |
| --- | --- | --- | --- |
| `active` | En curso | Sí | Sí |
| `paused` | En pausa; vuelve a `active` al reactivarse | No: `unauthorized` | Sí |
| `closed` | Cerrado; es definitivo | No: `unauthorized` | Sí, de solo lectura |

Operar sobre las atenciones es reservar, cancelar, cambiar el horario, registrar la realización o inasistencia, leer o cambiar el enlace en línea, justificar una inasistencia y guardar el seguimiento. Todo eso exige un acompañamiento activo, como el caso de uso «Reservar cupo individual (acompañamiento activo)» del diagrama.

Los cambios válidos son `active → paused`, `paused → active`, `active → closed` y `paused → closed`. Un acompañamiento cerrado no se reabre: una necesidad posterior comienza con una solicitud nueva. Los clientes deben tratar `status` como un conjunto cerrado de estos tres valores.

Desde TI4-84, `listOwnedAccompaniments` acepta `status` opcional con uno de esos tres valores. Con él, el índice `accompaniments.by_student_and_status` filtra antes de paginar, así un Estudiante con muchos acompañamientos cerrados recibe el activo en la primera página; Horarios lo usa con `status: "active"`. Sin `status` el listado no cambia, así que Mobile no se ve afectado.

### Decisión sobre las reservas futuras (08/11/2026, pausa actualizada el 19/11/2026)

La regla de la pausa es la del 19/11/2026 (TI2-165) y reemplaza a la del 08/11/2026, que permitía cancelar una atención, registrar su resultado y usar el enlace en línea durante la pausa. La del cierre sigue siendo la del 08/11/2026.

- **Pausar** mantiene las atenciones existentes sin cancelarlas, pero mientras dure la pausa ninguna operación sobre ellas procede y todas responden `unauthorized`. Al reactivarse, vuelven a estar disponibles.
- **Cerrar** cancela todas las atenciones futuras del acompañamiento como `cancelled_by_cereti`, también las que están a cargo de otro profesional, y libera cada cupo. Quien cierra queda como actor de cada cancelación. El acompañamiento cerrado no conserva atenciones vigentes.
- Antes de confirmar, la pantalla consulta `getAccompanimentClosurePreview` y muestra `appointmentsToCancel`. La cifra es informativa y no se actualiza sola con el paso del tiempo; `closeAccompaniment` vuelve a leer y devuelve la cifra real en `cancelledAppointments`.
- Una atención agendada cuya hora ya pasó no se cancela, porque diría que no ocurrió. Mientras exista alguna, `unrecordedAppointments` es mayor que cero y el cierre responde `conflict` sin guardar nada: primero se registra su realización o inasistencia, lo que exige un acompañamiento activo: desde la pausa se reactiva, se registra y después se cierra.
- Cada cancelación del cierre usa el mismo camino que la cancelación individual (`cancelAuthorizedAppointment` en `convex/application/appointments/changes.ts`): la misma política de estados, la misma escritura y el mismo evento de auditoría. Las atenciones canceladas por el cierre reciben el motivo fijo «Cierre del acompañamiento»; el motivo opcional del cierre no se copia a ellas.
- Desde TI2-150, cada cancelación del cierre deja el aviso `appointment_cancelled` a los participantes salvo quien cierra, por el mismo camino que la cancelación individual. Límite actual: la cancelación todavía no modifica el evento de Google Calendar, ni en la individual ni en el cierre.
- El cierre revisa hasta 500 atenciones del acompañamiento. Si hay más, responde `conflict` en vez de cerrar con atenciones sin revisar.

### Datos del cierre

El cierre guarda en el propio acompañamiento quién cerró (`closedById`), cuándo (`closedAt`, con el reloj del servidor) y el motivo si se entregó (`closureReason`), como `cerradoPorId?`, `cerradoEn?` y `motivoCierre?` de ACOMPAÑAMIENTOS en el MER. Pausar y reactivar solo cambian `status`: no queda registro de quién ni cuándo, porque el MER no lo modela. Ninguna lectura pública entrega estos tres campos y el motivo no se copia a la bitácora de auditoría.

### Cambio de profesionales

El cambio se hace con `assignAccompanimentAccess` y `revokeAccompanimentAccess` de TI2-140 (`docs/contratos-sprint-3/cuentas.md`), que ya registran quién concede o retira y cuándo. Para elegir a quién, TI2-165 agrega una lectura:

| Operación | Argumentos | Devuelve | Quién | Denegación |
| --- | --- | --- | --- | --- |
| `presentation.accompaniments.listAccompanimentProfessionals` (query) | `accompanimentId` | `{assigned, assignable, assignableComplete}` | Profesional de personal, habilitado y vigente, con asignación profesional activa sobre ese acompañamiento | `unauthorized` sin ese permiso, sin revelar si el acompañamiento existe; `conflict` si el acompañamiento supera las 200 asignaciones leídas |

- `assigned`: los profesionales con asignación activa y vigente (ASIGNACIONES_PROFESIONALES del MER), cada uno con `userId`, `fullName`, `assignedAt?` (`asignadoEn`, falta en filas anteriores a TI2-140), `isCaller`, que marca la asignación de quien consulta, y `removable`, que dice si `revokeAccompanimentAccess` lo retiraría con la regla de abajo. Ordenados por nombre. La Web lo usa para no ofrecer un retiro que el Backend rechaza.
- `assignable`: los profesionales de personal habilitados y vigentes que todavía no están asignados, con `userId` y `fullName`, ordenados por nombre. No incluye cuentas de prueba, practicantes ni cuentas inhabilitadas.
- `assignableComplete`: `false` si había más de 100 perfiles profesionales y la lista de asignables no los revisó todos.
- No entrega correo ni estado de las cuentas.

TI2-152 agrega estas reglas al cambio:

- Quien se retira pierde el acceso en la consulta siguiente, porque cada lectura vuelve a exigir la asignación activa.
- Mientras el acompañamiento esté activo o en pausa, tiene que quedar alguien que lo gestione: un profesional de personal habilitado y vigente, con asignación vigente y sin fin acordado. Retirar a quien deja el acompañamiento sin nadie así responde `conflict`, porque asignar a otro y cerrar exigen una asignación profesional activa de personal. Una cuenta de prueba no cuenta, porque no concede ni retira, y una asignación con fin tampoco, porque deja de autorizar al vencer. Para reemplazar al último, primero se asigna al nuevo y después se retira al anterior. Un acompañamiento cerrado sí puede quedar sin asignaciones, que es el 0..* de ASIGNA en el MER (TI2-165).
- La asignación de un profesional de personal no lleva vigencia acordada, porque ASIGNACIONES_PROFESIONALES del MER no la tiene: `assignAccompanimentAccess` y `updateAccompanimentAccess` con `validFrom` o `validUntil` para uno responden `assignment_fields_invalid` sin escribir. Así el último tampoco sale empezando tarde o venciendo. Quitar una ventana guardada antes (`null`) sí procede. La cuenta de prueba y el Practicante la conservan (TI2-140).
- Un acompañamiento cerrado no admite conceder ni modificar accesos (`conflict`). Retirar un acceso sigue permitido.
- Retirar a un profesional no cancela ni reasigna sus atenciones futuras: siguen a su nombre y solo el Estudiante puede cancelarlas o cambiarles el horario, con el acompañamiento activo. El cierre sí las cancela.

### Cambio de practicantes — TI2-170

El cambio se hace con `assignAccompanimentAccess`, `updateAccompanimentAccess` y `revokeAccompanimentAccess` de TI2-140, con `assignedRole: "intern"`. El contrato completo de la gestión desde la Web del Profesional (habilitación, listado de practicantes y accesos por acompañamiento) vive en `docs/contratos-sprint-3/cuentas.md`, junto a TI2-140; acá solo queda el enlace para no duplicarlo. Quien se retira pierde el acceso en la consulta siguiente aunque conserve el enlace: la vista del practicante (TI2-116) reemplaza el contenido por el aviso de acceso denegado.

```ts
const preview = useQuery(api.presentation.accompaniments.getAccompanimentClosurePreview, {
  accompanimentId,
});
const closeAccompaniment = useMutation(api.presentation.accompaniments.closeAccompaniment);

// `preview.unrecordedAppointments > 0`: pedir que se registre el resultado antes de cerrar.
// `preview.appointmentsToCancel`: mostrarlo en la confirmación.
const { cancelledAppointments } = await closeAccompaniment({ accompanimentId });
```

## Fuera de este contrato

- Pantallas del Profesional y del Estudiante: TI2-165 y TI2-166.
- Auditoría de guardados y lecturas del seguimiento: TI2-176.
