import { useEffect, useRef, useState, type ReactNode } from "react";
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
 * 44px de alto táctil mínimo, foco visible de 3px según DESIGN.md y
 * reflujo en ventanas estrechas (TI2-103). `flex-wrap` evita que la fila
 * imponga su ancho de contenido y `min-w-0` permite que la cuadrícula del
 * portal la contraiga sin desbordar la página.
 */
const GESTION_ROW = "flex flex-wrap items-center gap-2 min-h-[44px] min-w-0 px-3 py-2 text-inherit";
const GESTION_FOCUS_VISIBLE =
  "focus-visible:outline-[3px] focus-visible:outline-solid focus-visible:outline-focus-ring focus-visible:outline-offset-[2px]";

/**
 * Enlace de retorno: verde y subrayado como el de la agenda. El subrayado es
 * lo que lo distingue del texto normal, porque el color solo no alcanza a
 * separarlo con visión borrosa o bajo contraste. Mide lo que su contenido y
 * mantiene 44px de alto táctil mínimo.
 */
const GESTION_BACK_LINK = `flex min-h-[44px] w-fit items-center gap-1 rounded-[0.5rem] text-base font-semibold text-primary underline ${GESTION_FOCUS_VISIBLE}`;

/**
 * Campos de gestión (TI2-103): alto táctil mínimo de 44px, ancho fluido y
 * `min-w-0` para que la cuadrícula estrecha los contraiga, con el mismo
 * foco visible de las filas. Según DESIGN.md llevan borde de 1px para
 * reconocerse antes del foco; el error lo vuelve rojo además del mensaje. El
 * color va en una sola clase porque dos competirían en el mismo elemento.
 */
const GESTION_FIELD = `min-h-[44px] w-full min-w-0 box-border rounded-[0.5rem] border bg-surface-container-lowest px-3 py-2 text-base text-on-surface ${GESTION_FOCUS_VISIBLE}`;

function fieldClass(error: string | undefined): string {
  return `${GESTION_FIELD} ${error === undefined ? "border-outline" : "border-error"}`;
}

/** Formularios en columna con la etiqueta visible arriba de cada campo. */
const GESTION_FORM =
  "mt-4 flex flex-col gap-4 [&_label]:mb-2 [&_label]:block [&_label]:text-sm [&_label]:font-semibold";

const FOCUSABLE_IN_DIALOG =
  'select:not([disabled]), input:not([disabled]), textarea:not([disabled]), button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

/**
 * Editor de bloques recurrentes y excepciones del Profesional
 * (TI2-103/TI2-125).
 *
 * Interfaz tipada con validación de formato, sin duplicar reglas del Backend.
 * Lee y guarda por el puerto común de agenda contra
 * `api.presentation.availability`; no escribe base de datos, no resuelve
 * compatibilidad ni autorización local y nunca envía identidad del cliente
 * como prueba de propiedad. El catálogo de espacios que se referencia sigue
 * siendo simulado hasta TI2-104. Crear es una acción aparte de consultar: los
 * botones del inicio abren cada formulario en un diálogo y al fondo de la
 * vista no queda ninguno desplegado.
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
        <Link to="/profesional/solicitudes" className={GESTION_BACK_LINK}>
          <span aria-hidden="true">←</span> Volver a solicitudes
        </Link>
      </p>
      <StudentPanelErrorBoundary subject="el editor de disponibilidad" level="section">
        <AvailabilityBody attempt={attempt} onRetry={() => setAttempt((value) => value + 1)} />
      </StudentPanelErrorBoundary>
    </section>
  );
}

type OpenForm = "block" | "exception" | null;

type SavedConfirmation =
  | { readonly kind: "block"; readonly id: string }
  | { readonly kind: "exception"; readonly exception: AvailabilityException };

function AvailabilityBody({ attempt, onRetry }: { attempt: number; onRetry: () => void }) {
  const result = useProfessionalAvailability(attempt);
  const [extraBlocks, setExtraBlocks] = useState<ReadonlyArray<AvailabilityBlock>>([]);
  const [extraExceptions, setExtraExceptions] = useState<ReadonlyArray<AvailabilityException>>([]);
  const [openForm, setOpenForm] = useState<OpenForm>(null);
  const [confirmation, setConfirmation] = useState<SavedConfirmation | null>(null);
  const newBlockRef = useRef<HTMLButtonElement>(null);
  const newExceptionRef = useRef<HTMLButtonElement>(null);
  const confirmationRef = useRef<HTMLHeadingElement>(null);

  // Al cerrar, el foco va a la confirmación si se guardó y, si se canceló, al
  // botón que abrió el diálogo. Se resuelve tras el commit porque hasta
  // entonces ni la confirmación existe ni el diálogo soltó el foco.
  const previousForm = useRef<OpenForm>(null);
  useEffect(() => {
    const closed = previousForm.current;
    previousForm.current = openForm;
    if (openForm !== null || closed === null) {
      return;
    }
    if (confirmationRef.current !== null) {
      confirmationRef.current.focus();
    } else if (closed === "block") {
      newBlockRef.current?.focus();
    } else {
      newExceptionRef.current?.focus();
    }
  }, [openForm]);

  function openFormDialog(form: Exclude<OpenForm, null>) {
    setConfirmation(null);
    setOpenForm(form);
  }

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
      <div className="mt-4 flex flex-col justify-center gap-3 sm:flex-row sm:flex-wrap">
        <button
          ref={newBlockRef}
          type="button"
          className="student-portal__btn student-portal__btn--primary"
          onClick={() => openFormDialog("block")}
        >
          Nuevo bloque
        </button>
        <button
          ref={newExceptionRef}
          type="button"
          className="student-portal__btn student-portal__btn--primary"
          onClick={() => openFormDialog("exception")}
        >
          Nueva excepción
        </button>
      </div>
      {confirmation !== null ? (
        <div className="student-portal__empty student-portal__empty--green" role="status">
          <h2 ref={confirmationRef} tabIndex={-1}>
            {confirmation.kind === "block" ? "Bloque guardado" : "Excepción guardada"}
          </h2>
          {confirmation.kind === "block" ? (
            <p>Código {confirmation.id}. Guardado confirmado por el Backend.</p>
          ) : (
            <>
              <ExceptionDetails exception={confirmation.exception} />
              <p>Guardado confirmado por el Backend.</p>
            </>
          )}
        </div>
      ) : null}
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
      {openForm === "block" ? (
        <BlockFormDialog
          onCancel={() => setOpenForm(null)}
          onSaved={(block) => {
            setExtraBlocks((prev) => [...prev, block]);
            setConfirmation({ kind: "block", id: block.id });
            setOpenForm(null);
          }}
        />
      ) : null}
      {openForm === "exception" ? (
        <ExceptionFormDialog
          onCancel={() => setOpenForm(null)}
          onSaved={(exception) => {
            setExtraExceptions((prev) => [...prev, exception]);
            setConfirmation({ kind: "exception", exception });
            setOpenForm(null);
          }}
        />
      ) : null}
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

/**
 * Diálogo modal de un formulario (mismo patrón que el de TI2-92): al abrir
 * enfoca el primer campo, Tab no sale del diálogo y Escape cierra. Escucha en
 * el documento porque deshabilitar el botón mientras se guarda suelta el foco
 * y el teclado debe seguir funcionando. En pantalla estrecha el contenido
 * desplaza dentro del diálogo, sin desbordar la página.
 */
function FormDialog({
  titleId,
  title,
  onClose,
  children,
}: {
  titleId: string;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE_IN_DIALOG)?.focus();
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      const dialog = dialogRef.current;
      if (event.key !== "Tab" || dialog === null) {
        return;
      }
      const targets = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_IN_DIALOG));
      if (targets.length === 0) {
        return;
      }
      const first = targets[0];
      const last = targets[targets.length - 1];
      const active = document.activeElement;
      if (!dialog.contains(active)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div
        ref={dialogRef}
        className="box-border max-h-full w-full max-w-lg overflow-y-auto rounded-lg border border-(--ct-line) bg-(--ct-card) p-6 text-left shadow-[0_10px_25px_-5px_rgb(0_0_0/0.1),0_8px_10px_-6px_rgb(0_0_0/0.1)]"
      >
        <h2 id={titleId}>{title}</h2>
        <p>Se guarda en el Backend.</p>
        {children}
      </div>
    </div>
  );
}

/** Mientras se guarda, Escape no cierra: el resultado aún no se conoce. */
function ignoreClose() {}

/** Acciones del diálogo: cancelar vuelve al listado sin guardar. */
function FormDialogActions({
  pending,
  saveLabel,
  onCancel,
}: {
  pending: boolean;
  saveLabel: string;
  onCancel: () => void;
}) {
  return (
    <div className="mt-2 flex flex-wrap justify-end gap-3">
      <button
        type="button"
        className="student-portal__btn student-portal__btn--ghost disabled:cursor-not-allowed disabled:opacity-60"
        onClick={onCancel}
        disabled={pending}
      >
        Cancelar
      </button>
      <button
        type="submit"
        className="student-portal__btn student-portal__btn--primary"
        disabled={pending}
        aria-busy={pending}
      >
        {pending ? "Guardando…" : saveLabel}
      </button>
    </div>
  );
}

/** Lleva el foco al primer campo inválido para que el error quede a la vista. */
function useFocusFirstInvalid(fieldErrors: Record<string, string>) {
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (Object.keys(fieldErrors).length > 0) {
      formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
    }
  }, [fieldErrors]);
  return formRef;
}

function BlockFormDialog({
  onSaved,
  onCancel,
}: {
  onSaved: (block: AvailabilityBlock) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<BlockFormState>(EMPTY_BLOCK_FORM);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);
  const formRef = useFocusFirstInvalid(fieldErrors);

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
    if (Object.keys(errors).length > 0) {
      return;
    }
    setPending(true);
    try {
      const result = await getAgendaPort().saveBlock(toSaveBlockInput(form));
      if (result.status === "saved") {
        onSaved(result.block);
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
    <FormDialog
      titleId="block-form-title"
      title="Nuevo bloque recurrente"
      onClose={pending ? ignoreClose : onCancel}
    >
      <form ref={formRef} className={GESTION_FORM} onSubmit={handleSubmit} noValidate>
        <div>
          <label htmlFor="block-weekday">Día de la semana</label>
          <select
            className={fieldClass(fieldErrors.weekday)}
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
            className={fieldClass(fieldErrors.startTime)}
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
            className={fieldClass(fieldErrors.endTime)}
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
            className={fieldClass(fieldErrors.slotMinutes)}
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
            className={fieldClass(fieldErrors.modality)}
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
            className={fieldClass(fieldErrors.spaceId)}
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
        <FormDialogActions pending={pending} saveLabel="Guardar bloque" onCancel={onCancel} />
      </form>
    </FormDialog>
  );
}

function ExceptionFormDialog({
  onSaved,
  onCancel,
}: {
  onSaved: (exception: AvailabilityException) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<ExceptionFormState>(EMPTY_EXCEPTION_FORM);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);
  const formRef = useFocusFirstInvalid(fieldErrors);

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
    if (Object.keys(errors).length > 0) {
      return;
    }
    setPending(true);
    try {
      const result = await getAgendaPort().saveException(toSaveExceptionInput(form));
      if (result.status === "saved") {
        onSaved(result.exception);
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
    <FormDialog
      titleId="exception-form-title"
      title="Nueva excepción"
      onClose={pending ? ignoreClose : onCancel}
    >
      <form ref={formRef} className={GESTION_FORM} onSubmit={handleSubmit} noValidate>
        <div>
          <label htmlFor="exception-date">Fecha (AAAA-MM-DD)</label>
          <input
            className={fieldClass(fieldErrors.date)}
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
            className={fieldClass(fieldErrors.kind)}
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
            className={fieldClass(fieldErrors.blockId)}
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
                className={fieldClass(fieldErrors.startTime)}
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
                className={fieldClass(fieldErrors.endTime)}
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
                className={fieldClass(fieldErrors.slotMinutes)}
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
                className={fieldClass(fieldErrors.modality)}
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
                className={fieldClass(fieldErrors.spaceId)}
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
        <FormDialogActions pending={pending} saveLabel="Guardar excepción" onCancel={onCancel} />
      </form>
    </FormDialog>
  );
}
