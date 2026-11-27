import { useState } from "react";
import {
  addCivilDays,
  AGENDA_TIME_ZONE,
  ASSIGNMENT_FIELDS_INVALID_ERROR_CODE,
  civilDateOfInstant,
  CONFLICT_ERROR_CODE,
  midnightToEpochMs,
  UNAUTHORIZED_ERROR_CODE,
  type AccompanimentStatus,
} from "../../../../../convex/domain/index.ts";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { publicErrorOf } from "../../infrastructure/convex/public-error.ts";
import { isValidCivilDate } from "../shared/date-format.ts";
import { formatPanelDate } from "../routes/student-panel-labels.ts";
import { ACCESS_DENIED_MESSAGE, DeniedState, LoadingState } from "../shared/view-states.tsx";
import { GESTION_FOCUS_VISIBLE } from "./assigned-accompaniments-list.tsx";
import { isAuthorizationDenial } from "../shared/authorization-denial.ts";
import {
  internValidityState,
  useAccompanimentInterns,
  useAssignInternAccess,
  useRevokeInternAccess,
  useUpdateInternAccess,
  type AccompanimentInterns,
} from "./professional-interns-data.ts";

/**
 * Practicantes del acompañamiento para la Web del Profesional (TI2-170).
 *
 * Muestra quién está asignado como practicante y permite asignar a otro
 * practicante habilitado, modificar su vigencia acordada y retirarlo, con las
 * operaciones de TI2-140. Retirar pide confirmación, porque quien se retira
 * pierde el acceso en la consulta siguiente aunque conserve el enlace: la
 * vista del practicante reemplaza el contenido por el aviso de acceso
 * denegado (TI2-116). Un acompañamiento cerrado solo ofrece el retiro, porque
 * conceder o modificar responde `conflict`. La autorización la decide el
 * Backend.
 */

const FIELD = `min-h-[44px] w-full min-w-0 box-border rounded-[0.5rem] border border-outline bg-surface-container-lowest px-3 py-2 text-base text-on-surface ${GESTION_FOCUS_VISIBLE}`;
const LABEL = "mb-2 block text-sm font-semibold text-on-surface";

const DEFAULT_ERROR = "No pudimos completar el cambio. Inténtalo de nuevo.";

function changeErrorMessage(error: unknown): string {
  const publicError = publicErrorOf(error);
  if (publicError === null) return DEFAULT_ERROR;
  if (publicError.code === UNAUTHORIZED_ERROR_CODE) return ACCESS_DENIED_MESSAGE;
  if (publicError.code === CONFLICT_ERROR_CODE) {
    return "El acompañamiento o sus asignaciones cambiaron. Revisa la lista y vuelve a intentarlo.";
  }
  if (publicError.code === ASSIGNMENT_FIELDS_INVALID_ERROR_CODE) {
    return publicError.message;
  }
  return DEFAULT_ERROR;
}

function toDateInput(value: number | undefined): string {
  if (value === undefined) return "";
  return civilDateOfInstant(value, AGENDA_TIME_ZONE);
}

/**
 * Extremo de la vigencia en la zona de la agenda (TI2-170).
 *
 * El inicio es la medianoche del día elegido en Santiago y el fin, el último
 * instante de ese día (la medianoche del día siguiente menos 1 ms): así la
 * fecha que se elige es la que rige, sin correrse un día al mostrarla.
 */
function parseOptionalDate(value: string, kind: "from" | "until"): number | undefined | null {
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  if (!isValidCivilDate(trimmed)) return null;
  return kind === "from"
    ? midnightToEpochMs(trimmed, AGENDA_TIME_ZONE)
    : midnightToEpochMs(addCivilDays(trimmed, 1), AGENDA_TIME_ZONE) - 1;
}

export function AccompanimentInternsSection({
  accompanimentId,
  status,
}: {
  accompanimentId: Id<"accompaniments">;
  status: AccompanimentStatus;
}) {
  return (
    <section aria-labelledby="accompaniment-interns-title" className="student-portal__section">
      <div className="student-portal__section-head">
        <h2 id="accompaniment-interns-title">Practicantes del acompañamiento</h2>
      </div>
      <InternsBody accompanimentId={accompanimentId} status={status} />
    </section>
  );
}

function InternsBody({
  accompanimentId,
  status,
}: {
  accompanimentId: Id<"accompaniments">;
  status: AccompanimentStatus;
}) {
  let interns: AccompanimentInterns | undefined;
  try {
    // Hook primero y en todos los renders: el try solo clasifica el error.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    interns = useAccompanimentInterns(accompanimentId);
  } catch (error) {
    if (isAuthorizationDenial(error)) {
      return <DeniedState title="No tienes acceso a los practicantes de este acompañamiento." />;
    }
    throw error;
  }

  if (interns === undefined) {
    return <LoadingState label="Cargando los practicantes…" />;
  }
  return <InternsEditor accompanimentId={accompanimentId} status={status} interns={interns} />;
}

function InternsEditor({
  accompanimentId,
  status,
  interns,
}: {
  accompanimentId: Id<"accompaniments">;
  status: AccompanimentStatus;
  interns: AccompanimentInterns;
}) {
  const assign = useAssignInternAccess();
  const update = useUpdateInternAccess();
  const revoke = useRevokeInternAccess();
  const [selected, setSelected] = useState("");
  const [validFrom, setValidFrom] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editFrom, setEditFrom] = useState("");
  const [editUntil, setEditUntil] = useState("");
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
      setValidFrom("");
      setValidUntil("");
      setConfirmingId(null);
      setEditingId(null);
    } catch (caught) {
      setError(changeErrorMessage(caught));
    } finally {
      setPending(false);
    }
  }

  const chosen = interns.assignable.find((item) => item.userId === selected);
  const closed = status === "closed";

  return (
    <div className="flex flex-col gap-4 wrap-anywhere">
      {notice !== null ? <p role="status">{notice}</p> : null}
      {error !== null ? (
        <p role="alert" className="student-portal__error">
          {error}
        </p>
      ) : null}
      {interns.assigned.length === 0 ? (
        <p>Este acompañamiento no tiene practicantes asignados.</p>
      ) : (
        <ul className="m-0 grid list-none gap-3 p-0">
          {interns.assigned.map((intern) => (
            <li
              key={intern.userId}
              className="flex flex-col gap-2 rounded-lg border border-border-low p-4"
            >
              <p className="m-0 text-base font-semibold wrap-anywhere">{intern.fullName}</p>
              {intern.assignedAt === undefined ? null : (
                <p className="m-0 text-sm text-on-surface-variant">
                  Fecha de asignación: {formatPanelDate(intern.assignedAt)}
                </p>
              )}
              <p className="m-0 text-sm text-on-surface-variant">
                Vigencia: {internValidityState(intern)} ·{" "}
                {intern.validFrom === undefined && intern.validUntil === undefined
                  ? "sin límites acordados"
                  : `${intern.validFrom === undefined ? "sin inicio" : formatPanelDate(intern.validFrom)} al ${intern.validUntil === undefined ? "sin fin" : formatPanelDate(intern.validUntil)}`}
              </p>
              {confirmingId === intern.userId ? (
                <div className="flex flex-col gap-2">
                  <p className="m-0">
                    {intern.fullName} dejará de ver este acompañamiento en cuanto se confirme,
                    aunque conserve el enlace.
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
                              userId: intern.userId,
                              assignedRole: "intern",
                            }),
                          `Se retiró la asignación de ${intern.fullName}.`,
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
              ) : editingId === intern.userId ? (
                <form
                  noValidate
                  className="flex flex-col gap-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const from = parseOptionalDate(editFrom, "from");
                    const until = parseOptionalDate(editUntil, "until");
                    if (from === null || until === null) {
                      setError("Las fechas deben tener el formato AAAA-MM-DD y existir.");
                      return;
                    }
                    if (from !== undefined && until !== undefined && from > until) {
                      setError("La fecha de inicio no puede ser posterior a la de fin.");
                      return;
                    }
                    void run(
                      () =>
                        update({
                          accompanimentId,
                          userId: intern.userId,
                          assignedRole: "intern",
                          validFrom: editFrom.trim() === "" ? null : (from ?? null),
                          validUntil: editUntil.trim() === "" ? null : (until ?? null),
                        }),
                      `Se modificó la vigencia de ${intern.fullName}.`,
                    );
                  }}
                >
                  <div>
                    <label htmlFor={`practicante-valid-from-${intern.userId}`} className={LABEL}>
                      Inicio de la vigencia (opcional)
                    </label>
                    <input
                      id={`practicante-valid-from-${intern.userId}`}
                      type="date"
                      className={FIELD}
                      value={editFrom}
                      onChange={(event) => setEditFrom(event.target.value)}
                      disabled={pending}
                    />
                  </div>
                  <div>
                    <label htmlFor={`practicante-valid-until-${intern.userId}`} className={LABEL}>
                      Fin de la vigencia (opcional)
                    </label>
                    <input
                      id={`practicante-valid-until-${intern.userId}`}
                      type="date"
                      className={FIELD}
                      value={editUntil}
                      onChange={(event) => setEditUntil(event.target.value)}
                      disabled={pending}
                    />
                  </div>
                  <p className="m-0 text-sm text-on-surface-variant">
                    Vacío quita ese límite; sin fecha la asignación no vence por ese extremo.
                  </p>
                  <div className="student-portal__cta">
                    <button
                      type="submit"
                      className="student-portal__btn student-portal__btn--primary"
                      disabled={pending}
                      aria-busy={pending}
                    >
                      Guardar vigencia
                    </button>
                    <button
                      type="button"
                      className="student-portal__btn student-portal__btn--ghost"
                      disabled={pending}
                      onClick={() => setEditingId(null)}
                    >
                      Cancelar
                    </button>
                  </div>
                </form>
              ) : (
                <div className="student-portal__cta">
                  {closed ? null : (
                    <button
                      type="button"
                      className="student-portal__btn student-portal__btn--ghost w-fit max-w-full wrap-anywhere"
                      disabled={pending}
                      onClick={() => {
                        setNotice(null);
                        setError(null);
                        setEditingId(intern.userId);
                        setEditFrom(toDateInput(intern.validFrom));
                        setEditUntil(toDateInput(intern.validUntil));
                      }}
                    >
                      Modificar vigencia
                    </button>
                  )}
                  <button
                    type="button"
                    className="student-portal__btn student-portal__btn--ghost w-fit max-w-full wrap-anywhere"
                    disabled={pending}
                    onClick={() => {
                      setNotice(null);
                      setError(null);
                      setConfirmingId(intern.userId);
                    }}
                  >
                    Retirar a {intern.fullName}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {closed ? (
        <p>El acompañamiento está cerrado: su equipo ya no cambia, salvo retiros.</p>
      ) : interns.assignable.length === 0 ? (
        <p>No hay otros practicantes habilitados para asignar.</p>
      ) : (
        <form
          noValidate
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (chosen === undefined) return;
            const from = parseOptionalDate(validFrom, "from");
            const until = parseOptionalDate(validUntil, "until");
            if (from === null || until === null) {
              setError("Las fechas deben tener el formato AAAA-MM-DD y existir.");
              return;
            }
            if (from !== undefined && until !== undefined && from > until) {
              setError("La fecha de inicio no puede ser posterior a la de fin.");
              return;
            }
            void run(
              () =>
                assign({
                  accompanimentId,
                  userId: chosen.userId,
                  assignedRole: "intern",
                  ...(from === undefined ? {} : { validFrom: from }),
                  ...(until === undefined ? {} : { validUntil: until }),
                }),
              `Se asignó el acompañamiento a ${chosen.fullName}.`,
            );
          }}
        >
          <div>
            <label htmlFor="accompaniment-intern-to-assign" className={LABEL}>
              Asignar a otro practicante
            </label>
            <select
              id="accompaniment-intern-to-assign"
              className={FIELD}
              value={selected}
              onChange={(event) => setSelected(event.target.value)}
              disabled={pending}
            >
              <option value="">Elige un practicante</option>
              {interns.assignable.map((intern) => (
                <option key={intern.userId} value={intern.userId}>
                  {intern.fullName}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="accompaniment-intern-valid-from" className={LABEL}>
              Inicio de la vigencia (opcional)
            </label>
            <input
              id="accompaniment-intern-valid-from"
              type="date"
              className={FIELD}
              value={validFrom}
              onChange={(event) => setValidFrom(event.target.value)}
              disabled={pending}
            />
          </div>
          <div>
            <label htmlFor="accompaniment-intern-valid-until" className={LABEL}>
              Fin de la vigencia (opcional)
            </label>
            <input
              id="accompaniment-intern-valid-until"
              type="date"
              className={FIELD}
              value={validUntil}
              onChange={(event) => setValidUntil(event.target.value)}
              disabled={pending}
            />
          </div>
          {interns.assignableComplete ? null : (
            <p className="m-0 text-sm text-on-surface-variant">
              La lista muestra solo una parte de los practicantes habilitados.
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
