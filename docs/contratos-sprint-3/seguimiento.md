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

- `agreements`: hasta 20 objetos `{id, description}`.
- `tasks`: hasta 20 objetos `{id, description, responsible, status}`. `responsible` es `"student"`, `"professional"` o `"cereti"`; `status` es `"pending"`, `"in_progress"`, `"done"` o `"cancelled"`.
- `nextSteps`: obligatorio.
- `suggestedNextAppointmentDate`: opcional, fecha civil `AAAA-MM-DD` válida.
- `internalNote`: opcional. Para no guardar nota se omite la clave; una nota vacía se rechaza.
- Cada texto, incluida la nota, se recorta y admite de 1 a 500 caracteres. Los `id` se recortan, son obligatorios y no se repiten dentro de los acuerdos ni dentro de las tareas.
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
| `professional` | Profesional con asignación activa   | `appointmentId`, `accompanimentId`, `appointmentStatus`, `agreements`, `tasks`, `nextSteps`, `suggestedNextAppointmentDate?`, `internalNote?`, `version`, `view` |
| `shared`       | Estudiante dueño del acompañamiento | Las mismas sin `internalNote`                                                                                                                                    |
| `minimized`    | Practicante con asignación activa   | `appointmentId`, `appointmentStatus`, `agreements`, `tasks`, `nextSteps`, `suggestedNextAppointmentDate?`, `version`, `view`                                       |

`appointmentStatus` es el estado vigente de la atención, leído al responder. Decisión del 2026-11-15 (TI2-186): gana el diagrama, así que la vista `minimized` incluye acuerdos, tareas y próximos pasos con la misma forma que la vista `shared`. Esto reemplaza, solo para el seguimiento, la minimización de TI2-127, que los omitía porque esos textos pueden mencionar necesidades de acceso. La vista `minimized` mantiene fuera la nota interna y el vínculo con el acompañamiento, que el diagrama no asigna al practicante.

```json
{
  "appointmentId": "k57abc...",
  "accompanimentId": "j97def...",
  "appointmentStatus": "completed",
  "agreements": [{ "id": "a1", "description": "Recibir los apuntes en formato digital" }],
  "tasks": [
    {
      "id": "t1",
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
| `id` vacío                                   | `"Cada acuerdo y cada tarea necesitan un identificador."`                                                        |
| `id` repetido                                | `"Hay acuerdos o tareas con el identificador repetido."`                                                         |
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
    agreements: [{ id: "a1", description: "Recibir los apuntes en formato digital" }],
    tasks: [
      {
        id: "t1",
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
| `presentation.accompaniments.pauseAccompaniment` (mutation) | `accompanimentId`, `reason?` | `{accompanimentId, status: "paused"}` | Profesional con asignación activa y cuenta vigente | `unauthorized` sin permiso o con un acompañamiento ajeno o inexistente; `conflict` si no está `active` o el motivo supera 500 caracteres |
| `presentation.accompaniments.reactivateAccompaniment` (mutation) | `accompanimentId`, `reason?` | `{accompanimentId, status: "active"}` | El mismo | `unauthorized` igual; `conflict` si no está `paused` o el motivo supera 500 caracteres |
| `presentation.accompaniments.getAccompanimentClosurePreview` (query) | `accompanimentId` | `{appointmentsToCancel, unrecordedAppointments}` | El mismo | `unauthorized` igual; `conflict` si ya está `closed` |
| `presentation.accompaniments.closeAccompaniment` (mutation) | `accompanimentId`, `reason?` | `{accompanimentId, status: "closed", cancelledAppointments}` | El mismo | `unauthorized` igual; `conflict` si ya está `closed`, si `unrecordedAppointments` no es cero o si el motivo supera 500 caracteres |

Estudiante, Practicante y Administrador reciben `unauthorized` en las cuatro. El motivo es opcional en todos los cambios: se recorta, y uno en blanco equivale a no enviarlo. Los `conflict` de estas operaciones traen el mensaje genérico.

### Estados que llegan a las lecturas

`getAccompaniment`, `listOwnedAccompaniments` y `listAssignedAccompaniments` entregan `status` con uno de estos tres valores, sin otros:

| `status` | Significado | Reservar y cambiar horario | Cancelar una atención | Registrar realización o inasistencia | Justificar y guardar seguimiento | Leer |
| --- | --- | --- | --- | --- | --- | --- |
| `active` | En curso | Sí | Estudiante dueño y Profesional a cargo | Profesional a cargo | Sí | Sí |
| `paused` | En pausa; vuelve a `active` al reactivarse | No: `unauthorized` | Estudiante dueño y Profesional a cargo | Profesional a cargo | No: `unauthorized` | Sí |
| `closed` | Cerrado; es definitivo | No: `unauthorized` | No: `unauthorized` | No: `unauthorized` | No: `unauthorized` | Sí, de solo lectura |

Los cambios válidos son `active → paused`, `paused → active`, `active → closed` y `paused → closed`. Un acompañamiento cerrado no se reabre: una necesidad posterior comienza con una solicitud nueva. Los clientes deben tratar `status` como un conjunto cerrado de estos tres valores.

### Decisión sobre las reservas futuras (08/11/2026)

- **Pausar** mantiene las atenciones existentes y solo rechaza las reservas nuevas y los cambios de horario. Mientras dure la pausa, el Estudiante dueño y el Profesional a cargo pueden cancelar una atención de forma individual con `presentation.appointments.cancelAppointment`, con las mismas reglas de motivo que fuera de la pausa, y el Profesional a cargo registra su realización o inasistencia con `presentation.appointments.recordAppointmentAttendance`. Justificar una inasistencia y guardar el seguimiento siguen exigiendo `active`.
- **Cerrar** cancela todas las atenciones futuras del acompañamiento como `cancelled_by_cereti`, también las que están a cargo de otro profesional, y libera cada cupo. Quien cierra queda como actor de cada cancelación. El acompañamiento cerrado no conserva atenciones vigentes.
- Antes de confirmar, la pantalla consulta `getAccompanimentClosurePreview` y muestra `appointmentsToCancel`. La cifra es informativa y no se actualiza sola con el paso del tiempo; `closeAccompaniment` vuelve a leer y devuelve la cifra real en `cancelledAppointments`.
- Una atención agendada cuya hora ya pasó no se cancela, porque diría que no ocurrió. Mientras exista alguna, `unrecordedAppointments` es mayor que cero y el cierre responde `conflict` sin guardar nada: primero se registra su realización o inasistencia, lo que también se puede hacer en pausa, así que `paused → closed` no exige reactivar.
- Cada cancelación del cierre usa el mismo camino que la cancelación individual (`cancelAuthorizedAppointment` en `convex/application/appointments/changes.ts`): la misma política de estados, la misma escritura y el mismo evento de auditoría. Las atenciones canceladas por el cierre reciben el motivo fijo «Cierre del acompañamiento»; el motivo opcional del cierre no se copia a ellas.
- Límite actual: la cancelación todavía no registra un aviso para el Estudiante ni modifica el evento de Google Calendar, ni en la individual ni en el cierre. Cuando TI2-150 emita el aviso de cancelación en ese camino, el cierre lo hereda sin cambios en esta superficie.
- El cierre revisa hasta 500 atenciones del acompañamiento. Si hay más, responde `conflict` en vez de cerrar con atenciones sin revisar.

### Historial de cambios de estado

Cada pausa, reactivación y cierre guarda una fila en `accompanimentTransitions` con el estado anterior, el nuevo, el actor de la sesión, el instante del servidor y el motivo si se entregó. La tabla solo se escribe, en la misma transacción del cambio. El motivo queda únicamente ahí: ninguna lectura pública lo entrega y no se copia a la bitácora de auditoría.

### Cambio de profesionales

No hay una operación nueva: el cambio se hace con `assignAccompanimentAccess` y `revokeAccompanimentAccess` de TI2-140 (`docs/contratos-sprint-3/cuentas.md`), que ya registran quién concede o retira y cuándo. TI2-152 agrega estas reglas:

- Quien se retira pierde el acceso en la consulta siguiente, porque cada lectura vuelve a exigir la asignación activa.
- Un acompañamiento no queda sin profesional: retirar al único profesional asignado responde `conflict`. Para reemplazarlo, primero se asigna al nuevo y después se retira al anterior.
- Un acompañamiento cerrado no admite conceder ni modificar accesos (`conflict`). Retirar un acceso sigue permitido.
- Retirar a un profesional no cancela ni reasigna sus atenciones futuras: siguen a su nombre y solo el Estudiante puede cancelarlas (activo o en pausa) o cambiarles el horario (activo). El cierre sí las cancela.

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
