# Solicitudes de acompañamiento — TI2-141, TI2-181, TI2-143, TI2-183

Fuente: `CONTEXT.md` (solicitud de acompañamiento y sus estados), sección «Solicitudes» de `docs/especificacion-prototipo.md`, modelo de estados de `convex/domain/requests/state-model.md` y esquema de TI2-135 en `convex/domain/database/integrity.md`. Superficie pública bajo `api.presentation.requests.*`; todo opera con datos ficticios. Las operaciones de Sprint 1 (`listOpenRequests`, `takeRequest`, `requestAdditionalInformation` y `acceptRequest`) conservan los argumentos y respuestas de `docs/contratos-sprint-1.md`; desde TI2-181 rechazan con el contrato común de «Errores».

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

`referred` es la derivación de salida: CERETI derivó al estudiante a otra unidad. Está en el contrato desde TI2-141 y una solicitud lo trae desde TI2-143 (ver «Canal oficial y derivaciones»). Hasta TI2-141 el contrato tenía solo los cuatro primeros, así que un cliente con un mapeo exhaustivo de cuatro estados deja de compilar.

## Mutations públicas

| Operación | Argumentos | Devuelve | Quién | Denegación |
| --- | --- | --- | --- | --- |
| `presentation/requests.createRequest` | Forma completa o forma anterior (ver «Envío») | Solicitud en `received` | Estudiante vigente | `unauthorized` sin motivo, en las dos formas |
| `presentation/requests.respondToInformationRequest` | `requestId`, `response` | Solicitud en `under_review` | Estudiante vigente, dueño de la solicitud | `unauthorized`; ajena o inexistente responde igual |
| `presentation/requests.cancelRequest` | `requestId`, `reason` | Solicitud en `cancelled` | Estudiante vigente, dueño de la solicitud | `unauthorized`; ajena o inexistente responde igual |
| `presentation/requests.closeRequestWithoutAccompaniment` | `requestId`, `reason` | Solicitud en `closed_without_accompaniment` | Profesional vigente con toma activa | `unauthorized`; sin toma o inexistente responde igual |

| `presentation/requests.registerOfficialRequest` | Forma completa, `studentEmail`, `receivedAt` y `originUnit` opcionales | Solicitud en `received` | Profesional vigente | `unauthorized` sin motivo |
| `presentation/requests.recordReferralContact` | `requestId` | Solicitud sin cambio de estado | Profesional vigente con toma activa | `unauthorized`; sin toma o inexistente responde igual |
| `presentation/requests.recordReferralAcceptance` | `requestId` | Solicitud sin cambio de estado | Profesional vigente con toma activa | `unauthorized`; sin toma o inexistente responde igual |
| `presentation/requests.referRequest` | `requestId`, `destinationUnit`, `reason` | Solicitud en `referred` | Profesional vigente con toma activa | `unauthorized`; sin toma o inexistente responde igual |

Todas devuelven la entidad de siempre: `_id`, `studentId`, `status`, `accessNeeds` y `createdAt`. Las cuatro últimas son de TI2-143 y se describen en «Canal oficial y derivaciones».

## Queries públicas

| Operación | Argumentos | Devuelve | Quién |
| --- | --- | --- | --- |
| `presentation/requests.listOwnRequests` | `paginationOpts` | Página de solicitudes propias, en cualquier estado | Estudiante vigente |
| `presentation/requests.listAuthorizedRequests` | `paginationOpts` | Página de solicitudes con toma activa, en cualquier estado | Profesional vigente |
| `presentation/requests.getRequest` | `requestId` | Detalle (ver abajo) | Estudiante dueño o Profesional con toma activa |

Los listados conservan los cinco campos de la entidad y ya no omiten las solicitudes canceladas ni las cerradas. La página conserva la forma de `paginate`: `{ page, isDone, continueCursor }`.

El detalle suma campos que no viajan en los listados ni en la bandeja. Tres son opcionales y de texto libre:

- `informationRequest`: lo que pidió el Profesional. Solo está mientras la solicitud espera respuesta.
- `informationResponse`: la respuesta del Estudiante al último pedido. Si el Profesional vuelve a pedir información, la respuesta anterior deja de venir hasta que llegue la nueva, así una pregunta pendiente nunca aparece junto a una respuesta vieja.
- `closureReason`: la razón de cierre, legible para el Estudiante.

Desde TI2-143 suma además la procedencia y las derivaciones, sin identificadores de personal:

- `provenanceChannel`: `"student"` si la envió el propio Estudiante y `"official_channel"` si la registró CERETI. Una solicitud anterior a TI2-135 responde `"student"`. El Backend lo entrega siempre; el tipo lo declara opcional para no romper a un cliente que reutiliza el tipo del detalle con elementos de un listado, como hace Mobile.
- `incomingReferral`, opcional: `{ originUnit, referredAt, contactedAt?, acceptedAt? }`. Está cuando otra unidad derivó al estudiante a CERETI. `contactedAt` y `acceptedAt` aparecen cuando se registran.
- `outgoingReferral`, opcional: `{ destinationUnit, referredAt, reason }`. Está cuando la solicitud quedó `referred`. Es lo que el Estudiante lee: a qué unidad y por qué.

Las fechas son milisegundos de época. Los tres campos son opcionales en el tipo, así que Web y Mobile compilan sin cambios.

```json
{
  "_id": "k17abc...",
  "studentId": "j97def...",
  "status": "closed_without_accompaniment",
  "accessNeeds": "Comunicación escrita\nMás tiempo para comunicarme",
  "createdAt": 1762900000000,
  "informationResponse": "Puedo asistir los martes por la tarde",
  "closureReason": "La necesidad corresponde a otra unidad de la universidad",
  "provenanceChannel": "student"
}
```

## Envío

`createRequest` acepta dos formas, nunca las dos a la vez. La forma anterior trae solo `accessNeeds` como texto; cualquier otra entrada sigue la forma completa, donde `accessNeeds` es una lista.

**Forma completa (TI2-141).** Es la que deben usar Web y Mobile:

| Campo | Tipo | Regla |
| --- | --- | --- |
| `needSummary` | `string` | Obligatorio, de 1 a 2000 caracteres tras recortar |
| `expectedOutcome` | `string` | Obligatorio, de 1 a 2000 caracteres tras recortar |
| `accessNeeds` | `{ id: string, label: string }[]` | Hasta 20, sin repetir `id`; cada `id` y cada `label` de 1 a 200 caracteres tras recortar |
| `otherAccessNeed` | `string`, opcional | Texto libre adicional, sin pedir diagnóstico |
| `modalityPreference` | `"inPerson"` o `"online"` | Obligatorio |
| `generalAvailability` | `{ preferredWeekdays: number[], preferredTimeRange?: { from: string, to: string } }` | Al menos un día, de 0 (domingo) a 6 (sábado), sin repetir; horario `HH:mm` con inicio antes del fin |
| `preferredAccessibleInformationChannel` | `string` | Obligatorio, de 1 a 200 caracteres tras recortar |
| `idempotencyKey` | `string` | Obligatorio, de 1 a 128 caracteres; la genera el cliente una vez por envío |

Debe haber al menos una necesidad seleccionada o un `otherAccessNeed` con texto. `accessNeeds` de la respuesta es el texto unido que arma el Backend con las etiquetas y el texto libre, separados por salto de línea, hasta 2000 caracteres. La solicitud guarda su procedencia como canal del Estudiante. Los textos se guardan recortados y el exceso se rechaza, nunca se trunca. El validador rechaza cualquier campo fuera de esta lista, incluidos RUT, diagnóstico, certificados y área interna.

**Idempotencia.** Repetir el envío con la misma `idempotencyKey` devuelve la misma solicitud sin crear otra, aunque el contenido cambie. La clave es del Estudiante: la misma clave en otra cuenta es otro envío. El cliente debe generar una clave nueva para cada solicitud distinta y reutilizarla solo al reintentar.

**Forma anterior (Sprint 1).** Solo `accessNeeds: string`, de 1 a 2000 caracteres, sin ningún otro campo. Se conserva mientras Web y Mobile migran, no es idempotente y no guarda los campos nuevos. Si el texto llega con cualquier campo de la forma completa, incluido `otherAccessNeed`, el envío sigue la forma completa: autoriza antes de validar y rechaza con `request_fields_invalid` y «Envía las necesidades de acceso como lista junto con los demás datos de la solicitud.», aunque falten otros campos.

## Respuesta, cancelación y cierre

- **Responder** solo es posible desde `awaiting_information_or_acceptance`. La solicitud vuelve a `under_review` para que quien la tomó la retome. La respuesta es obligatoria, de hasta 2000 caracteres, y queda en el historial de la solicitud.
- **Cancelar** es posible desde `received`, `under_review` o `awaiting_information_or_acceptance`. El motivo es obligatorio.
- **Cerrar sin acompañamiento** es posible desde `under_review` o `awaiting_information_or_acceptance`. La razón es obligatoria y queda como `closureReason`.
- Cancelar o cerrar nunca abre un acompañamiento. Una solicitud cancelada, cerrada o aceptada no admite ningún paso más. Una necesidad posterior empieza con una solicitud nueva.
- Cada cambio queda en el historial de la solicitud con actor y fecha. Los motivos y respuestas son texto libre: no deben incluir diagnósticos ni etiquetas clínicas, y no se copian a la bitácora de auditoría.

## Canal oficial y derivaciones

Operaciones de TI2-143 para el personal autorizado, que es el Profesional con cuenta vigente. Ninguna envía avisos ni se comunica con otra unidad: eso ocurre fuera de la aplicación.

**Registrar por canal oficial.** `registerOfficialRequest` registra una solicitud que CERETI recibió por un canal oficial, a nombre de un Estudiante:

| Campo | Tipo | Regla |
| --- | --- | --- |
| Forma completa | Los campos de «Envío», incluida `idempotencyKey` | Las mismas reglas y los mismos mensajes |
| `studentEmail` | `string` | Correo institucional de una cuenta de Estudiante vigente. Se compara sin mayúsculas ni espacios sobrantes |
| `receivedAt` | `number`, opcional | Cuándo la recibió CERETI, en milisegundos de época. No puede ser futura. Si falta, es el momento del registro |
| `originUnit` | `string`, opcional | Unidad de la Universidad que derivó al estudiante, de 1 a 200 caracteres tras recortar. Con ella la solicitud es una derivación de entrada |

La solicitud queda `received` y sin toma: aparece en la bandeja y quien la revise debe tomarla. Guarda su procedencia: el canal oficial, quién la registró y cuándo se recibió. Autoriza antes de validar. Repetir el registro con la misma `idempotencyKey` devuelve la misma solicitud a quien la registró; si esa clave es de una solicitud del mismo estudiante que registró otra persona, responde `conflict` sin entregarla. Si `studentEmail` no es de una cuenta de Estudiante vigente, responde `request_fields_invalid`.

**Derivación de entrada.** Es el aviso de otra unidad sobre una posible necesidad de un estudiante. No es un estado: la solicitud recorre los mismos estados que cualquier otra. Lo que cambia es que **no abre acompañamiento hasta que conste el contacto de CERETI con el estudiante y su aceptación**, en ese orden:

1. `recordReferralContact` guarda quién contactó y cuándo. Se registra una sola vez.
2. `recordReferralAcceptance` guarda cuándo aceptó el estudiante. Exige el contacto previo y se registra una sola vez.
3. Recién entonces `acceptRequest` abre el acompañamiento. Antes responde `conflict` sin escribir nada.

Los dos pasos exigen la toma activa y no cambian `status`. Se pueden registrar mientras la solicitud está `under_review` o `awaiting_information_or_acceptance`. El detalle (`getRequest`) entrega `incomingReferral` con `contactedAt` y `acceptedAt`: un cliente ofrece abrir el acompañamiento solo cuando `acceptedAt` viene.

**Derivación de salida.** `referRequest` deriva la solicitud a otra unidad. Es posible desde `under_review` o `awaiting_information_or_acceptance` y la deja `referred`, que es un estado final: no abre acompañamiento y no admite ningún paso más.

| Campo | Tipo | Regla |
| --- | --- | --- |
| `requestId` | `Id<"requests">` | Solicitud con toma activa de quien llama |
| `destinationUnit` | `string` | Nombre de la unidad de destino, de 1 a 200 caracteres tras recortar |
| `reason` | `string` | Razón que lee el Estudiante, de 1 a 2000 caracteres tras recortar |

No pide destinatarios ni antecedentes, y el validador rechaza cualquier otro campo. El aviso al Estudiante queda registrado como el cambio de estado en el historial de la solicitud, con actor y fecha, y el Estudiante lee la unidad y la razón en `outgoingReferral` del detalle. El envío del aviso por correo o notificación no es parte de esta operación.

```ts
const refer = useMutation(api.presentation.requests.referRequest);
await refer({
  requestId,
  destinationUnit: "Unidad ficticia de destino",
  reason: "El apoyo que necesitas lo entrega esa unidad",
});
```

Los nombres de unidad y las razones son texto libre: no deben incluir diagnósticos ni etiquetas clínicas, y no se copian a la bitácora de auditoría.

## Vínculo con el acompañamiento

Desde TI2-183 la solicitud aceptada y el acompañamiento que abrió se enlazan en los dos sentidos. El vínculo sale de `requestId` en la fila del acompañamiento y del índice `accompaniments.by_request`; no hay otra tabla ni otro campo.

- `getRequest` suma `accompanimentId`, opcional. Está cuando la aceptación abrió el acompañamiento; una solicitud que nunca se aceptó no lo trae. Lo recibe quien ya lee el detalle: el Estudiante dueño o el Profesional con toma activa. El identificador no concede acceso: `getAccompaniment` vuelve a autorizar con la asignación al acompañamiento.
- La vista completa del acompañamiento suma `requestId`, opcional. La entregan `getAccompaniment`, `listOwnedAccompaniments`, `listAssignedAccompaniments` y `acceptRequest`. Falta en un acompañamiento que no nació de una solicitud.
- La vista minimizada del Practicante no cambia: sigue siendo `_id`, `status`, `objective` y `view`.

Los dos campos son opcionales en el tipo, así que Web y Mobile compilan sin cambios. Las denegaciones no cambian: `getRequest` responde `unauthorized` del contrato común y `getAccompaniment` conserva su error genérico de Sprint 1.

```json
{
  "_id": "k17abc...",
  "studentId": "j97def...",
  "status": "accepted",
  "accessNeeds": "Comunicación escrita",
  "createdAt": 1762900000000,
  "provenanceChannel": "student",
  "accompanimentId": "m33ghi..."
}
```

## Errores

Todas las operaciones de `api.presentation.requests.*`, mutations y consultas, rechazan con el contrato común de TI2-88, `ConvexError({ code, message })`, también al denegar: los clientes distinguen por `error.data.code` y muestran `error.data.message`, que ya está en español. Desde TI2-181 incluye las operaciones de Sprint 1 y la forma anterior de `createRequest`.

| Código | Cuándo | Mensajes |
| --- | --- | --- |
| `unauthorized` | Identidad ausente, perfil ausente o no vigente, rol ajeno, solicitud ajena o inexistente, o toma ausente | «No autorizado» |
| `request_fields_invalid` | Falta un dato o no cumple su regla. Un campo que no llega se nombra con el mismo texto que cuando llega vacío | Por ejemplo: «Describe la barrera o necesidad.», «Indica si prefieres la modalidad presencial o en línea.», «Selecciona al menos un día disponible.», «Se requiere el motivo para cancelar la solicitud.», «Se requiere la respuesta a la información pedida.», «Envía las necesidades de acceso como lista junto con los demás datos de la solicitud.», «Se requiere el motivo para pedir información adicional», «Se requiere el objetivo para abrir el acompañamiento», «El tamaño de página debe ser un número finito.» (`listAuthorizedRequests`), «No hay una cuenta de Estudiante vigente con ese correo.», «La fecha de recepción no puede ser futura.», «Indica la unidad a la que se deriva al estudiante.», «Se requiere la razón de la derivación.» |
| `access_needs_empty` | No hay ninguna necesidad seleccionada ni `otherAccessNeed` con texto; en la forma anterior, `accessNeeds` llega vacío | «Se requiere describir la necesidad de acceso.»; en la forma anterior, «Se requiere describir la necesidad de acceso» |
| `access_needs_too_long` | Los nombres seleccionados y `otherAccessNeed`, unidos, superan 2000 caracteres; en la forma anterior, `accessNeeds` los supera | «Las necesidades de acceso y el texto adicional superan juntos el máximo permitido (2000 caracteres).»; en la forma anterior, «La necesidad de acceso supera el máximo permitido (2000 caracteres)» |
| `conflict` | El estado actual no admite el paso, o quien llama ya tomó la solicitud | «La solicitud no admite la cancelación en su estado actual.», «La solicitud no admite el cierre sin acompañamiento en su estado actual.», «La solicitud no admite una respuesta en su estado actual.», «Solo se pueden tomar solicitudes recibidas», «Ya tomaste esta solicitud», «La solicitud no admite pedir información adicional en su estado actual», «La solicitud ya fue aceptada», «La solicitud no admite la aceptación en su estado actual», «La derivación necesita el contacto con el estudiante y su aceptación antes de abrir el acompañamiento», «Registra primero el contacto con el estudiante.», «El contacto con el estudiante ya está registrado.», «La aceptación del estudiante ya está registrada.», «La solicitud no viene de una derivación.», «La solicitud ya no admite este registro en su estado actual.», «La solicitud no admite la derivación en su estado actual.», «Ya existe otra solicitud de este estudiante con esa clave de envío. Genera una clave nueva.» |

```json
{ "code": "request_fields_invalid", "message": "Selecciona al menos un día disponible." }
```

Los códigos `access_needs_*` son los mismos de Sprint 1, que los clientes ya traducen; el resto de los campos usa `request_fields_invalid`.

La denegación de todas las operaciones es `{ "code": "unauthorized", "message": "No autorizado" }`, sin motivo y sin revelar si la solicitud existe. Tomar una solicitud que ya no está recibida, o que ya tomaste, responde `conflict`, distinto de la denegación. El envío completo autoriza antes de validar: quien no puede enviar recibe `unauthorized` aunque mande campos inválidos.

Hasta TI2-181, la forma anterior de `createRequest` y las operaciones de Sprint 1 denegaban con `ConvexError("No autorizado")`, con el texto en `error.data` en vez de un objeto, y rechazaban con `Error`, que en producción llegaba como «Server Error». Un cliente que compara `error.data` con el texto «No autorizado» deja de reconocer la denegación: debe comparar `error.data.code`. Como Web y Convex se despliegan por separado, un cliente puede aceptar las dos formas mientras dura la transición.

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
  muestraMensaje(mensajeDeError(error));
}

const MENSAJE_POR_DEFECTO = "No pudimos completar la acción. Intenta de nuevo.";
const MENSAJE_SIN_ACCESO = "No tienes acceso a esta solicitud.";

// Distingue por código estable. Lo que no es un código conocido usa el mensaje
// genérico: nunca se muestra el texto del SDK.
function mensajeDeError(error: unknown): string {
  if (!(error instanceof ConvexError)) return MENSAJE_POR_DEFECTO;
  const data: unknown = error.data;
  if (typeof data !== "object" || data === null || !("code" in data)) return MENSAJE_POR_DEFECTO;
  const message = "message" in data && typeof data.message === "string" ? data.message : null;
  switch (data.code) {
    case "unauthorized":
      return MENSAJE_SIN_ACCESO;
    case "request_fields_invalid":
    case "access_needs_empty":
    case "access_needs_too_long":
    case "conflict":
      return message ?? MENSAJE_POR_DEFECTO;
    default:
      return MENSAJE_POR_DEFECTO;
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

- **TI2-143:** una solicitud puede traer `referred`, que significa que CERETI la derivó a otra unidad y ya no admite pasos. Una derivación de entrada pendiente de contacto o aceptación no es `referred`: sigue en `under_review` o en espera y se reconoce por `incomingReferral` en el detalle. Mobile muestra hoy para `referred` el texto «Solicitud derivada; queda pendiente del contacto y aceptación del estudiante.» (`apps/mobile/src/presentation/profesional/professional-requests-screen.tsx`), que describe la derivación de entrada y no la de salida. Las pantallas de Web para estas operaciones son TI2-158.

- **TI2-183:** la Web puede enlazar el detalle de una solicitud aceptada con su acompañamiento (TI2-153) y Mobile puede hacer lo mismo cuando lo necesite. Ningún cliente tiene que cambiar para seguir compilando.

Comprobación: pruebas «TI2-183: …» en `convex/tests/requestAccompanimentLink.test.ts` y `convex/domain/accompaniments/accompaniment.test.ts`, pruebas «TI2-143: …» en `convex/tests/requests.test.ts` y `convex/domain/requests/referral.test.ts`, pruebas «TI2-141: …» y «TI2-85: …» en `convex/tests/requests.test.ts` y `convex/tests/acceptance.test.ts`, la respuesta con dobles en `convex/application/requests/respond.test.ts`, y `convex/domain/requests/` (`toCompleteSubmission`, `toRequestSubmission`, `toInformationResponse`, `toRequestExchange` y las tablas de transiciones).
