/**
 * Aviso persistente de administración (TI2-169): misma caja blanca del aviso
 * flotante, pero fija porque la operación lo necesita (reintentar una carga
 * o conservar una denegación). Se anuncia con `role="alert"`.
 */
export function AdminNotice({
  message,
  actionLabel,
  onAction,
}: {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <>
      <p role="alert" className="admin-notice">
        {message}
      </p>
      {actionLabel !== undefined && onAction !== undefined ? (
        <div className="admin-notice__actions">
          <button
            type="button"
            className="student-portal__btn student-portal__btn--primary"
            onClick={onAction}
          >
            {actionLabel}
          </button>
        </div>
      ) : null}
    </>
  );
}
