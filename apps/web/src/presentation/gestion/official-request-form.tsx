import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { REFERRAL_UNIT_MAX_LENGTH } from "../../../../../convex/domain/index.ts";
import {
  focusRequestField,
  requestFieldFocusTarget,
  requestFieldLabel,
  SECTION_CLASS,
} from "../estudiante/request-content-form.ts";
import { RequestContentFields, TextInputField } from "../estudiante/request-content-fields.tsx";
import {
  emptyRequestDraft,
  findMissingFields,
  REQUEST_DRAFT_FIELD_ORDER,
  toRequestContentSubmission,
  type RequestDraft,
  type RequestDraftErrors,
} from "../estudiante/student-request-draft.ts";
import {
  FOCUS_CLASS,
  HEADING_RESET_CLASS,
  LINK_CLASS,
  PAGE_CLASS,
  PAGE_TITLE_CLASS,
  SECTION_TITLE_CLASS,
} from "../estudiante/student-page-classes.ts";
import { civilDateIssue, civilDateToUtc } from "../shared/date-format.ts";
import { ACCESS_DENIED_MESSAGE } from "../shared/view-states.tsx";
import { useRegisterOfficialRequest } from "./professional-requests-data.ts";
import { requestActionFailureOf } from "./request-review-errors.ts";

/**
 * Registro de una solicitud recibida por canal oficial (TI2-158).
 *
 * El Profesional registra, a nombre del estudiante, una solicitud que CERETI
 * recibió fuera de la aplicación: el contenido es la misma forma completa
 * que envía el Estudiante (`RequestContentFields`, con la voz del personal) y
 * suma la procedencia: el correo institucional del estudiante, cuándo la
 * recibió CERETI y, si la derivó otra unidad, cuál. Con unidad de origen la
 * solicitud queda como derivación de entrada.
 *
 * Lo escrito vive solo en la página y no en el almacenamiento del navegador:
 * son datos personales de otra persona, en equipos que el personal comparte.
 * Desde TI2-165 el envío no lleva clave de idempotencia: cada registro válido
 * crea una solicitud, así que el botón queda bloqueado mientras se envía y
 * un segundo clic no repite la llamada. El Backend valida cada dato; acá solo
 * se revisa que esté lo obligatorio.
 */
export function OfficialRequestFormPage() {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <section aria-labelledby="official-request-form-title" className={PAGE_CLASS}>
      <h1
        id="official-request-form-title"
        ref={headingRef}
        tabIndex={-1}
        className={PAGE_TITLE_CLASS}
      >
        Registrar solicitud por canal oficial
      </h1>
      <p className="text-base text-on-surface">
        Úsalo cuando CERETI recibe una solicitud fuera de la aplicación, por ejemplo por correo, en
        la oficina o derivada desde otra unidad. Quedará como Recibida en la bandeja de triage, a
        nombre del estudiante, y habrá que tomarla para revisarla.
      </p>
      <p>
        <Link to="/profesional/solicitudes" className={LINK_CLASS}>
          Volver a solicitudes
        </Link>
      </p>
      <OfficialRequestForm />
    </section>
  );
}

type ProvenanceField = "studentEmail" | "receivedDate" | "originUnit";
type ProvenanceErrors = Partial<Record<ProvenanceField, string>>;

const PROVENANCE_FIELD_LABELS: Record<ProvenanceField, string> = {
  studentEmail: "Correo del estudiante",
  receivedDate: "Fecha de recepción",
  originUnit: "Unidad que derivó",
};

const PROVENANCE_FIELD_TARGETS: Record<ProvenanceField, string> = {
  studentEmail: "official-student-email",
  receivedDate: "official-received-date",
  originUnit: "official-origin-unit",
};

type Provenance = {
  readonly studentEmail: string;
  /** `AAAA-MM-DD` o vacío: la fecha es opcional. */
  readonly receivedDate: string;
  readonly originUnit: string;
};

const EMPTY_PROVENANCE: Provenance = { studentEmail: "", receivedDate: "", originUnit: "" };

function findMissingProvenance(provenance: Provenance): ProvenanceErrors {
  const errors: ProvenanceErrors = {};
  if (provenance.studentEmail.trim() === "") {
    errors.studentEmail = "Indica el correo institucional del estudiante.";
  }
  const dateIssue = provenance.receivedDate === "" ? null : civilDateIssue(provenance.receivedDate);
  if (dateIssue === "format") {
    errors.receivedDate = "Usa una fecha válida con formato AAAA-MM-DD.";
  } else if (dateIssue === "impossible") {
    errors.receivedDate = "Esa fecha no existe en el calendario.";
  }
  return errors;
}

/**
 * Instante de recepción que se envía. La fecha civil se lleva al mediodía UTC
 * de ese día (la mañana en Chile) y nunca después de ahora: elegir hoy no se
 * rechaza como fecha futura. Vacía, el Backend usa el momento del registro.
 */
function toReceivedAt(receivedDate: string): number | undefined {
  if (receivedDate === "") return undefined;
  return Math.min(civilDateToUtc(receivedDate) + 12 * 60 * 60 * 1000, Date.now());
}

type SubmitState =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "failed"; message: string }
  | { status: "registered"; incomingReferral: boolean };

function OfficialRequestForm() {
  const registerOfficialRequest = useRegisterOfficialRequest();
  const [draft, setDraft] = useState<RequestDraft>(emptyRequestDraft);
  const [provenance, setProvenance] = useState<Provenance>(EMPTY_PROVENANCE);
  const [errors, setErrors] = useState<RequestDraftErrors>({});
  const [provenanceErrors, setProvenanceErrors] = useState<ProvenanceErrors>({});
  const [attempted, setAttempted] = useState(false);
  const [submitState, setSubmitState] = useState<SubmitState>({ status: "idle" });
  // Cada intento fallido pide llevar el foco al resumen una vez que se dibujó.
  const [summaryFocusRequest, setSummaryFocusRequest] = useState(0);
  const pendingRef = useRef(false);
  const summaryRef = useRef<HTMLHeadingElement>(null);
  const registeredRef = useRef<HTMLHeadingElement>(null);

  const registered = submitState.status === "registered";

  useEffect(() => {
    if (registered) {
      registeredRef.current?.focus();
    }
  }, [registered]);

  useEffect(() => {
    if (summaryFocusRequest > 0) {
      summaryRef.current?.focus();
    }
  }, [summaryFocusRequest]);

  function updateDraft(changes: Partial<RequestDraft>) {
    if (pendingRef.current) return;
    const next = { ...draft, ...changes };
    setDraft(next);
    if (attempted) setErrors(findMissingFields(next, "staff"));
  }

  function updateProvenance(changes: Partial<Provenance>) {
    if (pendingRef.current) return;
    const next = { ...provenance, ...changes };
    setProvenance(next);
    if (attempted) setProvenanceErrors(findMissingProvenance(next));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pendingRef.current) return;
    setAttempted(true);
    const missing = findMissingFields(draft, "staff");
    const missingProvenance = findMissingProvenance(provenance);
    setErrors(missing);
    setProvenanceErrors(missingProvenance);
    if (Object.keys(missing).length > 0 || Object.keys(missingProvenance).length > 0) {
      setSubmitState({ status: "idle" });
      setSummaryFocusRequest((count) => count + 1);
      return;
    }
    pendingRef.current = true;
    setSubmitState({ status: "pending" });
    const originUnit = provenance.originUnit.trim();
    const receivedAt = toReceivedAt(provenance.receivedDate);
    try {
      await registerOfficialRequest({
        ...toRequestContentSubmission(draft),
        studentEmail: provenance.studentEmail.trim(),
        ...(receivedAt === undefined ? {} : { receivedAt }),
        ...(originUnit === "" ? {} : { originUnit }),
      });
      setSubmitState({ status: "registered", incomingReferral: originUnit !== "" });
    } catch (error) {
      const failure = requestActionFailureOf(error, "registerOfficial");
      setSubmitState({
        status: "failed",
        message: failure.status === "denied" ? ACCESS_DENIED_MESSAGE : failure.message,
      });
      setSummaryFocusRequest((count) => count + 1);
    } finally {
      pendingRef.current = false;
    }
  }

  function startAnother() {
    setDraft(emptyRequestDraft());
    setProvenance(EMPTY_PROVENANCE);
    setErrors({});
    setProvenanceErrors({});
    setAttempted(false);
    setSubmitState({ status: "idle" });
  }

  if (submitState.status === "registered") {
    return (
      <div className="flex flex-col gap-4 rounded-lg border border-border-low border-t-4 border-t-support-green bg-surface-container-lowest p-6">
        <h2 ref={registeredRef} tabIndex={-1} className={`${SECTION_TITLE_CLASS} ${FOCUS_CLASS}`}>
          Solicitud registrada
        </h2>
        <p className="m-0 text-base text-on-surface">
          Quedó como Recibida en la bandeja de triage, con procedencia de canal oficial. Tómala
          desde la bandeja para revisarla.
        </p>
        {submitState.incomingReferral ? (
          <p className="m-0 text-base text-on-surface">
            Quedó también como derivación de entrada: antes de abrir el acompañamiento hay que
            registrar el contacto con el estudiante y su aceptación.
          </p>
        ) : null}
        <div className="flex flex-wrap gap-3">
          <Link to="/profesional/solicitudes" className={LINK_CLASS}>
            Volver a solicitudes
          </Link>
          <button
            type="button"
            className={`${LINK_CLASS} cursor-pointer border-0 bg-transparent px-0`}
            onClick={startAnother}
          >
            Registrar otra solicitud
          </button>
        </div>
      </div>
    );
  }

  const pending = submitState.status === "pending";
  const listedProvenance = (Object.keys(PROVENANCE_FIELD_LABELS) as ProvenanceField[]).filter(
    (field) => provenanceErrors[field] !== undefined,
  );
  const listedErrors = REQUEST_DRAFT_FIELD_ORDER.filter((field) => errors[field] !== undefined);
  const serverMessage = submitState.status === "failed" ? submitState.message : null;
  const hasFieldErrors = listedProvenance.length > 0 || listedErrors.length > 0;
  const showSummary = hasFieldErrors || serverMessage !== null;

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
            {hasFieldErrors
              ? "Revisa estos campos antes de registrar"
              : "No se registró la solicitud"}
          </h2>
          {serverMessage !== null ? <p className="m-0 font-semibold">{serverMessage}</p> : null}
          {hasFieldErrors ? (
            <ul className="m-0 flex flex-col gap-1 pl-5">
              {listedProvenance.map((field) => (
                <SummaryLink
                  key={field}
                  targetId={PROVENANCE_FIELD_TARGETS[field]}
                  text={`${PROVENANCE_FIELD_LABELS[field]}: ${provenanceErrors[field]}`}
                />
              ))}
              {listedErrors.map((field) => (
                <SummaryLink
                  key={field}
                  targetId={requestFieldFocusTarget(field)}
                  text={`${requestFieldLabel("staff", field)}: ${errors[field]}`}
                />
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <p className="m-0 text-base text-on-surface-variant">
        Cada campo indica si es obligatorio u opcional. Registra solo lo que el estudiante o la
        unidad informaron, sin diagnósticos ni documentos.
      </p>

      {/* Bloquea los campos mientras se envía; vuelven a estar disponibles si el envío falla. */}
      <fieldset disabled={pending} className="m-0 flex min-w-0 flex-col gap-8 border-0 p-0">
        <section aria-labelledby="official-provenance-title" className={SECTION_CLASS}>
          <h2 id="official-provenance-title" className={SECTION_TITLE_CLASS}>
            Estudiante y procedencia
          </h2>
          <dl className="m-0">
            <dt className="font-semibold text-on-surface">Procedencia</dt>
            <dd className="m-0 text-on-surface">Canal oficial de CERETI</dd>
          </dl>
          <TextInputField
            id={PROVENANCE_FIELD_TARGETS.studentEmail}
            field="studentEmail"
            type="email"
            label="Correo institucional del estudiante"
            required
            hint="La cuenta de Estudiante habilitada a cuyo nombre queda la solicitud."
            autoComplete="off"
            value={provenance.studentEmail}
            error={provenanceErrors.studentEmail}
            onChange={(value) => updateProvenance({ studentEmail: value })}
          />
          <TextInputField
            id={PROVENANCE_FIELD_TARGETS.receivedDate}
            field="receivedDate"
            type="date"
            label="Fecha en que CERETI la recibió"
            hint="Si la dejas vacía, se usa el momento del registro. No puede ser una fecha futura."
            value={provenance.receivedDate}
            error={provenanceErrors.receivedDate}
            onChange={(value) => updateProvenance({ receivedDate: value })}
          />
          <TextInputField
            id={PROVENANCE_FIELD_TARGETS.originUnit}
            field="originUnit"
            label="Unidad que derivó al estudiante"
            hint="Solo si otra unidad de la Universidad lo derivó a CERETI. Quedará como derivación de entrada: antes de abrir el acompañamiento habrá que registrar el contacto con el estudiante y su aceptación."
            maxLength={REFERRAL_UNIT_MAX_LENGTH}
            value={provenance.originUnit}
            error={provenanceErrors.originUnit}
            onChange={(value) => updateProvenance({ originUnit: value })}
          />
        </section>

        <RequestContentFields voice="staff" draft={draft} errors={errors} onChange={updateDraft} />
      </fieldset>

      <div className="flex flex-col gap-3">
        <button
          type="submit"
          className="inline-flex min-h-12 w-fit min-w-11 items-center justify-center rounded-[0.5rem] bg-primary-container px-6 py-2.5 text-base font-semibold text-on-primary disabled:cursor-not-allowed disabled:opacity-60 not-disabled:hover:bg-primary focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          disabled={pending}
          aria-busy={pending}
        >
          {pending ? "Registrando…" : "Registrar solicitud"}
        </button>
        <p role="status" aria-live="polite" className="sr-only">
          {pending ? "Registrando la solicitud…" : ""}
        </p>
      </div>
    </form>
  );
}

/** Enlace del resumen de errores: lleva el foco al campo con el problema. */
function SummaryLink({ targetId, text }: { targetId: string; text: string }) {
  return (
    <li>
      <a
        href={`#${targetId}`}
        className="inline-flex min-h-[44px] items-center font-semibold text-on-error-container underline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        onClick={(event) => {
          event.preventDefault();
          focusRequestField(targetId);
        }}
      >
        {text}
      </a>
    </li>
  );
}
