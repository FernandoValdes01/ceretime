import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { StudentPanelErrorBoundary } from "../routes/student-portal.tsx";
import "../routes/student-portal.css";
import { availabilityModalityLabel } from "./professional-availability-labels.ts";
import { getAgendaPort } from "./professional-availability-data.ts";
import {
  toSaveSpaceInput,
  toSpaceForm,
  useSpaceCatalog,
  validateSpaceForm,
  EMPTY_SPACE_FORM,
  type SpaceFormState,
} from "./admin-space-editor-data.ts";
import { toSpaceLabel, type Space } from "../../../../../convex/domain/index.ts";

/**
 * Clases Tailwind de las filas y campos de gestión (TI2-103): 44px de alto
 * táctil mínimo, foco visible de 3px según DESIGN.md y reflujo en ventanas
 * estrechas. `flex-wrap` evita que la fila imponga su ancho de contenido y
 * `min-w-0` permite que la cuadrícula del portal la contraiga sin
 * desbordar la página.
 */
const GESTION_ROW = "flex flex-wrap items-center gap-2 min-h-[44px] min-w-0 px-3 py-2 text-inherit";
const GESTION_FOCUS_VISIBLE =
  "focus-visible:outline-[3px] focus-visible:outline-solid focus-visible:outline-focus-ring focus-visible:outline-offset-[2px]";

/**
 * Campos de gestión (TI2-04): alto táctil mínimo de 44px, ancho fluido y
 * `min-w-0` para que la cuadrícula estrecha los contraiga, con el mismo
 * foco visible de las filas. Los formularios apilan los campos en columna.
 */
const GESTION_FIELD = "min-h-[44px] w-full min-w-0 box-border px-3 py-2 text-base text-inherit";
const GESTION_FIELD_CLASS = `${GESTION_FIELD} ${GESTION_FOCUS_VISIBLE}`;

/**
 * Cuadros de texto de condiciones e instrucciones (TI2-04): de varias líneas
 * porque el texto accesible de llegada suele necesitar más espacio, con el
 * mismo ancho fluido y foco visible que los campos simples.
 */
const GESTION_TEXTAREA =
  "min-h-32 w-full min-w-0 box-border resize-y px-3 py-2 text-base text-inherit";
const GESTION_TEXTAREA_CLASS = `${GESTION_TEXTAREA} ${GESTION_FOCUS_VISIBLE}`;

/**
 * Editor de espacios del Administrador (TI2-04).
 *
 * Interfaz tipada sobre los campos del contrato del catálogo v1, sin otra
 * entidad rooms/locations: ubicación física (campus, edificio, piso y sala)
 * y condiciones e instrucciones de acceso legibles por lector de pantalla.
 * Lee y guarda por el puerto común de agenda con el adaptador ficticio de
 * TI2-103; la escritura real del catálogo no está entregada (TI2-99 entrega
 * lectura, no escritura), así que todo guardado se identifica como simulado
 * con datos ficticios y no anuncia persistencia real. La modalidad se
 * muestra con los valores canónicos del dominio: los espacios aplican a la
 * atención presencial y no existe representación híbrida.
 */
export function AdminSpaceEditorPage() {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <section aria-labelledby="admin-space-editor-title">
      <h1 id="admin-space-editor-title" ref={headingRef} tabIndex={-1}>
        Espacios de atención
      </h1>
      <p>
        Edita la ubicación física, las condiciones de acceso y las instrucciones de llegada de cada
        espacio con el contrato vigente.
      </p>
      <p>
        Los datos son ficticios y el guardado es simulado: la escritura real del catálogo no está
        entregada.
      </p>
      <p>
        <Link
          to="/administrador"
          className={`${GESTION_ROW} no-underline ${GESTION_FOCUS_VISIBLE}`}
        >
          Volver al inicio
        </Link>
      </p>
      <StudentPanelErrorBoundary subject="el editor de espacios" level="section">
        <SpaceEditorBody attempt={attempt} onRetry={() => setAttempt((value) => value + 1)} />
      </StudentPanelErrorBoundary>
    </section>
  );
}

function SpaceEditorBody({ attempt, onRetry }: { attempt: number; onRetry: () => void }) {
  const result = useSpaceCatalog(attempt);
  const [savedSpaces, setSavedSpaces] = useState<ReadonlyArray<Space>>([]);
  const [editing, setEditing] = useState<Space | null>(null);
  const [savedSpace, setSavedSpace] = useState<Space | null>(null);
  // Generación del formulario en modo nuevo: cada creación confirmada avanza
  // el contador y remonta el formulario vacío, así el reenvío posterior ya
  // no lleva los datos de la creación anterior.
  const [formGeneration, setFormGeneration] = useState(0);
  // Espejo del modo de edición vigente: la respuesta de un guardado puede
  // llegar cuando la edición activa ya cambió, y la comparación por
  // identidad debe usar el estado vigente, no el capturado por la llamada
  // pendiente de una instancia remontada.
  const editingRef = useRef<Space | null>(editing);
  const formHeadingRef = useRef<HTMLHeadingElement>(null);
  const confirmationRef = useRef<HTMLHeadingElement>(null);
  const mounted = useRef(false);

  useEffect(() => {
    editingRef.current = editing;
  }, [editing]);

  // El cambio de modo (nuevo/editar) se anuncia moviendo el foco al
  // encabezado del formulario una vez actualizado su texto; el montaje
  // inicial lo reserva al título de la página.
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    formHeadingRef.current?.focus();
  }, [editing]);

  useEffect(() => {
    if (savedSpace !== null) {
      confirmationRef.current?.focus();
    }
  }, [savedSpace]);

  if (result === undefined) {
    return (
      <p role="status" className="student-portal__loading">
        Cargando los espacios…
      </p>
    );
  }

  if (result.status === "error") {
    return (
      <div>
        <p role="alert" className="student-portal__error">
          No pudimos cargar los espacios. Inténtalo de nuevo.
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

  // Catálogo vigente: la lectura fija la base y cada guardado simulado
  // reemplaza el espacio editado o agrega el nuevo, sin persistencia real.
  let catalog: ReadonlyArray<Space> = result.status === "ok" ? [...result.spaces] : [];
  for (const saved of savedSpaces) {
    catalog = applySavedSpace(catalog, saved);
  }
  const isEmpty = result.status === "empty" && catalog.length === 0;

  return (
    <>
      {isEmpty ? (
        <div className="student-portal__empty">
          <p className="student-portal__empty-title">Sin espacios registrados.</p>
          <p>Cuando registres un espacio, aparecerá aquí.</p>
        </div>
      ) : null}
      <section aria-labelledby="spaces-catalog-title" className="student-portal__section">
        <div className="student-portal__section-head">
          <h2 id="spaces-catalog-title">Espacios registrados</h2>
        </div>
        {catalog.length === 0 ? (
          <p>No hay espacios registrados.</p>
        ) : (
          <ul className="student-portal__list">
            {catalog.map((space) => (
              <li key={space.id} className="student-portal__item">
                <span className={GESTION_ROW}>
                  <span>{toSpaceLabel(space)}</span>
                  <span>{availabilityModalityLabel("inPerson")}</span>
                </span>
                <p className="student-portal__item-meta">
                  Condiciones de acceso: {space.accessConditions}
                </p>
                <p className="student-portal__item-meta">
                  Instrucciones de llegada: {space.arrivalInstructions}
                </p>
                <div className="student-portal__cta">
                  <button
                    type="button"
                    className="student-portal__btn student-portal__btn--ghost"
                    onClick={() => setEditing(space)}
                  >
                    Editar espacio {space.id}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      {savedSpace !== null ? (
        <div>
          <h3 ref={confirmationRef} tabIndex={-1}>
            Espacio guardado
          </h3>
          <p>
            Código {savedSpace.id}. Guardado simulado con datos ficticios; la escritura real del
            catálogo no está entregada.
          </p>
          <p className="student-portal__item-meta">{toSpaceLabel(savedSpace)}</p>
          <p className="student-portal__item-meta">
            Condiciones de acceso: {savedSpace.accessConditions}
          </p>
          <p className="student-portal__item-meta">
            Instrucciones de llegada: {savedSpace.arrivalInstructions}
          </p>
        </div>
      ) : null}
      <SpaceFormSection
        // El cambio de modo remonta el formulario: nuevo parte vacío y la
        // edición parte de los campos del contrato del espacio elegido. La
        // generación avanza al confirmar una creación para que el siguiente
        // envío también parta vacío sin abandonar el modo nuevo.
        key={editing === null ? `nuevo-${formGeneration}` : editing.id}
        editing={editing}
        formHeadingRef={formHeadingRef}
        onSaveStart={() => setSavedSpace(null)}
        onSaved={(space, savedFor) => {
          setSavedSpaces((prev) => applySavedSpace(prev, space));
          // La confirmación y la salida del modo edición solo aplican cuando
          // la respuesta corresponde a la edición vigente: la respuesta
          // tardía de un guardado anterior no descarta el borrador activo.
          if (savedFor === (editingRef.current?.id ?? null)) {
            setSavedSpace(space);
            setEditing(null);
            setFormGeneration((value) => value + 1);
          }
        }}
        onCancelEdit={() => setEditing(null)}
      />
    </>
  );
}

/**
 * Aplica un guardado simulado al catálogo visible: reemplaza el espacio con
 * la misma identidad o agrega el nuevo al final.
 */
function applySavedSpace(current: ReadonlyArray<Space>, saved: Space): ReadonlyArray<Space> {
  const index = current.findIndex((item) => item.id === saved.id);
  if (index === -1) {
    return [...current, saved];
  }
  return current.map((item, position) => (position === index ? saved : item));
}

function SpaceFormSection({
  editing,
  formHeadingRef,
  onSaveStart,
  onSaved,
  onCancelEdit,
}: {
  editing: Space | null;
  formHeadingRef: React.RefObject<HTMLHeadingElement | null>;
  onSaveStart: () => void;
  onSaved: (space: Space, savedFor: string | null) => void;
  onCancelEdit: () => void;
}) {
  const [form, setForm] = useState<SpaceFormState>(() =>
    editing === null ? EMPTY_SPACE_FORM : toSpaceForm(editing),
  );
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  // Bloqueo síncrono de envíos: el estado de espera aún no se aplica dentro
  // del mismo tick, así que el reenvío simultáneo se corta por referencia.
  const pendingRef = useRef(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);

  function setField<Key extends keyof SpaceFormState>(key: Key, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (pendingRef.current) {
      return;
    }
    // Cada envío parte de cero: limpia la confirmación anterior del cuerpo
    // y los estados locales antes de validar.
    onSaveStart();
    const errors = validateSpaceForm(form);
    setFieldErrors(errors);
    setSaveError(null);
    setDenied(false);
    if (Object.keys(errors).length > 0) {
      return;
    }
    // El envío declara a qué edición responde: el cuerpo compara esa
    // identidad con el modo de edición vigente al llegar la respuesta.
    const savedFor = editing?.id ?? null;
    pendingRef.current = true;
    setPending(true);
    try {
      const result = await getAgendaPort().saveSpace(toSaveSpaceInput(form, savedFor));
      if (result.status === "saved") {
        onSaved(result.space, savedFor);
      } else if (result.status === "denied") {
        setDenied(true);
      } else {
        setSaveError(result.error.message);
      }
    } catch {
      setSaveError("No pudimos guardar el espacio. Inténtalo de nuevo.");
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  return (
    <section aria-labelledby="space-form-title" className="student-portal__section">
      <div className="student-portal__section-head">
        <h2 id="space-form-title" ref={formHeadingRef} tabIndex={-1}>
          {editing === null ? "Nuevo espacio" : "Editar espacio"}
        </h2>
        {editing !== null ? (
          <button
            type="button"
            className="student-portal__btn student-portal__btn--ghost"
            onClick={onCancelEdit}
          >
            Cancelar edición
          </button>
        ) : null}
      </div>
      {editing !== null ? <p>Estás editando {toSpaceLabel(editing)}.</p> : null}
      <p>Guardado simulado con datos ficticios.</p>
      <p id="space-modality-note" className="student-portal__hint">
        Modalidad: {availabilityModalityLabel("inPerson")}. Los espacios de atención son el lugar de
        las atenciones presenciales; la modalidad en línea no usa espacio.
      </p>
      <form onSubmit={handleSubmit} noValidate>
        <div>
          <label htmlFor="space-campus">Campus</label>
          <input
            className={GESTION_FIELD_CLASS}
            id="space-campus"
            type="text"
            value={form.campus}
            onChange={(event) => setField("campus", event.target.value)}
            aria-invalid={fieldErrors.campus !== undefined}
            aria-describedby={fieldErrors.campus !== undefined ? "space-campus-error" : undefined}
            disabled={pending}
          />
          {fieldErrors.campus !== undefined ? (
            <p id="space-campus-error" role="alert" className="student-portal__error">
              {fieldErrors.campus}
            </p>
          ) : null}
        </div>
        <div>
          <label htmlFor="space-building">Edificio</label>
          <input
            className={GESTION_FIELD_CLASS}
            id="space-building"
            type="text"
            value={form.building}
            onChange={(event) => setField("building", event.target.value)}
            aria-invalid={fieldErrors.building !== undefined}
            aria-describedby={
              fieldErrors.building !== undefined ? "space-building-error" : undefined
            }
            disabled={pending}
          />
          {fieldErrors.building !== undefined ? (
            <p id="space-building-error" role="alert" className="student-portal__error">
              {fieldErrors.building}
            </p>
          ) : null}
        </div>
        <div>
          <label htmlFor="space-floor">Piso</label>
          <input
            className={GESTION_FIELD_CLASS}
            id="space-floor"
            type="text"
            value={form.floor}
            onChange={(event) => setField("floor", event.target.value)}
            aria-invalid={fieldErrors.floor !== undefined}
            aria-describedby={fieldErrors.floor !== undefined ? "space-floor-error" : undefined}
            disabled={pending}
          />
          {fieldErrors.floor !== undefined ? (
            <p id="space-floor-error" role="alert" className="student-portal__error">
              {fieldErrors.floor}
            </p>
          ) : null}
        </div>
        <div>
          <label htmlFor="space-room">Sala</label>
          <input
            className={GESTION_FIELD_CLASS}
            id="space-room"
            type="text"
            value={form.room}
            onChange={(event) => setField("room", event.target.value)}
            aria-invalid={fieldErrors.room !== undefined}
            aria-describedby={fieldErrors.room !== undefined ? "space-room-error" : undefined}
            disabled={pending}
          />
          {fieldErrors.room !== undefined ? (
            <p id="space-room-error" role="alert" className="student-portal__error">
              {fieldErrors.room}
            </p>
          ) : null}
        </div>
        <div>
          <label htmlFor="space-access">Condiciones de acceso</label>
          <textarea
            className={GESTION_TEXTAREA_CLASS}
            id="space-access"
            rows={3}
            value={form.accessConditions}
            onChange={(event) => setField("accessConditions", event.target.value)}
            aria-invalid={fieldErrors.accessConditions !== undefined}
            aria-describedby={
              fieldErrors.accessConditions !== undefined ? "space-access-error" : undefined
            }
            disabled={pending}
          />
          {fieldErrors.accessConditions !== undefined ? (
            <p id="space-access-error" role="alert" className="student-portal__error">
              {fieldErrors.accessConditions}
            </p>
          ) : null}
        </div>
        <div>
          <label htmlFor="space-arrival">Instrucciones de llegada</label>
          <textarea
            className={GESTION_TEXTAREA_CLASS}
            id="space-arrival"
            rows={3}
            value={form.arrivalInstructions}
            onChange={(event) => setField("arrivalInstructions", event.target.value)}
            aria-invalid={fieldErrors.arrivalInstructions !== undefined}
            aria-describedby={
              fieldErrors.arrivalInstructions !== undefined ? "space-arrival-error" : undefined
            }
            disabled={pending}
          />
          {fieldErrors.arrivalInstructions !== undefined ? (
            <p id="space-arrival-error" role="alert" className="student-portal__error">
              {fieldErrors.arrivalInstructions}
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
        <div className="student-portal__cta">
          <button
            type="submit"
            className="student-portal__btn student-portal__btn--primary"
            disabled={pending}
            aria-busy={pending}
          >
            {pending ? "Guardando…" : "Guardar espacio"}
          </button>
        </div>
      </form>
    </section>
  );
}
