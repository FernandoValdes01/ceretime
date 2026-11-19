import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { ACCESS_DENIED_MESSAGE, LoadingState } from "../shared/view-states.tsx";
import { useSessionState } from "../session/session-state.ts";
import {
  focusRequestField,
  requestFieldFocusTarget,
  requestFieldLabel,
  SECTION_CLASS,
} from "./request-content-form.ts";
import { RequestContentFields } from "./request-content-fields.tsx";
import {
  clearRequestDraft,
  findMissingFields,
  loadRequestDraft,
  REQUEST_DRAFT_FIELD_ORDER,
  saveRequestDraft,
  toRequestContentSubmission,
  type RequestDraft,
  type RequestDraftErrors,
} from "./student-request-draft.ts";
import { useSubmitOwnRequest } from "./student-request-form-data.ts";
import {
  FOCUS_CLASS,
  HEADING_RESET_CLASS,
  LINK_CLASS,
  PAGE_CLASS,
  PAGE_TITLE_CLASS,
  PRIMARY_LINK_CLASS,
  SECTION_TITLE_CLASS,
} from "./student-page-classes.ts";

/**
 * Formulario de solicitud de acompañamiento del Estudiante (TI2-149).
 *
 * Pide solo lo que define `docs/especificacion-prototipo.md`: necesidad,
 * resultado esperado, necesidades de acceso con texto libre, modalidad,
 * disponibilidad general y medio accesible para recibir información. Nombre
 * y correo vienen de la cuenta Google y se muestran sin editar. No hay
 * campos de RUT, diagnóstico, certificados, archivos ni área interna.
 *
 * Lo escrito vive en un borrador (`student-request-draft.ts`): se conserva al
 * recargar, al volver al formulario y ante cualquier fallo del envío, y su
 * clave de idempotencia evita una segunda solicitud al reintentar.
 *
 * Accesibilidad (WCAG 2.2 AA): cada campo dice si es obligatorio u opcional
 * en el texto de su etiqueta, los grupos usan `fieldset` y `legend`, y los
 * errores se explican con texto junto al campo y en un resumen que recibe el
 * foco y enlaza a cada campo. El envío en curso se anuncia y bloquea el
 * botón para no repetir la mutation.
 */
export function StudentRequestFormPage() {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <section aria-labelledby="student-request-form-title" className={PAGE_CLASS}>
      <h1
        id="student-request-form-title"
        ref={headingRef}
        tabIndex={-1}
        className={PAGE_TITLE_CLASS}
      >
        Nueva solicitud de acompañamiento
      </h1>
      <p className="text-base text-on-surface">
        Cuéntanos qué necesitas y cómo podemos comunicarnos contigo. Un profesional de CERETI
        revisará tu solicitud. No necesitas indicar diagnósticos ni adjuntar documentos.
      </p>
      <p>
        <Link to="/estudiante/solicitudes" className={LINK_CLASS}>
          Volver a solicitudes
        </Link>
      </p>
      <RequestFormForSession />
    </section>
  );
}

function RequestFormForSession() {
  const session = useSessionState();
  // La guardia del área ya exige una sesión de Estudiante: aquí solo se
  // espera a que llegue para separar el borrador por cuenta.
  if (session === undefined || session.status !== "authenticated") {
    return <LoadingState label="Cargando tus datos…" />;
  }
  return <RequestForm key={session.email} ownerEmail={session.email} ownerName={session.name} />;
}

type SubmitState =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "rejected"; message: string }
  | { status: "denied" }
  | { status: "failed" }
  | { status: "sent"; requestId: string };

const FAILED_MESSAGE =
  "No pudimos enviar tu solicitud. Revisa tu conexión e inténtalo de nuevo: lo que escribiste se conserva y no se enviará dos veces.";

/** Mensaje del resumen cuando el Backend no registró la solicitud; `null` si no hubo envío fallido. */
function submitFailureMessage(state: SubmitState): string | null {
  switch (state.status) {
    case "rejected":
      return state.message;
    case "denied":
      return ACCESS_DENIED_MESSAGE;
    case "failed":
      return FAILED_MESSAGE;
    default:
      return null;
  }
}

function RequestForm({ ownerEmail, ownerName }: { ownerEmail: string; ownerName: string }) {
  const submitOwnRequest = useSubmitOwnRequest();
  const [draft, setDraft] = useState<RequestDraft>(() => loadRequestDraft(ownerEmail));
  const [errors, setErrors] = useState<RequestDraftErrors>({});
  const [attempted, setAttempted] = useState(false);
  const [submitState, setSubmitState] = useState<SubmitState>({ status: "idle" });
  // Cada intento fallido pide llevar el foco al resumen una vez que se dibujó.
  const [summaryFocusRequest, setSummaryFocusRequest] = useState(0);
  const pendingRef = useRef(false);
  const summaryRef = useRef<HTMLHeadingElement>(null);
  const sentRef = useRef<HTMLHeadingElement>(null);

  const sent = submitState.status === "sent";

  useEffect(() => {
    if (!sent) {
      saveRequestDraft(ownerEmail, draft);
    }
  }, [ownerEmail, draft, sent]);

  useEffect(() => {
    if (sent) {
      sentRef.current?.focus();
    }
  }, [sent]);

  useEffect(() => {
    if (summaryFocusRequest > 0) {
      summaryRef.current?.focus();
    }
  }, [summaryFocusRequest]);

  function update(changes: Partial<RequestDraft>) {
    // Lo enviado es lo que se guarda: editar durante el envío se perdería al
    // borrar el borrador, así que los campos quedan bloqueados mientras tanto.
    if (pendingRef.current) {
      return;
    }
    const next = { ...draft, ...changes };
    setDraft(next);
    // Tras el primer intento, cada error desaparece en cuanto se corrige.
    if (attempted) {
      setErrors(findMissingFields(next, "student"));
    }
  }

  function focusSummary() {
    setSummaryFocusRequest((count) => count + 1);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pendingRef.current) {
      return;
    }
    setAttempted(true);
    const missing = findMissingFields(draft, "student");
    setErrors(missing);
    if (Object.keys(missing).length > 0) {
      setSubmitState({ status: "idle" });
      focusSummary();
      return;
    }
    pendingRef.current = true;
    setSubmitState({ status: "pending" });
    const outcome = await submitOwnRequest(toRequestContentSubmission(draft));
    pendingRef.current = false;
    if (outcome.status === "sent") {
      clearRequestDraft(ownerEmail);
      setSubmitState(outcome);
      return;
    }
    setSubmitState(outcome);
    focusSummary();
  }

  if (submitState.status === "sent") {
    return (
      <div className="flex flex-col gap-4 rounded-lg border border-border-low border-t-4 border-t-support-green bg-surface-container-lowest p-6">
        <h2 ref={sentRef} tabIndex={-1} className={`${SECTION_TITLE_CLASS} ${FOCUS_CLASS}`}>
          Solicitud enviada
        </h2>
        <p className="text-base text-on-surface">
          La registramos con el estado Recibida. Un profesional de CERETI la revisará y te
          contactará por el medio que indicaste.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link
            to="/estudiante/solicitudes/$requestId"
            params={{ requestId: submitState.requestId }}
            className={PRIMARY_LINK_CLASS}
          >
            Ver la solicitud
          </Link>
          <Link to="/estudiante/solicitudes" className={LINK_CLASS}>
            Volver a solicitudes
          </Link>
        </div>
      </div>
    );
  }

  const pending = submitState.status === "pending";
  const listedErrors = REQUEST_DRAFT_FIELD_ORDER.filter((field) => errors[field] !== undefined);
  const serverMessage = submitFailureMessage(submitState);
  const showSummary = listedErrors.length > 0 || serverMessage !== null;

  return (
    <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-8">
      {showSummary ? (
        <div className="rounded-lg border-l-4 border-error bg-error-container p-6 text-on-error-container">
          {/* El foco llega al título: un lector anuncia qué pasó y luego lee la lista. */}
          <h2
            ref={summaryRef}
            tabIndex={-1}
            className={`${HEADING_RESET_CLASS} mb-2! text-lg! font-bold! text-on-error-container! ${FOCUS_CLASS}`}
          >
            {listedErrors.length > 0
              ? "Revisa estos campos antes de enviar"
              : "No se envió la solicitud"}
          </h2>
          {serverMessage !== null ? <p className="m-0 font-semibold">{serverMessage}</p> : null}
          {listedErrors.length > 0 ? (
            <ul className="m-0 flex flex-col gap-1 pl-5">
              {listedErrors.map((field) => (
                <li key={field}>
                  <a
                    href={`#${requestFieldFocusTarget(field)}`}
                    className="inline-flex min-h-[44px] items-center font-semibold text-on-error-container underline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
                    onClick={(event) => {
                      event.preventDefault();
                      focusRequestField(requestFieldFocusTarget(field));
                    }}
                  >
                    {requestFieldLabel("student", field)}: {errors[field]}
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <p className="m-0 text-base text-on-surface-variant">
        Cada campo indica si es obligatorio u opcional. Lo que escribas se guarda en esta pestaña
        hasta que envíes la solicitud.
      </p>

      {/* Bloquea los campos mientras se envía; vuelven a estar disponibles si el envío falla. */}
      <fieldset disabled={pending} className="m-0 flex min-w-0 flex-col gap-8 border-0 p-0">
        <section aria-labelledby="request-account-title" className={SECTION_CLASS}>
          <h2 id="request-account-title" className={SECTION_TITLE_CLASS}>
            Tus datos
          </h2>
          <p className="m-0 text-base text-on-surface-variant">
            Provienen de tu cuenta Google institucional y no se pueden editar aquí.
          </p>
          <dl className="m-0 grid gap-2">
            <div>
              <dt className="font-semibold text-on-surface">Nombre</dt>
              <dd className="m-0 text-on-surface">{ownerName}</dd>
            </div>
            <div>
              <dt className="font-semibold text-on-surface">Correo</dt>
              <dd className="m-0 break-words text-on-surface">{ownerEmail}</dd>
            </div>
          </dl>
        </section>

        <RequestContentFields voice="student" draft={draft} errors={errors} onChange={update} />
      </fieldset>

      <div className="flex flex-col gap-3">
        <button
          type="submit"
          className="inline-flex min-h-12 w-fit min-w-11 items-center justify-center rounded-[0.5rem] bg-primary-container px-6 py-2.5 text-base font-semibold text-on-primary disabled:cursor-not-allowed disabled:opacity-60 not-disabled:hover:bg-primary focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          disabled={pending}
          aria-busy={pending}
        >
          {pending
            ? "Enviando…"
            : submitState.status === "failed"
              ? "Reintentar envío"
              : "Enviar solicitud"}
        </button>
        <p role="status" aria-live="polite" className="sr-only">
          {pending ? "Enviando tu solicitud…" : ""}
        </p>
      </div>
    </form>
  );
}
