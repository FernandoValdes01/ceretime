import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { StudentPanelErrorBoundary } from "../routes/student-portal.tsx";
import "../routes/student-portal.css";
import {
  exceptionKindLabel,
  exceptionScopeLabel,
  formatSlotDuration,
  formatWindowRange,
  weekdayLabel,
  availabilityModalityLabel,
} from "./professional-availability-labels.ts";
import {
  EMPTY_BLOCK_FORM,
  EMPTY_EXCEPTION_FORM,
  getAgendaPort,
  toSaveBlockInput,
  toSaveExceptionInput,
  useProfessionalAvailability,
  validateBlockForm,
  validateExceptionForm,
  type BlockFormState,
  type ExceptionFormState,
} from "./professional-availability-data.ts";
import type {
  AvailabilityBlock,
  AvailabilityException,
} from "../../../../../convex/domain/index.ts";

/**
 * Clases Tailwind de las filas de gestión (TI2-91, migrado por TI2-130):
 * 44px de alto táctil mínimo y foco visible de 3px según DESIGN.md.
 */
const GESTION_ROW = "flex items-center gap-2 min-h-[44px] px-3 py-2 text-inherit";
const GESTION_FOCUS_VISIBLE =
  "focus-visible:outline-[3px] focus-visible:outline-solid focus-visible:outline-focus-ring focus-visible:outline-offset-[2px]";

/**
 * Campos de gestión (TI2-103): alto táctil mínimo de 44px y ancho fluido
 * según DESIGN.md, con el mismo foco visible de las filas. Los formularios
 * apilan los campos en columna para refluir en ventanas estrechas.
 */
const GESTION_FIELD = "min-h-[44px] w-full box-border px-3 py-2 text-base text-inherit";
const GESTION_FIELD_CLASS = `${GESTION_FIELD} ${GESTION_FOCUS_VISIBLE}`;

/**
 * Editor de bloques recurrentes y excepciones del Profesional (TI2-103).
 *
 * Interfaz tipada con validación de formato y resultados simulados, sin
 * duplicar reglas del Backend. Lee y guarda por el puerto común de agenda
 * con el adaptador ficticio hasta TI2-125; no escribe base de datos, no
 * resuelve compatibilidad ni autorización local y nunca envía identidad del
 * cliente como prueba de propiedad. Todo guardado se identifica como
 * simulado con datos ficticios.
 */
export function ProfessionalAvailabilityPage() {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <section aria-labelledby="professional-availability-title">
      <h1 id="professional-availability-title" ref={headingRef} tabIndex={-1}>
        Disponibilidad
      </h1>
      <p>Gestiona tus bloques recurrentes y excepciones con el contrato vigente.</p>
      <p>
        <Link
          to="/profesional/solicitudes"
          className={`${GESTION_ROW} no-underline ${GESTION_FOCUS_VISIBLE}`}
        >
          Volver a solicitudes
        </Link>
      </p>
      <StudentPanelErrorBoundary subject="el editor de disponibilidad" level="section">
        <AvailabilityBody attempt={attempt} onRetry={() => setAttempt((value) => value + 1)} />
      </StudentPanelErrorBoundary>
    </section>
  );
}

function AvailabilityBody({ attempt, onRetry }: { attempt: number; onRetry: () => void }) {
  const result = useProfessionalAvailability(attempt);
  const [extraBlocks, setExtraBlocks] = useState<ReadonlyArray<AvailabilityBlock>>([]);
  const [extraExceptions, setExtraExceptions] = useState<ReadonlyArray<AvailabilityException>>([]);

  if (result === undefined) {
    return (
      <p role="status" className="student-portal__loading">
        Cargando la disponibilidad…
      </p>
    );
  }

  if (result.status === "error") {
    return (
      <div>
        <p role="alert" className="student-portal__error">
          No pudimos cargar la disponibilidad. Inténtalo de nuevo.
        </p>
        <div className="student-portal__cta">
          <button
            type="button"
            className="student-portal__btn student-portal__btn--primary"
            onClick={onRetry}
          >
            Reintentar
          </button>
        </div>
      </div>
    );
  }

  if (result.status === "denied") {
    return (
      <p role="alert" className="student-portal__error">
        No autorizado. Pide acceso por el canal oficial si corresponde.
      </p>
    );
  }

  const blocks = [...(result.status === "ok" ? result.blocks : []), ...extraBlocks];
  const exceptions = [...(result.status === "ok" ? result.exceptions : []), ...extraExceptions];
  const isEmpty =
    result.status === "empty" && extraBlocks.length === 0 && extraExceptions.length === 0;

  return (
    <>
      {isEmpty ? (
        <div className="student-portal__empty">
          <p className="student-portal__empty-title">Sin bloques ni excepciones.</p>
          <p>Cuando registres un bloque recurrente, aparecerá aquí.</p>
        </div>
      ) : null}
      <section aria-labelledby="availability-blocks-title" className="student-portal__section">
        <div className="student-portal__section-head">
          <h2 id="availability-blocks-title">Bloques recurrentes</h2>
        </div>
        {blocks.length === 0 ? (
          <p>No hay bloques registrados.</p>
        ) : (
          <ul className="student-portal__list">
            {blocks.map((block) => (
              <li key={block.id} className="student-portal__item">
                <span className={GESTION_ROW}>
                  <span>{weekdayLabel(block.weekday)}</span>
                  <span>{formatWindowRange(block.startMinute, block.endMinute)}</span>
                  <span>{availabilityModalityLabel(block.modality)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="availability-exceptions-title" className="student-portal__section">
        <div className="student-portal__section-head">
          <h2 id="availability-exceptions-title">Excepciones</h2>
        </div>
        {exceptions.length === 0 ? (
          <p>No hay excepciones registradas.</p>
        ) : (
          <ul className="student-portal__list">
            {exceptions.map((exception, index) => (
              <li key={`${exception.date}-${index}`} className="student-portal__item">
                <ExceptionDetails exception={exception} />
              </li>
            ))}
          </ul>
        )}
      </section>
      <BlockFormSection onSaved={(block) => setExtraBlocks((prev) => [...prev, block])} />
      <ExceptionFormSection
        onSaved={(exception) => setExtraExceptions((prev) => [...prev, exception])}
      />
    </>
  );
}

/**
 * Detalle visible de una excepción (TI2-103): fecha, clase y alcance de la
 * cancelación (día completo o bloque concreto) o ventanas del agregado con
 * horario, duración, modalidad y espacio. Sin el alcance, una cancelación
 * del día y otra de un bloque son indistinguibles, y el agregado pierde sus
 * detalles al limpiarse el formulario.
 */
function ExceptionDetails({ exception }: { exception: AvailabilityException }) {
  return (
    <div>
      <span className={GESTION_ROW}>
        <span>{exception.date}</span>
        <span>{exceptionKindLabel(exception.kind)}</span>
        <span>{exceptionScopeLabel(exception)}</span>
      </span>
      {exception.kind === "added" ? (
        <ul className="student-portal__list">
          {(exception.windows ?? []).map((window, windowIndex) => (
            <li key={windowIndex} className="student-portal__item-meta">
              {formatWindowRange(window.startMinute, window.endMinute)} ·{" "}
              {formatSlotDuration(window.slotMinutes)} ·{" "}
              {availabilityModalityLabel(window.modality)}
              {window.spaceId === undefined ? null : <> · Espacio {window.spaceId}</>}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function BlockFormSection({ onSaved }: { onSaved: (block: AvailabilityBlock) => void }) {
  const [form, setForm] = useState<BlockFormState>(EMPTY_BLOCK_FORM);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);
  const confirmationRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (savedId !== null) {
      confirmationRef.current?.focus();
    }
  }, [savedId]);

  function setField<Key extends keyof BlockFormState>(key: Key, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) {
      return;
    }
    const errors = validateBlockForm(form);
    setFieldErrors(errors);
    setSaveError(null);
    setDenied(false);
    setSavedId(null);
    if (Object.keys(errors).length > 0) {
      return;
    }
    setPending(true);
    try {
      const result = await getAgendaPort().saveBlock(toSaveBlockInput(form));
      if (result.status === "saved") {
        onSaved(result.block);
        setSavedId(result.block.id);
        setForm(EMPTY_BLOCK_FORM);
        setFieldErrors({});
      } else if (result.status === "denied") {
        setDenied(true);
      } else {
        setSaveError(result.error.message);
      }
    } catch {
      setSaveError("No pudimos guardar el bloque. Inténtalo de nuevo.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section aria-labelledby="block-form-title" className="student-portal__section">
      <div className="student-portal__section-head">
        <h2 id="block-form-title">Nuevo bloque recurrente</h2>
      </div>
      <p>Guardado simulado con datos ficticios.</p>
      <form onSubmit={handleSubmit} noValidate>
        <div>
          <label htmlFor="block-weekday">Día de la semana</label>
          <select
            className={GESTION_FIELD_CLASS}
            id="block-weekday"
            value={form.weekday}
            onChange={(event) => setField("weekday", event.target.value)}
            aria-invalid={fieldErrors.weekday !== undefined}
            aria-describedby={fieldErrors.weekday !== undefined ? "block-weekday-error" : undefined}
            disabled={pending}
          >
            <option value="">Elige un día</option>
            <option value="0">Domingo</option>
            <option value="1">Lunes</option>
            <option value="2">Martes</option>
            <option value="3">Miércoles</option>
            <option value="4">Jueves</option>
            <option value="5">Viernes</option>
            <option value="6">Sábado</option>
          </select>
          {fieldErrors.weekday !== undefined ? (
            <p id="block-weekday-error" role="alert" className="student-portal__error">
              {fieldErrors.weekday}
            </p>
          ) : null}
        </div>
        <div>
          <label htmlFor="block-start">Inicio (HH:MM)</label>
          <input
            className={GESTION_FIELD_CLASS}
            id="block-start"
            type="text"
            inputMode="numeric"
            placeholder="09:00"
            value={form.startTime}
            onChange={(event) => setField("startTime", event.target.value)}
            aria-invalid={fieldErrors.startTime !== undefined}
            aria-describedby={fieldErrors.startTime !== undefined ? "block-start-error" : undefined}
            disabled={pending}
          />
          {fieldErrors.startTime !== undefined ? (
            <p id="block-start-error" role="alert" className="student-portal__error">
              {fieldErrors.startTime}
            </p>
          ) : null}
        </div>
        <div>
          <label htmlFor="block-end">Término (HH:MM)</label>
          <input
            className={GESTION_FIELD_CLASS}
            id="block-end"
            type="text"
            inputMode="numeric"
            placeholder="12:00"
            value={form.endTime}
            onChange={(event) => setField("endTime", event.target.value)}
            aria-invalid={fieldErrors.endTime !== undefined}
            aria-describedby={fieldErrors.endTime !== undefined ? "block-end-error" : undefined}
            disabled={pending}
          />
          {fieldErrors.endTime !== undefined ? (
            <p id="block-end-error" role="alert" className="student-portal__error">
              {fieldErrors.endTime}
            </p>
          ) : null}
        </div>
        <div>
          <label htmlFor="block-duration">Duración del cupo (minutos)</label>
          <input
            className={GESTION_FIELD_CLASS}
            id="block-duration"
            type="text"
            inputMode="numeric"
            placeholder="30"
            value={form.slotMinutes}
            onChange={(event) => setField("slotMinutes", event.target.value)}
            aria-invalid={fieldErrors.slotMinutes !== undefined}
            aria-describedby={
              fieldErrors.slotMinutes !== undefined ? "block-duration-error" : undefined
            }
            disabled={pending}
          />
          {fieldErrors.slotMinutes !== undefined ? (
            <p id="block-duration-error" role="alert" className="student-portal__error">
              {fieldErrors.slotMinutes}
            </p>
          ) : null}
        </div>
        <div>
          <label htmlFor="block-modality">Modalidad</label>
          <select
            className={GESTION_FIELD_CLASS}
            id="block-modality"
            value={form.modality}
            onChange={(event) => setField("modality", event.target.value)}
            aria-invalid={fieldErrors.modality !== undefined}
            aria-describedby={
              fieldErrors.modality !== undefined ? "block-modality-error" : undefined
            }
            disabled={pending}
          >
            <option value="">Elige modalidad</option>
            <option value="inPerson">Presencial</option>
            <option value="online">En línea</option>
          </select>
          {fieldErrors.modality !== undefined ? (
            <p id="block-modality-error" role="alert" className="student-portal__error">
              {fieldErrors.modality}
            </p>
          ) : null}
        </div>
        <div>
          <label htmlFor="block-space">Referencia al espacio (solo presencial)</label>
          <input
            className={GESTION_FIELD_CLASS}
            id="block-space"
            type="text"
            placeholder="esp-1"
            value={form.spaceId}
            onChange={(event) => setField("spaceId", event.target.value)}
            aria-invalid={fieldErrors.spaceId !== undefined}
            aria-describedby={fieldErrors.spaceId !== undefined ? "block-space-error" : undefined}
            disabled={pending}
          />
          {fieldErrors.spaceId !== undefined ? (
            <p id="block-space-error" role="alert" className="student-portal__error">
              {fieldErrors.spaceId}
            </p>
          ) : null}
        </div>
        {denied ? (
          <p role="alert" className="student-portal__error">
            No autorizado. Pide acceso por el canal oficial si corresponde.
          </p>
        ) : null}
        {saveError !== null ? (
          <p role="alert" className="student-portal__error">
            {saveError}
          </p>
        ) : null}
        {savedId !== null ? (
          <div>
            <h3 ref={confirmationRef} tabIndex={-1}>
              Bloque guardado
            </h3>
            <p>Código {savedId}. Guardado simulado con datos ficticios.</p>
          </div>
        ) : null}
        <div className="student-portal__cta">
          <button
            type="submit"
            className="student-portal__btn student-portal__btn--primary"
            disabled={pending}
            aria-busy={pending}
          >
            {pending ? "Guardando…" : "Guardar bloque"}
          </button>
        </div>
      </form>
    </section>
  );
}

function ExceptionFormSection({
  onSaved,
}: {
  onSaved: (exception: AvailabilityException) => void;
}) {
  const [form, setForm] = useState<ExceptionFormState>(EMPTY_EXCEPTION_FORM);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [savedException, setSavedException] = useState<AvailabilityException | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);
  const confirmationRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (savedException !== null) {
      confirmationRef.current?.focus();
    }
  }, [savedException]);

  function setField<Key extends keyof ExceptionFormState>(key: Key, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) {
      return;
    }
    const errors = validateExceptionForm(form);
    setFieldErrors(errors);
    setSaveError(null);
    setDenied(false);
    setSavedException(null);
    if (Object.keys(errors).length > 0) {
      return;
    }
    setPending(true);
    try {
      const result = await getAgendaPort().saveException(toSaveExceptionInput(form));
      if (result.status === "saved") {
        onSaved(result.exception);
        setSavedException(result.exception);
        setForm(EMPTY_EXCEPTION_FORM);
        setFieldErrors({});
      } else if (result.status === "denied") {
        setDenied(true);
      } else {
        setSaveError(result.error.message);
      }
    } catch {
      setSaveError("No pudimos guardar la excepción. Inténtalo de nuevo.");
    } finally {
      setPending(false);
    }
  }

  const isAdded = form.kind === "added";

  return (
    <section aria-labelledby="exception-form-title" className="student-portal__section">
      <div className="student-portal__section-head">
        <h2 id="exception-form-title">Nueva excepción</h2>
      </div>
      <p>Guardado simulado con datos ficticios.</p>
      <form onSubmit={handleSubmit} noValidate>
        <div>
          <label htmlFor="exception-date">Fecha (AAAA-MM-DD)</label>
          <input
            className={GESTION_FIELD_CLASS}
            id="exception-date"
            type="text"
            inputMode="numeric"
            placeholder="2026-05-04"
            value={form.date}
            onChange={(event) => setField("date", event.target.value)}
            aria-invalid={fieldErrors.date !== undefined}
            aria-describedby={fieldErrors.date !== undefined ? "exception-date-error" : undefined}
            disabled={pending}
          />
          {fieldErrors.date !== undefined ? (
            <p id="exception-date-error" role="alert" className="student-portal__error">
              {fieldErrors.date}
            </p>
          ) : null}
        </div>
        <div>
          <label htmlFor="exception-kind">Clase</label>
          <select
            className={GESTION_FIELD_CLASS}
            id="exception-kind"
            value={form.kind}
            onChange={(event) => setField("kind", event.target.value)}
            aria-invalid={fieldErrors.kind !== undefined}
            aria-describedby={fieldErrors.kind !== undefined ? "exception-kind-error" : undefined}
            disabled={pending}
          >
            <option value="">Elige clase</option>
            <option value="cancelled">Cancelación</option>
            <option value="added">Agregado</option>
          </select>
          {fieldErrors.kind !== undefined ? (
            <p id="exception-kind-error" role="alert" className="student-portal__error">
              {fieldErrors.kind}
            </p>
          ) : null}
        </div>
        <div>
          <label htmlFor="exception-block">Bloque afectado (solo cancelación puntual)</label>
          <input
            className={GESTION_FIELD_CLASS}
            id="exception-block"
            type="text"
            placeholder="bloque-ficticio-1"
            value={form.blockId}
            onChange={(event) => setField("blockId", event.target.value)}
            aria-invalid={fieldErrors.blockId !== undefined}
            aria-describedby={
              fieldErrors.blockId !== undefined ? "exception-block-error" : undefined
            }
            disabled={pending}
          />
          {fieldErrors.blockId !== undefined ? (
            <p id="exception-block-error" role="alert" className="student-portal__error">
              {fieldErrors.blockId}
            </p>
          ) : null}
        </div>
        {isAdded ? (
          <>
            <div>
              <label htmlFor="exception-start">Inicio del agregado (HH:MM)</label>
              <input
                className={GESTION_FIELD_CLASS}
                id="exception-start"
                type="text"
                inputMode="numeric"
                placeholder="10:00"
                value={form.startTime}
                onChange={(event) => setField("startTime", event.target.value)}
                aria-invalid={fieldErrors.startTime !== undefined}
                aria-describedby={
                  fieldErrors.startTime !== undefined ? "exception-start-error" : undefined
                }
                disabled={pending}
              />
              {fieldErrors.startTime !== undefined ? (
                <p id="exception-start-error" role="alert" className="student-portal__error">
                  {fieldErrors.startTime}
                </p>
              ) : null}
            </div>
            <div>
              <label htmlFor="exception-end">Término del agregado (HH:MM)</label>
              <input
                className={GESTION_FIELD_CLASS}
                id="exception-end"
                type="text"
                inputMode="numeric"
                placeholder="11:00"
                value={form.endTime}
                onChange={(event) => setField("endTime", event.target.value)}
                aria-invalid={fieldErrors.endTime !== undefined}
                aria-describedby={
                  fieldErrors.endTime !== undefined ? "exception-end-error" : undefined
                }
                disabled={pending}
              />
              {fieldErrors.endTime !== undefined ? (
                <p id="exception-end-error" role="alert" className="student-portal__error">
                  {fieldErrors.endTime}
                </p>
              ) : null}
            </div>
            <div>
              <label htmlFor="exception-duration">Duración del cupo (minutos)</label>
              <input
                className={GESTION_FIELD_CLASS}
                id="exception-duration"
                type="text"
                inputMode="numeric"
                placeholder="30"
                value={form.slotMinutes}
                onChange={(event) => setField("slotMinutes", event.target.value)}
                aria-invalid={fieldErrors.slotMinutes !== undefined}
                aria-describedby={
                  fieldErrors.slotMinutes !== undefined ? "exception-duration-error" : undefined
                }
                disabled={pending}
              />
              {fieldErrors.slotMinutes !== undefined ? (
                <p id="exception-duration-error" role="alert" className="student-portal__error">
                  {fieldErrors.slotMinutes}
                </p>
              ) : null}
            </div>
            <div>
              <label htmlFor="exception-modality">Modalidad del agregado</label>
              <select
                className={GESTION_FIELD_CLASS}
                id="exception-modality"
                value={form.modality}
                onChange={(event) => setField("modality", event.target.value)}
                aria-invalid={fieldErrors.modality !== undefined}
                aria-describedby={
                  fieldErrors.modality !== undefined ? "exception-modality-error" : undefined
                }
                disabled={pending}
              >
                <option value="">Elige modalidad</option>
                <option value="inPerson">Presencial</option>
                <option value="online">En línea</option>
              </select>
              {fieldErrors.modality !== undefined ? (
                <p id="exception-modality-error" role="alert" className="student-portal__error">
                  {fieldErrors.modality}
                </p>
              ) : null}
            </div>
            <div>
              <label htmlFor="exception-space">Referencia al espacio (solo presencial)</label>
              <input
                className={GESTION_FIELD_CLASS}
                id="exception-space"
                type="text"
                placeholder="esp-1"
                value={form.spaceId}
                onChange={(event) => setField("spaceId", event.target.value)}
                aria-invalid={fieldErrors.spaceId !== undefined}
                aria-describedby={
                  fieldErrors.spaceId !== undefined ? "exception-space-error" : undefined
                }
                disabled={pending}
              />
              {fieldErrors.spaceId !== undefined ? (
                <p id="exception-space-error" role="alert" className="student-portal__error">
                  {fieldErrors.spaceId}
                </p>
              ) : null}
            </div>
          </>
        ) : null}
        {denied ? (
          <p role="alert" className="student-portal__error">
            No autorizado. Pide acceso por el canal oficial si corresponde.
          </p>
        ) : null}
        {saveError !== null ? (
          <p role="alert" className="student-portal__error">
            {saveError}
          </p>
        ) : null}
        {savedException !== null ? (
          <div>
            <h3 ref={confirmationRef} tabIndex={-1}>
              Excepción guardada
            </h3>
            <ExceptionDetails exception={savedException} />
            <p>Guardado simulado con datos ficticios.</p>
          </div>
        ) : null}
        <div className="student-portal__cta">
          <button
            type="submit"
            className="student-portal__btn student-portal__btn--primary"
            disabled={pending}
            aria-busy={pending}
          >
            {pending ? "Guardando…" : "Guardar excepción"}
          </button>
        </div>
      </form>
    </section>
  );
}
