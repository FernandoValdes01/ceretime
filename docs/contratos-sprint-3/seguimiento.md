# Contrato Sprint 3 — Registro de seguimiento (TI2-146)

Superficie pública versionada para que el Profesional guarde y confirme el seguimiento de una atención, y para que cada rol lea el registro de una atención o el historial de un acompañamiento con su vista. Todo lo que Web y Mobile consumen sale de `api.presentation.follow_up` y de los tipos generados en `convex/_generated`. La forma del registro es la de TI2-106, la persistencia la de TI2-118 y las vistas por rol las de TI2-127 (`convex/domain/authorization/permissions-matrix.md`). Opera con datos ficticios.

## Operaciones públicas

| Operación                                                         | Argumentos                                                                                                             | Devuelve                                                                            | Quién                                                                                   | Denegación                                                                                                                                                      |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `presentation.follow_up.saveFollowUpRecord` (mutation)            | `appointmentId`, `agreements`, `tasks`, `nextSteps`, `suggestedNextAppointmentDate?`, `internalNote?`, `version: "v1"` | `{appointmentId}`                                                                   | Profesional con asignación activa, cuenta vigente y el acompañamiento `active`          | `unauthorized` sin permiso o con una atención ajena, inexistente o de otra tabla; `conflict` con datos inválidos o un registro ya confirmado con otro contenido |
| `presentation.follow_up.getFollowUpRecord` (query)                | `appointmentId`, `version: "v1"`                                                                                       | La proyección de la vista del rol, o `null` si la atención aún no tiene seguimiento | Estudiante dueño, Profesional con asignación activa y Practicante con asignación activa | `unauthorized` para el Administrador, sin sesión o con una atención ajena, inexistente o de otra tabla                                                          |
| `presentation.follow_up.listAccompanimentFollowUpRecords` (query) | `accompanimentId`, `limit`, `cursor?`, `version: "v1"`                                                                 | `{items, hasMore, nextCursor, version}` con la vista del rol en cada elemento       | Los mismos roles que la lectura por atención                                            | `unauthorized` igual que la lectura por atención; `conflict` con un `limit` fuera de 1 a 20                                                                     |

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
- Guardar es confirmar. Repetir el guardado con el mismo contenido, aunque cambien los espacios que se recortan, responde el mismo `{appointmentId}` sin escribir. Cualquier diferencia en acuerdos, tareas (descripción, responsable, estado u orden), próximos pasos, fecha sugerida o nota responde `conflict` con `"El seguimiento de esta atención ya está confirmado y no se puede cambiar."` y no escribe. Por eso el estado de una tarea tampoco cambia después de confirmar.
- Guardados simultáneos de la misma atención dejan un solo registro: Convex reintenta el que pierde y ese reintento ya encuentra el registro confirmado.
- Cada registro pertenece a su atención y, por ella, a su acompañamiento. Un Profesional asignado a otro acompañamiento recibe `unauthorized` al guardar o leer esa atención.
- Un acompañamiento cerrado o en pausa no admite guardar, pero su historial se sigue leyendo con la vista de cada rol.
- La nota interna se guarda solo en `followUpNotes`, la única tabla de notas. Solo la vista `professional` la incluye, y solo si la nota pertenece al mismo acompañamiento del registro.
- El seguimiento no admite contenido clínico: un texto con la etiqueta `Diagnóstico:` o con el nombre de un documento clínico (por ejemplo, «informe psicológico», «evaluación psicológica», «CIE-10» o «DSM-5») responde `conflict`.

## Vistas y claves exactas

Los validadores de salida fijan estas claves: si una proyección trajera otra clave, la respuesta falla en vez de entregarla. Las claves opcionales solo aparecen cuando el registro tiene ese dato.

| Vista          | Quién la recibe                     | Claves                                                                                                                                                           |
| -------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `professional` | Profesional con asignación activa   | `appointmentId`, `accompanimentId`, `appointmentStatus`, `agreements`, `tasks`, `nextSteps`, `suggestedNextAppointmentDate?`, `internalNote?`, `version`, `view` |
| `shared`       | Estudiante dueño del acompañamiento | Las mismas sin `internalNote`                                                                                                                                    |
| `minimized`    | Practicante con asignación activa   | `appointmentId`, `appointmentStatus`, `suggestedNextAppointmentDate?`, `version`, `view`                                                                         |

`appointmentStatus` es el estado vigente de la atención, leído al responder. La vista `minimized` omite todo texto libre y el acompañamiento, porque acuerdos, tareas y próximos pasos pueden mencionar necesidades de acceso.

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

El historial recorre las atenciones del acompañamiento pedido, de la que empieza más tarde a la que empieza antes, y entrega las que tienen registro. `limit` cuenta atenciones, no registros: una página puede traer menos elementos que `limit`, incluso ninguno, y aun así tener `hasMore: true`. Para seguir, se envía el `nextCursor` recibido sin modificarlo; cuando llega `null`, no hay más páginas. Solo se recorren atenciones de ese acompañamiento, así que el historial no mezcla acompañamientos.

## Errores

Los errores usan el contrato común de TI2-88 (`ConvexError({ code, message })`): los clientes distinguen por `error.data.code`, nunca por el texto.

- `unauthorized` (`"No autorizado"`): sin sesión, perfil o vigencia, rol sin permiso, asignación revocada, acompañamiento que no admite guardar, o atención o acompañamiento ajeno, inexistente o de otra tabla. No revela si el recurso existe.
- `conflict` con el mensaje de lo que hay que corregir. Si hay varias causas, los mensajes se unen con un espacio en este orden:

| Causa                                        | Mensaje                                                                                                          |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Atención que no admite seguimiento           | `"La atención todavía no admite seguimiento: debe estar realizada o con la inasistencia registrada."`            |
| `id` vacío                                   | `"Cada acuerdo y cada tarea necesitan un identificador."`                                                        |
| `id` repetido                                | `"Hay acuerdos o tareas con el identificador repetido."`                                                         |
| Texto vacío, incluida una nota enviada vacía | `"Hay textos vacíos: completa los acuerdos, las tareas, los próximos pasos y, si la incluyes, la nota interna."` |
| Texto largo                                  | `"Cada texto admite hasta 500 caracteres."`                                                                      |
| Demasiadas entradas                          | `"Se admiten hasta 20 acuerdos y 20 tareas."`                                                                    |
| Fecha inválida                               | `"La fecha sugerida debe ser una fecha válida con formato AAAA-MM-DD."`                                          |
| Contenido clínico                            | `"El seguimiento no admite diagnósticos, evaluaciones psicológicas ni documentos clínicos."`                     |

- `conflict` con `"El seguimiento de esta atención ya está confirmado y no se puede cambiar."` cuando el registro ya existe con otro contenido.
- `conflict` con el mensaje genérico (`"La solicitud entra en conflicto con el estado actual."`) cuando `limit` no es un entero entre 1 y 20; se rechaza antes de leer.

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
  if (error instanceof ConvexError && error.data.code === "conflict") {
    muestraMensaje(error.data.message);
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

## Fuera de este contrato

- Pantallas del Profesional y del Estudiante: TI2-165 y TI2-166.
- Auditoría de guardados y lecturas del seguimiento: TI2-176.
