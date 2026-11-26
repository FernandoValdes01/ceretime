import { useRef, useState } from "react";
import {
  CONFLICT_ERROR_CODE,
  UNAUTHORIZED_ERROR_CODE,
} from "../../../../../convex/domain/index.ts";
import { publicErrorOf } from "../../infrastructure/convex/public-error.ts";
import { ACCESS_DENIED_MESSAGE } from "../shared/view-states.tsx";
import {
  toAccessNeedsDraft,
  toAccessNeedsText,
  type AccessNeedsDraft,
} from "./access-needs-draft.ts";
import { AccessNeedsFields } from "./request-content-fields.tsx";
import { useUpdateAccompanimentNeeds } from "./student-accompaniments-data.ts";
import { PRIMARY_BUTTON_CLASS, SECONDARY_BUTTON_CLASS } from "./student-page-classes.ts";

/**
 * Actualización de las necesidades de acceso del acompañamiento propio
 * (TI2-166) con `updateAccompanimentNeeds` (TI2-156).
 *
 * Explica antes y después de guardar que el cambio rige para las atenciones
 * futuras y que las anteriores conservan lo registrado, como versiona el
 * Backend. Si una atención futura deja de ser compatible, el Backend avisa a
 * su profesional y no la cancela; la pantalla lo dice sin prometer más. La
 * autorización y el estado del acompañamiento los decide el Backend.
 */

const FUTURE_ONLY =
  "El cambio se aplica a tus próximas atenciones. Las atenciones anteriores conservan las necesidades que regían entonces. Si una atención futura deja de ser compatible, avisamos a tu profesional para coordinar una solución; la atención no se cancela.";

const SAVED = "Actualizamos tus necesidades de acceso. Se aplican a tus próximas atenciones.";

function saveErrorMessage(error: unknown): string {
  const code = publicErrorOf(error)?.code;
  if (code === UNAUTHORIZED_ERROR_CODE) return ACCESS_DENIED_MESSAGE;
  if (code === CONFLICT_ERROR_CODE) {
    return "No pudimos actualizar tus necesidades porque el acompañamiento cambió. Recarga la página y vuelve a intentarlo.";
  }
  return "No pudimos actualizar tus necesidades. Inténtalo de nuevo.";
}

export function AccessNeedsEditor({
  accompanimentId,
  currentAccessNeeds,
}: {
  accompanimentId: string;
  currentAccessNeeds: string;
}) {
  const update = useUpdateAccompanimentNeeds();
  const [draft, setDraft] = useState<AccessNeedsDraft | null>(null);
  const [fieldError, setFieldError] = useState<string | undefined>(undefined);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const openButton = useRef<HTMLButtonElement>(null);

  function close(message: string | null) {
    setDraft(null);
    setFieldError(undefined);
    setSaveError(null);
    setNotice(message);
    // El formulario desaparece: el foco vuelve al botón que lo abrió.
    requestAnimationFrame(() => openButton.current?.focus());
  }

  async function save(current: AccessNeedsDraft) {
    if (pending) return;
    const text = toAccessNeedsText(current);
    if (text.status === "error") {
      setFieldError(text.message);
      return;
    }
    setPending(true);
    setFieldError(undefined);
    setSaveError(null);
    try {
      await update({ accompanimentId, accessNeeds: text.text });
      close(SAVED);
    } catch (error) {
      setSaveError(saveErrorMessage(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <section
      aria-labelledby="student-access-needs-title"
      className="flex flex-col gap-4 rounded-lg border border-border-low bg-surface-container-lowest p-6"
    >
      <h2 id="student-access-needs-title" className="m-0 text-xl font-semibold text-on-surface">
        Actualizar tus necesidades de acceso
      </h2>
      <p className="m-0">{FUTURE_ONLY}</p>
      {notice !== null ? <p role="status">{notice}</p> : null}
      {draft === null ? (
        <button
          ref={openButton}
          type="button"
          className={`${SECONDARY_BUTTON_CLASS} w-fit`}
          onClick={() => {
            setNotice(null);
            setDraft(toAccessNeedsDraft(currentAccessNeeds));
          }}
        >
          Actualizar necesidades de acceso
        </button>
      ) : (
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void save(draft);
          }}
        >
          <AccessNeedsFields
            voice="student"
            accessNeedIds={draft.accessNeedIds}
            otherAccessNeed={draft.otherAccessNeed}
            error={fieldError}
            onChange={(changes) => setDraft({ ...draft, ...changes })}
          />
          {saveError !== null ? (
            <p role="alert" className="m-0 font-semibold text-error">
              {saveError}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-3">
            <button
              type="submit"
              className={PRIMARY_BUTTON_CLASS}
              disabled={pending}
              aria-busy={pending}
            >
              Guardar para mis próximas atenciones
            </button>
            <button
              type="button"
              className={SECONDARY_BUTTON_CLASS}
              disabled={pending}
              onClick={() => close(null)}
            >
              Cancelar
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
