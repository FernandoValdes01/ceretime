import type { ReactNode } from "react";
import { ACCESS_NEED_OPTIONS } from "../../../../../convex/domain/index.ts";
import {
  MODALITY_OPTIONS,
  WEEKDAY_OPTIONS,
  type RequestDraft,
  type RequestDraftErrors,
  type RequestDraftField,
  type RequestFormVoice,
} from "./student-request-draft.ts";
import {
  fieldErrorId,
  REQUEST_CONTENT_COPY,
  requestFieldGroupId,
  SECTION_CLASS,
} from "./request-content-form.ts";
import { fieldClass, SECTION_TITLE_CLASS } from "./student-page-classes.ts";

/**
 * Campos del contenido de una solicitud de acompañamiento (TI2-149, extraído
 * en TI2-158).
 *
 * Los usan el formulario del Estudiante y el registro por canal oficial del
 * Profesional: los dos envían la forma completa del contrato
 * (`AccompanimentRequestContent`), así que comparten borrador, campos y
 * comprobaciones. Solo cambia la voz: el Estudiante habla de sí mismo y el
 * personal escribe sobre el estudiante.
 *
 * Accesibilidad (WCAG 2.2 AA): cada campo dice si es obligatorio u opcional
 * en el texto de su etiqueta, los grupos usan `fieldset` y `legend`, y cada
 * error se explica con texto junto al campo y se enlaza con
 * `aria-describedby`.
 */

/** Las secciones del contenido de la solicitud, en el orden del resumen de errores. */
export function RequestContentFields({
  voice,
  draft,
  errors,
  onChange,
}: {
  voice: RequestFormVoice;
  draft: RequestDraft;
  errors: RequestDraftErrors;
  onChange: (changes: Partial<RequestDraft>) => void;
}) {
  const copy = REQUEST_CONTENT_COPY[voice];
  return (
    <>
      <section aria-labelledby="request-need-title" className={SECTION_CLASS}>
        <h2 id="request-need-title" className={SECTION_TITLE_CLASS}>
          {copy.needTitle}
        </h2>
        <TextAreaField
          id="request-need-summary"
          field="needSummary"
          label="Describe la barrera o necesidad"
          required
          hint={copy.needSummaryHint}
          value={draft.needSummary}
          error={errors.needSummary}
          onChange={(value) => onChange({ needSummary: value })}
        />
        <TextAreaField
          id="request-expected-outcome"
          field="expectedOutcome"
          label={copy.expectedOutcomeLabel}
          required
          hint={copy.expectedOutcomeHint}
          value={draft.expectedOutcome}
          error={errors.expectedOutcome}
          onChange={(value) => onChange({ expectedOutcome: value })}
        />
      </section>

      <section aria-labelledby="request-access-title" className={SECTION_CLASS}>
        <h2 id="request-access-title" className={SECTION_TITLE_CLASS}>
          Condiciones de acceso
        </h2>
        <AccessNeedsFields
          voice={voice}
          accessNeedIds={draft.accessNeedIds}
          otherAccessNeed={draft.otherAccessNeed}
          error={errors.accessNeeds}
          onChange={onChange}
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
              errorId={
                errors.modalityPreference === undefined
                  ? undefined
                  : fieldErrorId("modalityPreference")
              }
              onChange={() => onChange({ modalityPreference: option.value })}
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
          hint={copy.weekdaysHint}
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
              errorId={
                errors.preferredWeekdays === undefined
                  ? undefined
                  : fieldErrorId("preferredWeekdays")
              }
              onChange={(checked) =>
                onChange({
                  preferredWeekdays: checked
                    ? [...draft.preferredWeekdays, day.value]
                    : draft.preferredWeekdays.filter((value) => value !== day.value),
                })
              }
            />
          ))}
        </ChoiceGroup>
        <fieldset
          id={requestFieldGroupId("availableTime")}
          className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0"
          aria-describedby={
            errors.availableTime === undefined
              ? "request-availableTime-hint"
              : `request-availableTime-hint ${fieldErrorId("availableTime")}`
          }
        >
          <legend className={LEGEND_CLASS}>
            Horario disponible <OptionalMark />
          </legend>
          <p id="request-availableTime-hint" className={HINT_CLASS}>
            {copy.timeHint}
          </p>
          <div className="flex flex-wrap gap-4">
            <TimeInput
              id="request-available-from"
              label="Desde"
              value={draft.availableFrom}
              errorId={
                errors.availableTime === undefined ? undefined : fieldErrorId("availableTime")
              }
              onChange={(value) => onChange({ availableFrom: value })}
            />
            <TimeInput
              id="request-available-to"
              label="Hasta"
              value={draft.availableTo}
              errorId={
                errors.availableTime === undefined ? undefined : fieldErrorId("availableTime")
              }
              onChange={(value) => onChange({ availableTo: value })}
            />
          </div>
          <FieldError field="availableTime" message={errors.availableTime} />
        </fieldset>
      </section>

      <section aria-labelledby="request-channel-title" className={SECTION_CLASS}>
        <h2 id="request-channel-title" className={SECTION_TITLE_CLASS}>
          Comunicación
        </h2>
        <TextInputField
          id="request-information-channel"
          field="preferredAccessibleInformationChannel"
          label="Medio accesible para recibir información"
          required
          hint="Por ejemplo: correo con letra grande, mensajes de texto o llamada telefónica."
          value={draft.preferredAccessibleInformationChannel}
          error={errors.preferredAccessibleInformationChannel}
          onChange={(value) => onChange({ preferredAccessibleInformationChannel: value })}
        />
      </section>
    </>
  );
}

/**
 * Necesidades de acceso con el formato de TI2-135: opciones de
 * `ACCESS_NEED_OPTIONS` y una necesidad libre aparte. Lo usan la solicitud y,
 * desde TI2-166, la actualización de necesidades del acompañamiento.
 */
export function AccessNeedsFields({
  voice,
  accessNeedIds,
  otherAccessNeed,
  error,
  onChange,
}: {
  voice: RequestFormVoice;
  accessNeedIds: readonly string[];
  otherAccessNeed: string;
  error?: string;
  onChange: (changes: { accessNeedIds?: string[]; otherAccessNeed?: string }) => void;
}) {
  const copy = REQUEST_CONTENT_COPY[voice];
  return (
    <>
      <ChoiceGroup
        field="accessNeeds"
        legend="Necesidades de acceso"
        required
        hint={copy.accessNeedsHint}
        error={error}
      >
        {ACCESS_NEED_OPTIONS.map((option) => (
          <ChoiceOption
            key={option.id}
            id={`request-access-need-${option.id}`}
            type="checkbox"
            name="accessNeeds"
            label={option.label}
            checked={accessNeedIds.includes(option.id)}
            errorId={error === undefined ? undefined : fieldErrorId("accessNeeds")}
            onChange={(checked) =>
              onChange({
                accessNeedIds: checked
                  ? [...accessNeedIds, option.id]
                  : accessNeedIds.filter((id) => id !== option.id),
              })
            }
          />
        ))}
      </ChoiceGroup>
      <TextAreaField
        id="request-other-access-need"
        label="Otra necesidad de acceso"
        hint={copy.otherAccessNeedHint}
        value={otherAccessNeed}
        onChange={(value) => onChange({ otherAccessNeed: value })}
      />
    </>
  );
}

const LEGEND_CLASS = "mb-1 p-0 text-base font-semibold text-on-surface";
const HINT_CLASS = "m-0 text-base text-on-surface-variant";

function describedBy(hintId: string | undefined, field: string, error?: string) {
  const ids = [hintId, error === undefined ? undefined : fieldErrorId(field)].filter(
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
function FieldError({ field, message }: { field: string; message?: string }) {
  if (message === undefined) {
    return null;
  }
  return (
    <p id={fieldErrorId(field)} className="m-0 flex gap-2 font-semibold text-error">
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
  field?: string;
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

/**
 * Campo de una línea con etiqueta visible, pista y error enlazados. `field`
 * nombra el error; el registro por canal oficial lo usa también para sus
 * datos propios (correo, fecha y unidad).
 */
export function TextInputField({
  id,
  field,
  label,
  required = false,
  hint,
  type = "text",
  value,
  error,
  maxLength,
  autoComplete,
  onChange,
}: {
  id: string;
  field: string;
  label: string;
  required?: boolean;
  hint: string;
  type?: "text" | "email" | "date";
  value: string;
  error?: string;
  maxLength?: number;
  autoComplete?: string;
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
      <input
        id={id}
        type={type}
        className={`${fieldClass(error !== undefined)}${type === "date" ? " w-auto" : ""}`}
        value={value}
        maxLength={maxLength}
        autoComplete={autoComplete}
        onChange={(event) => onChange(event.target.value)}
        aria-required={required ? "true" : undefined}
        aria-invalid={error !== undefined}
        aria-describedby={describedBy(hintId, field, error)}
      />
      <FieldError field={field} message={error} />
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
      id={requestFieldGroupId(field)}
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
  errorId: describedById,
  onChange,
}: {
  id: string;
  type: "checkbox" | "radio";
  name: string;
  label: string;
  checked: boolean;
  /** Error del grupo: se anuncia en cada control, no solo en el `fieldset`. */
  errorId?: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label
      htmlFor={id}
      className={`flex min-h-[44px] cursor-pointer items-center gap-3 rounded-[0.5rem] border px-3 py-2 text-base text-on-surface has-[:checked]:border-primary has-[:checked]:bg-surface-container-low has-[:focus-visible]:outline-[3px] has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus-ring ${
        describedById === undefined ? "border-outline" : "border-error"
      }`}
    >
      <input
        id={id}
        type={type}
        name={name}
        checked={checked}
        aria-invalid={describedById !== undefined}
        aria-describedby={describedById}
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
  errorId: describedById,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  errorId?: string;
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
        className={`${fieldClass(describedById !== undefined)} w-auto`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={describedById !== undefined}
        aria-describedby={describedById}
      />
    </div>
  );
}
