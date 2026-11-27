import { useState } from "react";
import {
  CONFLICT_ERROR_CODE,
  UNAUTHORIZED_ERROR_CODE,
  type AccompanimentStatus,
} from "../../../../../convex/domain/index.ts";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { publicErrorOf } from "../../infrastructure/convex/public-error.ts";
import { formatPanelDate } from "../routes/student-panel-labels.ts";
import { ACCESS_DENIED_MESSAGE, DeniedState, LoadingState } from "../shared/view-states.tsx";
import { GESTION_FOCUS_VISIBLE } from "./assigned-accompaniments-list.tsx";
import { isAuthorizationDenial } from "../shared/authorization-denial.ts";
import {
  useAccompanimentProfessionals,
  useAssignAccompanimentAccess,
  useRevokeAccompanimentAccess,
  type AccompanimentProfessionals,
} from "./professional-accompaniments-data.ts";

/**
 * Cambio de profesionales del acompañamiento (TI2-152, TI2-165).
 *
 * Muestra quién está asignado (ASIGNACIONES_PROFESIONALES del MER) y permite
 * asignar a otro profesional de personal o retirar a uno, con las operaciones
 * de TI2-140. Retirar pide confirmación, porque quien se retira pierde el
 * acceso en la consulta siguiente. A quien no se puede retirar (`removable`)
 * no se le ofrece: el Backend lo rechaza mientras el acompañamiento no esté
 * cerrado, porque nadie más podría gestionarlo, y la Web no repite la regla.
 * Un acompañamiento cerrado solo muestra la lista: el criterio de TI2-165
 * pide que no ofrezca acciones de cambio, aunque el Backend todavía admita
 * retirar. La autorización la decide el Backend.
 */

const FIELD = `min-h-[44px] w-full min-w-0 box-border rounded-[0.5rem] border border-outline bg-surface-container-lowest px-3 py-2 text-base text-on-surface ${GESTION_FOCUS_VISIBLE}`;
const LABEL = "mb-2 block text-sm font-semibold text-on-surface";

const DEFAULT_ERROR = "No pudimos completar el cambio. Inténtalo de nuevo.";

function changeErrorMessage(error: unknown): string {
  const publicError = publicErrorOf(error);
  if (publicError?.code === UNAUTHORIZED_ERROR_CODE) return ACCESS_DENIED_MESSAGE;
  if (publicError?.code === CONFLICT_ERROR_CODE) {
    return "El acompañamiento o sus asignaciones cambiaron. Revisa la lista y vuelve a intentarlo.";
  }
  return DEFAULT_ERROR;
}

export function AccompanimentProfessionalsSection({
  accompanimentId,
  status,
}: {
  accompanimentId: Id<"accompaniments">;
  status: AccompanimentStatus;
}) {
  return (
    <section
      aria-labelledby="accompaniment-professionals-title"
      className="student-portal__section"
    >
      <div className="student-portal__section-head">
        <h2 id="accompaniment-professionals-title">Profesionales del acompañamiento</h2>
      </div>
      <ProfessionalsBody accompanimentId={accompanimentId} status={status} />
    </section>
  );
}

function ProfessionalsBody({
  accompanimentId,
  status,
}: {
  accompanimentId: Id<"accompaniments">;
  status: AccompanimentStatus;
}) {
  let professionals: AccompanimentProfessionals | undefined;
  try {
    // Hook primero y en todos los renders: el try solo clasifica el error.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    professionals = useAccompanimentProfessionals(accompanimentId);
  } catch (error) {
    if (isAuthorizationDenial(error)) {
      return <DeniedState title="No tienes acceso a los profesionales de este acompañamiento." />;
    }
    throw error;
  }

  if (professionals === undefined) {
    return <LoadingState label="Cargando los profesionales…" />;
  }
  return (
    <ProfessionalsEditor
      accompanimentId={accompanimentId}
      status={status}
      professionals={professionals}
    />
  );
}

function ProfessionalsEditor({
  accompanimentId,
  status,
  professionals,
}: {
  accompanimentId: Id<"accompaniments">;
  status: AccompanimentStatus;
  professionals: AccompanimentProfessionals;
}) {
  const assign = useAssignAccompanimentAccess();
  const revoke = useRevokeAccompanimentAccess();
  const [selected, setSelected] = useState("");
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<unknown>, done: string) {
    if (pending) return;
    setPending(true);
    setNotice(null);
    setError(null);
    try {
      await action();
      setNotice(done);
      setSelected("");
      setConfirmingId(null);
    } catch (caught) {
      setError(changeErrorMessage(caught));
    } finally {
      setPending(false);
    }
  }

  const chosen = professionals.assignable.find((item) => item.userId === selected);

  return (
    <div className="flex flex-col gap-4 wrap-anywhere">
      {notice !== null ? <p role="status">{notice}</p> : null}
      {error !== null ? (
        <p role="alert" className="student-portal__error">
          {error}
        </p>
      ) : null}
      {professionals.assigned.length === 0 ? (
        <p>Este acompañamiento no tiene profesionales asignados.</p>
      ) : (
        <ul className="m-0 grid list-none gap-3 p-0">
          {professionals.assigned.map((professional) => (
            <li
              key={professional.userId}
              className="flex flex-col gap-2 rounded-lg border border-border-low p-4"
            >
              <p className="m-0 text-base font-semibold wrap-anywhere">
                {professional.fullName}
                {professional.isCaller ? " (tú)" : ""}
              </p>
              {professional.assignedAt === undefined ? null : (
                <p className="m-0 text-sm text-on-surface-variant">
                  Fecha de asignación: {formatPanelDate(professional.assignedAt)}
                </p>
              )}
              {status === "closed" ? null : !professional.removable ? (
                <p className="m-0 text-sm text-on-surface-variant">
                  {professional.isCaller
                    ? "Nadie más puede gestionar este acompañamiento. Para retirarte, primero asigna a otro profesional."
                    : `Nadie más puede gestionar este acompañamiento. Para retirar a ${professional.fullName}, primero asigna a otro profesional.`}
                </p>
              ) : confirmingId === professional.userId ? (
                <div className="flex flex-col gap-2">
                  <p className="m-0">
                    {professional.isCaller
                      ? "Si te retiras, dejas de ver este acompañamiento en cuanto se confirme."
                      : `${professional.fullName} dejará de ver este acompañamiento. Sus atenciones futuras siguen a su nombre.`}
                  </p>
                  <div className="student-portal__cta">
                    <button
                      type="button"
                      className="student-portal__btn student-portal__btn--primary"
                      disabled={pending}
                      aria-busy={pending}
                      onClick={() =>
                        void run(
                          () =>
                            revoke({
                              accompanimentId,
                              userId: professional.userId,
                              assignedRole: "professional",
                            }),
                          `Se retiró la asignación de ${professional.fullName}.`,
                        )
                      }
                    >
                      Confirmar el retiro
                    </button>
                    <button
                      type="button"
                      className="student-portal__btn student-portal__btn--ghost"
                      disabled={pending}
                      onClick={() => setConfirmingId(null)}
                    >
                      No retirar
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  className="student-portal__btn student-portal__btn--ghost w-fit max-w-full wrap-anywhere"
                  disabled={pending}
                  onClick={() => {
                    setNotice(null);
                    setError(null);
                    setConfirmingId(professional.userId);
                  }}
                >
                  {professional.isCaller ? "Retirarme" : `Retirar a ${professional.fullName}`}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {status === "closed" ? (
        <p>El acompañamiento está cerrado: su equipo ya no cambia.</p>
      ) : professionals.assignable.length === 0 ? (
        <p>No hay otros profesionales habilitados para asignar.</p>
      ) : (
        <form
          noValidate
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (chosen === undefined) return;
            void run(
              () =>
                assign({
                  accompanimentId,
                  userId: chosen.userId,
                  assignedRole: "professional",
                }),
              `Se asignó el acompañamiento a ${chosen.fullName}.`,
            );
          }}
        >
          <div>
            <label htmlFor="accompaniment-professional-to-assign" className={LABEL}>
              Asignar a otro profesional
            </label>
            <select
              id="accompaniment-professional-to-assign"
              className={FIELD}
              value={selected}
              onChange={(event) => setSelected(event.target.value)}
              disabled={pending}
            >
              <option value="">Elige un profesional</option>
              {professionals.assignable.map((professional) => (
                <option key={professional.userId} value={professional.userId}>
                  {professional.fullName}
                </option>
              ))}
            </select>
          </div>
          {professionals.assignableComplete ? null : (
            <p className="m-0 text-sm text-on-surface-variant">
              La lista muestra solo una parte de los profesionales habilitados.
            </p>
          )}
          <div className="student-portal__cta">
            <button
              type="submit"
              className="student-portal__btn student-portal__btn--primary"
              disabled={pending || chosen === undefined}
              aria-busy={pending}
            >
              Asignar
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
