import { useId, useRef, useState, type RefObject } from "react";
// Provisorio (TI2-3): importa los tipos generados por ruta relativa hasta que
// el monorepo defina el alias o paquete interno compartido.
import type { Id } from "../../../../../convex/_generated/dataModel";
import { isOpenRequestState } from "../../../../../convex/domain/index.ts";
import { ModalDialog } from "../shared/modal-dialog.tsx";
import {
  useBackendConnected,
  useCancelOwnRequest,
  useRespondToInformationRequest,
  type OwnRequestActionOutcome,
} from "./student-request-actions.ts";
import {
  fieldClass,
  PRIMARY_BUTTON_CLASS,
  SECONDARY_BUTTON_CLASS,
} from "./student-page-classes.ts";

/**
 * Responder y cancelar la solicitud propia (TI2-153).
 *
 * Solo ofrece cada acción en el estado donde tiene sentido mostrarla:
 * responder mientras CERETI espera información y cancelar mientras la
 * solicitud sigue en curso. Es presentación, no autoridad: el Backend decide
 * y, si el estado cambió en otra pestaña o por el Profesional, el rechazo
 * llega con su explicación dentro del diálogo, nunca como un éxito falso.
 *
 * Cada acción pide confirmación en un diálogo modal con el texto que exige el
 * Backend. Tras un éxito el diálogo se cierra, se anuncia el resultado y el
 * foco va al estado, lo único estable del detalle: el botón que abrió el
 * diálogo puede desaparecer porque la query reactiva ya trae el nuevo estado.
 */
export function StudentRequestActions({
  requestId,
  status,
  statusRef,
}: {
  requestId: Id<"requests">;
  status: string;
  statusRef: RefObject<HTMLElement | null>;
}) {
  const cancelRequest = useCancelOwnRequest();
  const respond = useRespondToInformationRequest();
  const [openDialog, setOpenDialog] = useState<"respond" | "cancel" | null>(null);
  const [announcement, setAnnouncement] = useState<string | null>(null);
  // Destino del foco al cerrar: `null` vuelve al botón que abrió el diálogo.
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const canRespond = status === "awaiting_information_or_acceptance";
  const canCancel = isOpenRequestState(status);

  function open(dialog: "respond" | "cancel") {
    returnFocusRef.current = null;
    setAnnouncement(null);
    setOpenDialog(dialog);
  }

  function finish(message: string) {
    returnFocusRef.current = statusRef.current;
    setOpenDialog(null);
    setAnnouncement(message);
  }

  return (
    <>
      {/* Región viva siempre montada: así el lector anuncia el mensaje al aparecer. */}
      <p role="status" className="m-0 text-base font-semibold text-on-surface empty:hidden">
        {announcement}
      </p>
      {canRespond || canCancel ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          {canRespond ? (
            <button
              type="button"
              className={PRIMARY_BUTTON_CLASS}
              aria-haspopup="dialog"
              onClick={() => open("respond")}
            >
              Responder a CERETI
            </button>
          ) : null}
          {canCancel ? (
            <button
              type="button"
              className={SECONDARY_BUTTON_CLASS}
              aria-haspopup="dialog"
              onClick={() => open("cancel")}
            >
              Cancelar solicitud
            </button>
          ) : null}
        </div>
      ) : null}
      {openDialog === "respond" ? (
        <TextActionDialog
          title="Responder a CERETI"
          description="Tu respuesta llegará al profesional que revisa tu solicitud y la revisión continuará."
          fieldLabel="Tu respuesta"
          submitLabel="Enviar respuesta"
          pendingLabel="Enviando…"
          dismissLabel="Volver sin enviar"
          returnFocusRef={returnFocusRef}
          fallbackFocusRef={statusRef}
          onSubmit={(text) => respond(requestId, text)}
          onDone={() => finish("Enviamos tu respuesta. CERETI continuará con la revisión.")}
          onFailureAfterClose={setAnnouncement}
          onClose={() => setOpenDialog(null)}
        />
      ) : null}
      {openDialog === "cancel" ? (
        <TextActionDialog
          title="¿Cancelar esta solicitud?"
          description="Si la cancelas, CERETI dejará de revisarla y no podrás retomarla. Si más adelante lo necesitas, puedes enviar una solicitud nueva."
          fieldLabel="Motivo de la cancelación"
          submitLabel="Sí, cancelar solicitud"
          pendingLabel="Cancelando…"
          dismissLabel="No, mantener solicitud"
          returnFocusRef={returnFocusRef}
          fallbackFocusRef={statusRef}
          onSubmit={(text) => cancelRequest(requestId, text)}
          onDone={() => finish("Cancelaste la solicitud.")}
          onFailureAfterClose={setAnnouncement}
          onClose={() => setOpenDialog(null)}
        />
      ) : null}
    </>
  );
}

const DENIED_MESSAGE =
  "No puedes hacer esto con esta solicitud. Si crees que es un error, comunícate con CERETI por los canales oficiales.";
// No atribuye la causa: `failed` llega por un error del servidor o un código
// inesperado, no por una red caída (esa queda en espera, ver `WAITING_MESSAGE`).
const FAILED_MESSAGE =
  "No pudimos completar la acción. Lo que escribiste se conserva: inténtalo de nuevo o comunícate con CERETI por los canales oficiales.";
const WAITING_MESSAGE =
  "Sin conexión con CERETI. Se enviará cuando vuelva la conexión. Puedes cerrar esta ventana: el estado de la solicitud se actualizará solo.";

/** Mensaje del desenlace fallido; el rechazo trae la explicación pública del Backend. */
function failureMessage(outcome: Exclude<OwnRequestActionOutcome, { status: "done" }>): string {
  switch (outcome.status) {
    case "rejected":
      return outcome.message;
    case "denied":
      return DENIED_MESSAGE;
    case "failed":
      return FAILED_MESSAGE;
  }
}

/**
 * Diálogo de confirmación con un texto obligatorio. No valida el texto: el
 * Backend lo exige y su rechazo se muestra junto al campo.
 *
 * Con conexión, el envío bloquea el cierre hasta tener respuesta. Sin
 * conexión, Convex retiene la mutación hasta que vuelve la conexión: el
 * diálogo lo avisa y deja salir. Si el desenlace llega con el diálogo ya
 * cerrado, un éxito sigue por `onDone` y un fallo por `onFailureAfterClose`,
 * para no perderlo.
 */
function TextActionDialog({
  title,
  description,
  fieldLabel,
  submitLabel,
  pendingLabel,
  dismissLabel,
  returnFocusRef,
  fallbackFocusRef,
  onSubmit,
  onDone,
  onFailureAfterClose,
  onClose,
}: {
  title: string;
  description: string;
  fieldLabel: string;
  submitLabel: string;
  pendingLabel: string;
  dismissLabel: string;
  returnFocusRef: RefObject<HTMLElement | null>;
  fallbackFocusRef: RefObject<HTMLElement | null>;
  onSubmit: (text: string) => Promise<OwnRequestActionOutcome>;
  onDone: () => void;
  onFailureAfterClose: (message: string) => void;
  onClose: () => void;
}) {
  const fieldId = useId();
  const errorId = useId();
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const connected = useBackendConnected();
  // Solo con conexión se bloquea la salida: sin ella la espera puede no terminar.
  const locked = pending && connected;
  const waitingForConnection = pending && !connected;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    const outcome = await onSubmit(text);
    // El campo solo existe mientras el diálogo sigue abierto.
    const stillOpen = fieldRef.current !== null;
    setPending(false);
    if (outcome.status === "done") {
      onDone();
      return;
    }
    if (!stillOpen) {
      onFailureAfterClose(failureMessage(outcome));
      return;
    }
    setError(failureMessage(outcome));
    fieldRef.current?.focus();
  }

  return (
    <ModalDialog
      title={title}
      description={description}
      busy={locked}
      initialFocusRef={fieldRef}
      returnFocusRef={returnFocusRef}
      fallbackFocusRef={fallbackFocusRef}
      onClose={onClose}
    >
      <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
        <div className="flex flex-col gap-2">
          <label htmlFor={fieldId} className="text-base font-semibold text-on-surface">
            {fieldLabel} <span className="font-normal text-on-surface-variant">(obligatorio)</span>
          </label>
          <textarea
            id={fieldId}
            ref={fieldRef}
            rows={4}
            className={`${fieldClass(error !== null)} min-h-32 resize-y`}
            value={text}
            onChange={(event) => setText(event.target.value)}
            readOnly={pending}
            aria-required="true"
            aria-invalid={error !== null}
            aria-describedby={error === null ? undefined : errorId}
          />
          {error === null ? null : (
            <p id={errorId} role="alert" className="m-0 text-base font-semibold text-error">
              <span aria-hidden="true">⚠ </span>
              {error}
            </p>
          )}
        </div>
        {/* Región viva siempre montada: así el lector anuncia la espera al aparecer. */}
        <p role="status" className="m-0 text-base font-semibold text-on-surface empty:hidden">
          {waitingForConnection ? WAITING_MESSAGE : null}
        </p>
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            className={SECONDARY_BUTTON_CLASS}
            onClick={onClose}
            disabled={locked}
          >
            {dismissLabel}
          </button>
          {/* `aria-disabled` y no `disabled`: un botón deshabilitado pierde el
              foco y lo deja en `<body>`. `handleSubmit` ignora el envío repetido. */}
          <button
            type="submit"
            className={`${PRIMARY_BUTTON_CLASS} aria-disabled:cursor-not-allowed aria-disabled:opacity-60`}
            aria-disabled={pending}
            aria-busy={pending}
          >
            {pending ? pendingLabel : submitLabel}
          </button>
        </div>
      </form>
    </ModalDialog>
  );
}
