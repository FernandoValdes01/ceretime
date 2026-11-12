# Solicitudes de acompañamiento — TI2-141

Fuente: `CONTEXT.md` (solicitud de acompañamiento y sus estados), sección «Solicitudes» de `docs/especificacion-prototipo.md`, modelo de estados de `convex/domain/requests/state-model.md` y esquema de TI2-135 en `convex/domain/database/integrity.md`. Superficie pública bajo `api.presentation.requests.*`; todo opera con datos ficticios. Las operaciones de Sprint 1 que no cambian (`listOpenRequests`, `takeRequest`, `requestAdditionalInformation` y `acceptRequest`) siguen descritas en `docs/contratos-sprint-1.md`.

## Estados

`status` puede traer cualquiera de los siete estados de `REQUEST_STATES` (`convex/domain/requests/state.ts`), con la etiqueta de `REQUEST_STATE_LABELS`:

| Estado | Etiqueta |
| --- | --- |
| `received` | Recibida |
| `under_review` | En revisión |
| `awaiting_information_or_acceptance` | Esperando información o aceptación |
| `accepted` | Aceptada |
| `referred` | Derivada |
| `closed_without_accompaniment` | Cerrada sin acompañamiento |
| `cancelled` | Cancelada |

`referred` está en el contrato aunque ninguna fila lo trae todavía: lo habilita TI2-143. Hasta TI2-141 el contrato tenía solo los cuatro primeros, así que un cliente con un mapeo exhaustivo de cuatro estados deja de compilar.

## Mutations públicas

| Operación | Argumentos | Devuelve | Quién | Denegación |
| --- | --- | --- | --- | --- |
| `presentation/requests.createRequest` | Forma completa o forma anterior (ver «Envío») | Solicitud en `received` | Estudiante vigente | `No autorizado` sin motivo |
| `presentation/requests.respondToInformationRequest` | `requestId`, `response` | Solicitud en `under_review` | Estudiante vigente, dueño de la solicitud | `No autorizado`; ajena o inexistente responde igual |
| `presentation/requests.cancelRequest` | `requestId`, `reason` | Solicitud en `cancelled` | Estudiante vigente, dueño de la solicitud | `No autorizado`; ajena o inexistente responde igual |
| `presentation/requests.closeRequestWithoutAccompaniment` | `requestId`, `reason` | Solicitud en `closed_without_accompaniment` | Profesional vigente con toma activa | `No autorizado`; sin toma o inexistente responde igual |

Las cuatro devuelven la entidad de siempre: `_id`, `studentId`, `status`, `accessNeeds` y `createdAt`.

## Queries públicas

| Operación | Argumentos | Devuelve | Quién |
| --- | --- | --- | --- |
| `presentation/requests.listOwnRequests` | `paginationOpts` | Página de solicitudes propias, en cualquier estado | Estudiante vigente |
| `presentation/requests.listAuthorizedRequests` | `paginationOpts` | Página de solicitudes con toma activa, en cualquier estado | Profesional vigente |
| `presentation/requests.getRequest` | `requestId` | Detalle (ver abajo) | Estudiante dueño o Profesional con toma activa |

Los listados conservan los cinco campos de la entidad y ya no omiten las solicitudes canceladas ni las cerradas. La página conserva la forma de `paginate`: `{ page, isDone, continueCursor }`.

El detalle suma tres campos opcionales de texto libre, que no viajan en los listados ni en la bandeja:

- `informationRequest`: lo que pidió el Profesional. Solo está mientras la solicitud espera respuesta.
- `informationResponse`: la última respuesta del Estudiante.
- `closureReason`: la razón de cierre, legible para el Estudiante.

```json
{
  "_id": "k17abc...",
  "studentId": "j97def...",
  "status": "closed_without_accompaniment",
  "accessNeeds": "Comunicación escrita\nMás tiempo para comunicarme",
  "createdAt": 1762900000000,
  "informationResponse": "Puedo asistir los martes por la tarde",
  "closureReason": "La necesidad corresponde a otra unidad de la universidad"
}
```

## Envío

`createRequest` acepta dos formas, nunca las dos a la vez. Se distinguen por `accessNeeds`: es una lista en la forma completa y un texto en la anterior.

**Forma completa (TI2-141).** Es la que deben usar Web y Mobile:

| Campo | Tipo | Regla |
| --- | --- | --- |
| `needSummary` | `string` | Obligatorio, de 1 a 2000 caracteres tras recortar |
| `expectedOutcome` | `string` | Obligatorio, de 1 a 2000 caracteres tras recortar |
| `accessNeeds` | `{ id: string, label: string }[]` | Hasta 20, sin repetir `id`, cada `label` de 1 a 200 caracteres |
| `otherAccessNeed` | `string`, opcional | Texto libre adicional, sin pedir diagnóstico |
| `modalityPreference` | `"inPerson"` o `"online"` | Obligatorio |
| `generalAvailability` | `{ preferredWeekdays: number[], preferredTimeRange?: { from: string, to: string } }` | Al menos un día, de 0 (domingo) a 6 (sábado), sin repetir; horario `HH:mm` con inicio antes del fin |
| `preferredAccessibleInformationChannel` | `string` | Obligatorio, de 1 a 200 caracteres tras recortar |
| `idempotencyKey` | `string` | Obligatorio, de 1 a 128 caracteres; la genera el cliente una vez por envío |

Debe haber al menos una necesidad seleccionada o un `otherAccessNeed` con texto. `accessNeeds` de la respuesta es el texto unido que arma el Backend con las etiquetas y el texto libre, separados por salto de línea, hasta 2000 caracteres. La solicitud guarda su procedencia como canal del Estudiante. Los textos se guardan recortados y el exceso se rechaza, nunca se trunca. El validador rechaza cualquier campo fuera de esta lista, incluidos RUT, diagnóstico, certificados y área interna.

**Idempotencia.** Repetir el envío con la misma `idempotencyKey` devuelve la misma solicitud sin crear otra, aunque el contenido cambie. La clave es del Estudiante: la misma clave en otra cuenta es otro envío. El cliente debe generar una clave nueva para cada solicitud distinta y reutilizarla solo al reintentar.

**Forma anterior (Sprint 1).** Solo `accessNeeds: string`, de 1 a 2000 caracteres. Se conserva mientras Web y Mobile migran, no es idempotente y no guarda los campos nuevos.

## Respuesta, cancelación y cierre

- **Responder** solo es posible desde `awaiting_information_or_acceptance`. La solicitud vuelve a `under_review` para que quien la tomó la retome. La respuesta es obligatoria, de hasta 2000 caracteres, y queda en el historial de la solicitud.
- **Cancelar** es posible desde `received`, `under_review` o `awaiting_information_or_acceptance`. El motivo es obligatorio.
- **Cerrar sin acompañamiento** es posible desde `under_review` o `awaiting_information_or_acceptance`. La razón es obligatoria y queda como `closureReason`.
- Cancelar o cerrar nunca abre un acompañamiento. Una solicitud cancelada, cerrada o aceptada no admite ningún paso más. Una necesidad posterior empieza con una solicitud nueva.
- Cada cambio queda en el historial de la solicitud con actor y fecha. Los motivos y respuestas son texto libre: no deben incluir diagnósticos ni etiquetas clínicas, y no se copian a la bitácora de auditoría.

## Errores

Las cuatro mutations de «Mutations públicas» rechazan con el contrato común de TI2-88, `ConvexError({ code, message })`: los clientes distinguen por `error.data.code` y muestran `error.data.message`, que ya está en español.

| Código | Cuándo | Mensajes |
| --- | --- | --- |
| `request_fields_invalid` | Falta un dato o no cumple su regla | Por ejemplo: «Describe la barrera o necesidad.», «Selecciona al menos un día disponible.», «Se requiere el motivo para cancelar la solicitud», «Se requiere la respuesta a la información pedida», «Faltan datos de la solicitud», «Envía las necesidades de acceso como lista junto con los demás datos de la solicitud» |
| `conflict` | El estado actual no admite el paso | «La solicitud no admite la cancelación en su estado actual», «La solicitud no admite el cierre sin acompañamiento en su estado actual», «La solicitud no admite una respuesta en su estado actual» |

```json
{ "code": "request_fields_invalid", "message": "Selecciona al menos un día disponible." }
```

La denegación conserva la forma de Sprint 1: `ConvexError("No autorizado")`, sin motivo y sin revelar si la solicitud existe. Aplica a identidad ausente, perfil ausente o no vigente, rol ajeno, solicitud ajena o inexistente y toma ausente.

La forma anterior de `createRequest` y las operaciones de Sprint 1 siguen rechazando con `Error` y un mensaje en español. Ese mensaje solo llega al cliente en desarrollo: en producción Convex lo reemplaza por «Server Error». Pasarlas al contrato común cambia lo que reciben sus consumidores actuales y queda fuera de TI2-141.

## Ejemplos para Web y Mobile

```ts
import { ConvexError } from "convex/values";
import { useMutation } from "convex/react";
import { api } from "./_generated/api";

const createRequest = useMutation(api.presentation.requests.createRequest);
// Una clave por envío, creada al abrir el formulario: se reutiliza solo al reintentar.
const idempotencyKey = crypto.randomUUID();

try {
  const request = await createRequest({
    needSummary: "Necesito apoyo para seguir las clases en línea",
    expectedOutcome: "Acordar ajustes de comunicación con mis docentes",
    accessNeeds: [{ id: "written-communication", label: "Comunicación escrita" }],
    modalityPreference: "online",
    generalAvailability: { preferredWeekdays: [1, 3] },
    preferredAccessibleInformationChannel: "Correo con letra grande",
    idempotencyKey,
  });
} catch (error) {
  if (error instanceof ConvexError && typeof error.data === "object") {
    muestraMensaje(error.data.message);
  }
}
```

```ts
const respond = useMutation(api.presentation.requests.respondToInformationRequest);
await respond({ requestId, response: "Puedo asistir los martes por la tarde" });

const cancel = useMutation(api.presentation.requests.cancelRequest);
await cancel({ requestId, reason: "Ya recibí el apoyo por otra vía" });
```

## Impacto en los clientes

- **Mobile:** TI2-141 agregó los tres estados nuevos al `switch` de `mapBackendRequestStatus` (`apps/mobile/src/infrastructure/backend-contract-mappers.ts`), que el modelo de Mobile ya tenía. Mobile sigue enviando la forma anterior y no cambia de comportamiento. Pasar a la forma completa y mostrar el detalle es trabajo de TI4.
- **Web:** compila sin cambios. Sus listados y su detalle ahora pueden recibir solicitudes canceladas o cerradas, y ya tienen etiqueta para los siete estados (`apps/web/src/presentation/routes/student-panel-labels.ts` y `apps/web/src/presentation/gestion/gestion-labels.ts`). El formulario completo es TI2-149 y la revisión del Profesional es TI2-157.

Comprobación: pruebas «TI2-141: …» y «TI2-85: …» en `convex/tests/requests.test.ts` y `convex/tests/acceptance.test.ts`, y `convex/domain/requests/` (`toRequestSubmission`, `toRequestExchange` y las tablas de transiciones).
