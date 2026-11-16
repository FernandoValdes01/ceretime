import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ACCESS_DENIED_MESSAGE, LoadingState } from "../shared/view-states.tsx";
import { useSessionState } from "../session/session-state.ts";
import {
  ACCESS_NEED_OPTIONS,
  clearRequestDraft,
  findMissingFields,
  loadRequestDraft,
  MODALITY_OPTIONS,
  REQUEST_DRAFT_FIELD_ORDER,
  saveRequestDraft,
  toOwnRequestSubmission,
  WEEKDAY_OPTIONS,
  type RequestDraft,
  type RequestDraftErrors,
  type RequestDraftField,
} from "./student-request-draft.ts";
import { useSubmitOwnRequest } from "./student-request-form-data.ts";

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
    <section
      aria-labelledby="student-request-form-title"
      className="mx-auto flex w-full max-w-3xl flex-col gap-6 text-left"
    >
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

const FIELD_LABELS: Record<RequestDraftField, string> = {
  needSummary: "Barrera o necesidad",
  expectedOutcome: "Qué esperas de CERETI",
  accessNeeds: "Necesidades de acceso",
  modalityPreference: "Modalidad preferida",
  preferredWeekdays: "Días disponibles",
  availableTime: "Horario disponible",
  preferredAccessibleInformationChannel: "Medio para recibir información",
};

/** Control que recibe el foco al elegir un error del resumen. */
const FIELD_FOCUS_TARGET: Record<RequestDraftField, string> = {
  needSummary: "request-need-summary",
  expectedOutcome: "request-expected-outcome",
  accessNeeds: `request-access-need-${ACCESS_NEED_OPTIONS[0]?.id ?? "other"}`,
  modalityPreference: `request-modality-${MODALITY_OPTIONS[0]?.value ?? "inPerson"}`,
  preferredWeekdays: `request-weekday-${WEEKDAY_OPTIONS[0].value}`,
  availableTime: "request-available-from",
  preferredAccessibleInformationChannel: "request-information-channel",
};

function errorId(field: RequestDraftField): string {
  return `request-${field}-error`;
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
  const summaryRef = useRef<HTMLDivElement>(null);
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
    const next = { ...draft, ...changes };
    setDraft(next);
    // Tras el primer intento, cada error desaparece en cuanto se corrige.
    if (attempted) {
      setErrors(findMissingFields(next));
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
    const missing = findMissingFields(draft);
    setErrors(missing);
    if (Object.keys(missing).length > 0) {
      setSubmitState({ status: "idle" });
      focusSummary();
      return;
    }
    pendingRef.current = true;
    setSubmitState({ status: "pending" });
    const outcome = await submitOwnRequest(toOwnRequestSubmission(draft));
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
  const serverMessage =
    submitState.status === "rejected"
      ? submitState.message
      : submitState.status === "denied"
        ? ACCESS_DENIED_MESSAGE
        : submitState.status === "failed"
          ? FAILED_MESSAGE
          : null;
  const showSummary = listedErrors.length > 0 || serverMessage !== null;

  return (
    <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-8">
      {showSummary ? (
        <div
          ref={summaryRef}
          tabIndex={-1}
          aria-labelledby="request-summary-title"
          className="rounded-lg border-l-4 border-error bg-error-container p-6 text-on-error-container focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        >
          <h2
            id="request-summary-title"
            className={`${HEADING_RESET_CLASS} mb-2! text-lg! font-bold! text-on-error-container!`}
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
                    href={`#${FIELD_FOCUS_TARGET[field]}`}
                    className="inline-flex min-h-[44px] items-center font-semibold text-on-error-container underline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
                    onClick={(event) => {
                      event.preventDefault();
                      document.getElementById(FIELD_FOCUS_TARGET[field])?.focus();
                    }}
                  >
                    {FIELD_LABELS[field]}: {errors[field]}
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

      <section aria-labelledby="request-need-title" className={SECTION_CLASS}>
        <h2 id="request-need-title" className={SECTION_TITLE_CLASS}>
          Tu necesidad
        </h2>
        <TextAreaField
          id="request-need-summary"
          field="needSummary"
          label="Describe la barrera o necesidad"
          required
          hint="Cuéntalo con tus palabras. No es necesario indicar un diagnóstico."
          value={draft.needSummary}
          error={errors.needSummary}
          onChange={(value) => update({ needSummary: value })}
        />
        <TextAreaField
          id="request-expected-outcome"
          field="expectedOutcome"
          label="Qué esperas de CERETI"
          required
          hint="Por ejemplo: acordar ajustes con tus docentes o recibir orientación."
          value={draft.expectedOutcome}
          error={errors.expectedOutcome}
          onChange={(value) => update({ expectedOutcome: value })}
        />
      </section>

      <section aria-labelledby="request-access-title" className={SECTION_CLASS}>
        <h2 id="request-access-title" className={SECTION_TITLE_CLASS}>
          Condiciones de acceso
        </h2>
        <ChoiceGroup
          field="accessNeeds"
          legend="Necesidades de acceso"
          required
          hint="Puedes elegir varias. Si la tuya no aparece, escribe cuál es en «Otra necesidad de acceso»."
          error={errors.accessNeeds}
        >
          {ACCESS_NEED_OPTIONS.map((option) => (
            <ChoiceOption
              key={option.id}
              id={`request-access-need-${option.id}`}
              type="checkbox"
              name="accessNeeds"
              label={option.label}
              checked={draft.accessNeedIds.includes(option.id)}
              invalid={errors.accessNeeds !== undefined}
              onChange={(checked) =>
                update({
                  accessNeedIds: checked
                    ? [...draft.accessNeedIds, option.id]
                    : draft.accessNeedIds.filter((id) => id !== option.id),
                })
              }
            />
          ))}
        </ChoiceGroup>
        <TextAreaField
          id="request-other-access-need"
          label="Otra necesidad de acceso"
          hint="Describe cualquier otra condición o apoyo que necesites para participar."
          value={draft.otherAccessNeed}
          onChange={(value) => update({ otherAccessNeed: value })}
        />
        <ChoiceGroup
          field="modalityPreference"
          legend="Modalidad preferida"
          required
          error={errors.modalityPreference}
        >
          {MODALITY_OPTIONS.map((option) => (
            <ChoiceOption
              key={option.value}
              id={`request-modality-${option.value}`}
              type="radio"
              name="modalityPreference"
              label={option.label}
              checked={draft.modalityPreference === option.value}
              invalid={errors.modalityPreference !== undefined}
              onChange={() => update({ modalityPreference: option.value })}
            />
          ))}
        </ChoiceGroup>
      </section>

      <section aria-labelledby="request-availability-title" className={SECTION_CLASS}>
        <h2 id="request-availability-title" className={SECTION_TITLE_CLASS}>
          Disponibilidad general
        </h2>
        <ChoiceGroup
          field="preferredWeekdays"
          legend="Días disponibles"
          required
          hint="Elige los días en que podrías asistir. No es un compromiso de horario."
          error={errors.preferredWeekdays}
        >
          {WEEKDAY_OPTIONS.map((day) => (
            <ChoiceOption
              key={day.value}
              id={`request-weekday-${day.value}`}
              type="checkbox"
              name="preferredWeekdays"
              label={day.label}
              checked={draft.preferredWeekdays.includes(day.value)}
              invalid={errors.preferredWeekdays !== undefined}
              onChange={(checked) =>
                update({
                  preferredWeekdays: checked
                    ? [...draft.preferredWeekdays, day.value]
                    : draft.preferredWeekdays.filter((value) => value !== day.value),
                })
              }
            />
          ))}
        </ChoiceGroup>
        <fieldset
          className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0"
          aria-describedby={
            errors.availableTime === undefined
              ? "request-availableTime-hint"
              : `request-availableTime-hint ${errorId("availableTime")}`
          }
        >
          <legend className={LEGEND_CLASS}>
            Horario disponible <OptionalMark />
          </legend>
          <p id="request-availableTime-hint" className={HINT_CLASS}>
            Si tienes un rango de horas preferido, indica el inicio y el término.
          </p>
          <div className="flex flex-wrap gap-4">
            <TimeInput
              id="request-available-from"
              label="Desde"
              value={draft.availableFrom}
              invalid={errors.availableTime !== undefined}
              onChange={(value) => update({ availableFrom: value })}
            />
            <TimeInput
              id="request-available-to"
              label="Hasta"
              value={draft.availableTo}
              invalid={errors.availableTime !== undefined}
              onChange={(value) => update({ availableTo: value })}
            />
          </div>
          <FieldError field="availableTime" message={errors.availableTime} />
        </fieldset>
      </section>

      <section aria-labelledby="request-channel-title" className={SECTION_CLASS}>
        <h2 id="request-channel-title" className={SECTION_TITLE_CLASS}>
          Comunicación
        </h2>
        <div className="flex flex-col gap-2">
          <label htmlFor="request-information-channel" className={LEGEND_CLASS}>
            Medio accesible para recibir información <RequiredMark />
          </label>
          <p id="request-information-channel-hint" className={HINT_CLASS}>
            Por ejemplo: correo con letra grande, mensajes de texto o llamada telefónica.
          </p>
          <input
            id="request-information-channel"
            type="text"
            className={fieldClass(errors.preferredAccessibleInformationChannel !== undefined)}
            value={draft.preferredAccessibleInformationChannel}
            onChange={(event) =>
              update({ preferredAccessibleInformationChannel: event.target.value })
            }
            aria-required="true"
            aria-invalid={errors.preferredAccessibleInformationChannel !== undefined}
            aria-describedby={describedBy(
              "request-information-channel-hint",
              "preferredAccessibleInformationChannel",
              errors.preferredAccessibleInformationChannel,
            )}
          />
          <FieldError
            field="preferredAccessibleInformationChannel"
            message={errors.preferredAccessibleInformationChannel}
          />
        </div>
      </section>

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

/*
 * El bloque de compatibilidad de `index.css` (TI2-130) centra el texto de
 * `#root` y fija tamaño, color, peso y márgenes de `h1` y `h2` fuera de las
 * capas de Tailwind, por lo que gana a las utilidades. Hasta que se migre,
 * esta pantalla alinea a la izquierda (DESIGN.md) y marca como importantes
 * las utilidades de sus títulos.
 */
const HEADING_RESET_CLASS = "m-0! font-sans! tracking-normal!";
const PAGE_TITLE_CLASS = `${HEADING_RESET_CLASS} text-[1.75rem]! leading-snug! font-semibold! text-primary! sm:text-[2rem]!`;
const LINK_CLASS =
  "inline-flex min-h-[44px] w-fit items-center rounded-[0.5rem] py-2 font-semibold text-primary underline underline-offset-4 focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus-ring";
const PRIMARY_LINK_CLASS =
  "inline-flex min-h-12 items-center rounded-[0.5rem] bg-primary-container px-6 py-2.5 font-semibold text-on-primary no-underline hover:bg-primary focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus-ring";
const SECTION_CLASS =
  "flex flex-col gap-5 rounded-lg border border-border-low bg-surface-container-lowest p-6";
const SECTION_TITLE_CLASS = `${HEADING_RESET_CLASS} text-xl! leading-snug! font-semibold! text-on-surface!`;
const LEGEND_CLASS = "mb-1 p-0 text-base font-semibold text-on-surface";
const HINT_CLASS = "m-0 text-base text-on-surface-variant";
const FOCUS_CLASS =
  "focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus-ring";

function fieldClass(invalid: boolean): string {
  return `min-h-[44px] w-full min-w-0 box-border rounded-[0.5rem] border bg-surface-container-lowest px-3 py-2 text-base text-on-surface ${
    invalid ? "border-2 border-error" : "border-outline"
  } ${FOCUS_CLASS}`;
}

function describedBy(hintId: string | undefined, field: RequestDraftField, error?: string) {
  const ids = [hintId, error === undefined ? undefined : errorId(field)].filter(
    (id): id is string => id !== undefined,
  );
  return ids.length === 0 ? undefined : ids.join(" ");
}

function RequiredMark() {
  return <span className="font-normal text-on-surface-variant">(obligatorio)</span>;
}

function OptionalMark() {
  return <span className="font-normal text-on-surface-variant">(opcional)</span>;
}

/** Error junto al campo: texto e indicador visible, no solo el color del borde. */
function FieldError({ field, message }: { field: RequestDraftField; message?: string }) {
  if (message === undefined) {
    return null;
  }
  return (
    <p id={errorId(field)} className="m-0 flex gap-2 font-semibold text-error">
      <span aria-hidden="true">⚠</span>
      <span>{message}</span>
    </p>
  );
}

function TextAreaField({
  id,
  field,
  label,
  required = false,
  hint,
  value,
  error,
  onChange,
}: {
  id: string;
  field?: RequestDraftField;
  label: string;
  required?: boolean;
  hint: string;
  value: string;
  error?: string;
  onChange: (value: string) => void;
}) {
  const hintId = `${id}-hint`;
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className={LEGEND_CLASS}>
        {label} {required ? <RequiredMark /> : <OptionalMark />}
      </label>
      <p id={hintId} className={HINT_CLASS}>
        {hint}
      </p>
      <textarea
        id={id}
        rows={4}
        className={`${fieldClass(error !== undefined)} min-h-32 resize-y`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-required={required ? "true" : undefined}
        aria-invalid={error !== undefined}
        aria-describedby={field === undefined ? hintId : describedBy(hintId, field, error)}
      />
      {field === undefined ? null : <FieldError field={field} message={error} />}
    </div>
  );
}

function ChoiceGroup({
  field,
  legend,
  required = false,
  hint,
  error,
  children,
}: {
  field: RequestDraftField;
  legend: string;
  required?: boolean;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  const hintId = hint === undefined ? undefined : `request-${field}-hint`;
  return (
    <fieldset
      className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0"
      aria-describedby={describedBy(hintId, field, error)}
    >
      <legend className={LEGEND_CLASS}>
        {legend} {required ? <RequiredMark /> : <OptionalMark />}
      </legend>
      {hint === undefined ? null : (
        <p id={hintId} className={HINT_CLASS}>
          {hint}
        </p>
      )}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,14rem),1fr))] gap-2">
        {children}
      </div>
      <FieldError field={field} message={error} />
    </fieldset>
  );
}

function ChoiceOption({
  id,
  type,
  name,
  label,
  checked,
  invalid,
  onChange,
}: {
  id: string;
  type: "checkbox" | "radio";
  name: string;
  label: string;
  checked: boolean;
  invalid: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label
      htmlFor={id}
      className={`flex min-h-[44px] cursor-pointer items-center gap-3 rounded-[0.5rem] border px-3 py-2 text-base text-on-surface has-[:checked]:border-primary has-[:checked]:bg-surface-container-low has-[:focus-visible]:outline-[3px] has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus-ring ${
        invalid ? "border-error" : "border-outline"
      }`}
    >
      <input
        id={id}
        type={type}
        name={name}
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="size-5 shrink-0 accent-primary focus-visible:outline-none"
      />
      <span>{label}</span>
    </label>
  );
}

function TimeInput({
  id,
  label,
  value,
  invalid,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  invalid: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-base text-on-surface">
        {label}
      </label>
      <input
        id={id}
        type="time"
        className={`${fieldClass(invalid)} w-auto`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={invalid}
      />
    </div>
  );
}
