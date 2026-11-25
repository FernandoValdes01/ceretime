# Contrato Sprint 3 — Solicitudes de derechos de privacidad (TI2-167)

Superficie pública versionada para que el Estudiante presente y siga sus solicitudes de derechos de privacidad, y para que el Administrador responsable las revise, resuelva, prorrogue y deje constancia del envío de la respuesta. Todo lo que Web y Mobile consumen sale de `api.presentation.privacy` y de los tipos generados en `convex/_generated`. Los derechos, estados, transiciones y plazos son los de TI2-136; la persistencia es la de TI2-151. Opera con datos ficticios y no se presenta como una política aprobada por la UCT.

## Operaciones públicas

| Operación | Argumentos | Devuelve | Quién | Denegación |
| --- | --- | --- | --- | --- |
| `presentation.privacy.submitPrivacyRequest` (mutation) | `kind`, `version: "v1"` | La solicitud propia con el acuse de recibo y el vencimiento | Estudiante con cuenta vigente | `unauthorized` sin sesión, perfil, vigencia o rol; `privacy_request_fields_invalid` por un derecho todavía no habilitado |
| `presentation.privacy.listOwnPrivacyRequests` (query) | `paginationOpts`, `version: "v1"` | Página de solicitudes propias, de la más reciente a la más antigua | Estudiante con cuenta vigente | `unauthorized` para cualquier otro rol; `conflict` con un tamaño de página no finito |
| `presentation.privacy.getPrivacyRequest` (query) | `requestId`, `version: "v1"` | La solicitud con la vista del titular o del responsable | Estudiante dueño o Administrador con cuenta vigente | `unauthorized` sin sesión, perfil o vigencia, o con una solicitud ajena o inexistente |
| `presentation.privacy.listPrivacyRequests` (query) | `paginationOpts`, `status?`, `version: "v1"` | Página de solicitudes con la vista del responsable, ordenada por vencimiento efectivo | Administrador con cuenta vigente | `unauthorized` para cualquier otro rol; `conflict` con un tamaño de página no finito |
| `presentation.privacy.startPrivacyRequestReview` (mutation) | `requestId`, `version: "v1"` | La solicitud en `in_review` | Administrador con cuenta vigente | `unauthorized` sin permiso o con una solicitud ajena o inexistente; `conflict` si no está `received` |
| `presentation.privacy.resolvePrivacyRequest` (mutation) | `requestId`, `outcome`, `reasons`, `temporaryBlockUntil?`, `version: "v1"` | La solicitud en `resolved` con la respuesta fundada | Administrador con cuenta vigente | `unauthorized` igual; `conflict` si no está `in_review`; `privacy_request_fields_invalid` con datos de la respuesta inválidos |
| `presentation.privacy.extendPrivacyRequestDeadline` (mutation) | `requestId`, `days`, `reason`, `version: "v1"` | La solicitud con la prórroga y el nuevo `dueAt` | Administrador con cuenta vigente | `unauthorized` igual; `conflict` si ya tiene prórroga, si la solicitud está cerrada o si es de bloqueo; `privacy_request_fields_invalid` con `days` fuera de 1 a 30 o un motivo vacío o largo |
| `presentation.privacy.recordPrivacyResponseDelivery` (mutation) | `requestId`, `channel`, `reference`, `version: "v1"` | La solicitud con la constancia de envío y el plazo de reclamo | Administrador con cuenta vigente | `unauthorized` igual; `conflict` si no está resuelta o ya tiene constancia; `privacy_request_fields_invalid` con una referencia vacía o de más de 200 caracteres |

No hay operaciones para eliminar solicitudes, reabrirlas ni reemplazar una respuesta. Una solicitud resuelta o retirada es terminal.

## Forma de la solicitud

La vista `own` es la del titular y no incluye identificadores de personal. La vista `review` es la del Administrador responsable y suma `requesterId`, `requesterRole` y `responsibleId?`.

| Campo | Tipo | Regla |
| --- | --- | --- |
| `id` | `Id<"privacyRequests">` | Identificador opaco de la solicitud |
| `kind` | `"access"`, `"rectification"`, `"erasure"` o `"portability"` | Los derechos habilitados en esta entrega |
| `status` | `"received"`, `"in_review"`, `"awaiting_information"`, `"resolved"` o `"withdrawn"` | Estado vigente del procedimiento |
| `channel` | `"student_app"` o `"institutional_channel"` | Canal derivado del rol; el cliente no lo envía |
| `receivedAt` | número | Instante de recepción fijado por el servidor; es el acuse de recibo |
| `receivedDate` | `"AAAA-MM-DD"` | Fecha civil de recepción en `timeZone` |
| `initialDueDate` | `"AAAA-MM-DD"` | Último día civil del plazo inicial |
| `initialDueAt` | número | Vencimiento exclusivo inicial |
| `dueAt` | número | Vencimiento exclusivo vigente, con la prórroga si existe |
| `responseRule` | `"calendar_30"` o `"business_2"` | Regla aplicada; en esta entrega siempre `"calendar_30"` |
| `timeZone` | texto | Zona IANA del cómputo, `America/Santiago` |
| `extension?` | objeto | `days`, `extendedUntilDate`, `extendedUntilAt`, `extendedAt` y `reason` |
| `statusReason?` | texto | Motivo del cambio de estado, cuando corresponde |
| `withdrawnAt?` | número | Instante del retiro, cuando existe |
| `response?` | objeto | `outcome`, `reasons`, `respondedAt` y `temporaryBlockUntil?` |
| `deliveryReceipt?` | objeto | `channel`, `sentAt`, `reference`, `agencyClaimDueDate` y `agencyClaimDueAt` |
| `effect?` | `"authorized"` o `"preserved"` | Consecuencia reconocida por el procedimiento |
| `version` | `"v1"` | Versión del contrato |
| `view` | `"own"` o `"review"` | Vista que recibió quien consulta |

`effect` solo aparece cuando hay respuesta. `authorized` acompaña una concesión total o parcial y `preserved` una denegación. La ejecución material del acceso, la rectificación, la supresión y la portabilidad sobre los datos reales sigue pendiente de decisión institucional; este contrato no la simula ni la presenta como aprobada.

## Reglas

- Versión del contrato: `"v1"` (`PRIVACY_REQUEST_CONTRACT_VERSION`), obligatoria en las ocho operaciones.
- Solo el Estudiante presenta por la aplicación. El Profesional, el Practicante y el Administrador son titulares de sus propios datos, pero usan el canal institucional que definirá la UCT; no existe un segundo formulario en la aplicación.
- El servidor fija `receivedAt`, `receivedDate`, `requesterRole`, `channel`, `initialDueAt` y `dueAt`. El cliente solo envía el derecho. Un campo de más, otra versión o un valor fuera de las listas falla en el validador de Convex antes de llegar al caso de uso.
- El plazo general es de 30 días corridos: la fecha civil de recepción es el día 0 y el vencimiento es exclusivo al inicio del día siguiente al último día cubierto. Una solicitud de bloqueo usaría 2 días hábiles, pero el bloqueo y la oposición quedan para la siguiente tarea del módulo y hoy no se presentan.
- La prórroga es una sola, de un entero entre 1 y 30 días corridos. Suma días al vencimiento original y actualiza `dueAt`; no se aplica al bloqueo. Una segunda prórroga responde `conflict` y no escribe.
- La solicitud nace en `received`. El Administrador la toma con `startPrivacyRequestReview` y pasa a `in_review`. Solo desde `in_review` se resuelve; un salto desde `received` responde `conflict`.
- Resolver exige `outcome` (`"granted"`, `"partially_granted"` o `"denied"`), `reasons` en lenguaje comprensible para el titular y el responsable de la sesión. El dominio exige que el actor y `responsibleId` sean la misma persona; el cliente no envía `responsibleId`.
- Una respuesta de bloqueo concedida, total o parcialmente, exige `temporaryBlockUntil` posterior a la respuesta. Una denegación no lo lleva y ningún otro derecho puede usarlo. En esta entrega el bloqueo no se presenta, pero la regla queda en el contrato para cuando se habilite.
- La aprobación deja la resolución fundada y `effect: "authorized"`; no borra ni modifica datos reales por sí sola. La denegación deja `effect: "preserved"` y conserva los datos: no se elimina ni se anonimiza nada del titular.
- La constancia de envío es inmutable y solo se registra sobre una solicitud resuelta. `reference` es un folio o identificador opaco de 1 a 200 caracteres; no admite contenido sensible. `sentAt` lo fija el servidor y no puede ser anterior a `respondedAt`.
- El plazo para reclamar ante la Agencia es de 30 días hábiles desde la notificación de la respuesta. La constancia calcula `agencyClaimDueDate` y `agencyClaimDueAt` desde `sentAt`; una respuesta denegada debe informar ese plazo al titular. El texto jurídico definitivo sigue pendiente de validación.
- La cola del Administrador se ordena por `dueAt` ascendente y, con `status`, filtra ese estado. Los listados propios se ordenan por recepción descendente. Una página admite hasta 50 elementos; un `numItems` no finito responde `conflict`.
- Una solicitud ajena o inexistente responde `unauthorized` sin revelar si existe. Un `requestId` que no pertenece a `privacyRequests` falla en el validador de Convex.

## Errores

Los errores usan el contrato común de TI2-88 (`ConvexError({ code, message })`): los clientes distinguen por `error.data.code`, nunca por el texto.

| Código | Cuándo | Mensaje |
| --- | --- | --- |
| `unauthorized` | Sin sesión, perfil o vigencia, rol sin permiso, o solicitud ajena o inexistente | `"No autorizado"` |
| `conflict` | Transición inválida, solicitud cerrada, prórroga repetida, constancia duplicada o página no finita | Mensaje específico o `"La solicitud entra en conflicto con el estado actual."` |
| `privacy_request_fields_invalid` | Derecho no habilitado, fundamento vacío o largo, bloqueo temporal inválido, prórroga fuera de 1 a 30, motivo vacío o largo, o referencia vacía o larga | Mensaje de lo que hay que corregir |

## Ejemplos para Web y Mobile

```ts
import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { api } from "./_generated/api";

const submit = useMutation(api.presentation.privacy.submitPrivacyRequest);

// El acuse de recibo trae el vencimiento exclusivo; no lo calcula el cliente.
const receipt = await submit({ kind: "access", version: "v1" });

const own = useQuery(api.presentation.privacy.listOwnPrivacyRequests, {
  paginationOpts: { numItems: 10, cursor: null },
  version: "v1",
});

const queue = useQuery(api.presentation.privacy.listPrivacyRequests, {
  paginationOpts: { numItems: 10, cursor: null },
  status: "received",
  version: "v1",
});

const startReview = useMutation(api.presentation.privacy.startPrivacyRequestReview);
const resolve = useMutation(api.presentation.privacy.resolvePrivacyRequest);
const extend = useMutation(api.presentation.privacy.extendPrivacyRequestDeadline);
const recordDelivery = useMutation(api.presentation.privacy.recordPrivacyResponseDelivery);

await startReview({ requestId: receipt.id, version: "v1" });
await resolve({
  requestId: receipt.id,
  outcome: "denied",
  reasons: "La solicitud no cumple el supuesto del procedimiento de prueba.",
  version: "v1",
});
await recordDelivery({
  requestId: receipt.id,
  channel: "student_app",
  reference: "FOLIO-2026-0001",
  version: "v1",
});

const MENSAJE_POR_DEFECTO = "No pudimos completar la acción. Intenta de nuevo.";
const MENSAJE_SIN_ACCESO = "No tienes acceso a esta solicitud de privacidad.";

function mensajeDeError(error: unknown): string {
  if (!(error instanceof ConvexError)) return MENSAJE_POR_DEFECTO;
  const data: unknown = error.data;
  if (typeof data !== "object" || data === null || !("code" in data)) return MENSAJE_POR_DEFECTO;
  const message = "message" in data && typeof data.message === "string" ? data.message : null;
  switch (data.code) {
    case "unauthorized":
      return MENSAJE_SIN_ACCESO;
    case "privacy_request_fields_invalid":
    case "conflict":
      return message ?? MENSAJE_POR_DEFECTO;
    default:
      return MENSAJE_POR_DEFECTO;
  }
}
```

## Fuera de este contrato

- Bloqueo temporal y oposición: siguiente tarea del módulo.
- Exportación de datos y ejecución material de la supresión, la rectificación y la portabilidad: decisión institucional pendiente.
- Pantallas del Estudiante y del Administrador: issues posteriores.
- Correo, push y otros canales de notificación: TI2-159 y TI2-160.
- Registro en la bitácora de auditoría de cada lectura o escritura: TI2-176.

## Decisiones institucionales pendientes

El procedimiento sigue siendo una prueba con datos ficticios. Antes de usarlo con datos reales, la UCT debe designar al responsable institucional y su reemplazo, definir la dirección y el procedimiento del canal institucional, validar jurídicamente la fundamentación y el texto de la respuesta —incluida la indicación del reclamo ante la Agencia—, confirmar el cómputo de los plazos y los feriados aplicables, definir cómo se ejecutan el bloqueo, la supresión y la portabilidad sobre los datos reales, y aprobar el procedimiento como política institucional. `PENDING_INSTITUTIONAL_DECISIONS` enumera las cinco primeras en código.
