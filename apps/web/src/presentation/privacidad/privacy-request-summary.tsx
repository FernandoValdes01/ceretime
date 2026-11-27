import type { ReactNode } from "react";
import {
  PRIVACY_AGENCY_CLAIM_BUSINESS_DAYS,
  PRIVACY_REQUEST_KIND_LABELS,
  PRIVACY_REQUEST_STATUS_LABELS,
  PRIVACY_RESPONSE_DELIVERY_CHANNEL_LABELS,
  PRIVACY_RESPONSE_OUTCOME_LABELS,
} from "../../../../../convex/domain/index.ts";
import { formatAgendaInstant, formatCivilDateWithYear } from "../shared/date-format.ts";
import { SECTION_TITLE_CLASS } from "../estudiante/student-page-classes.ts";
import type { PrivacyRequestView } from "./privacy-data.ts";

/**
 * Ficha de una solicitud de privacidad (TI2-171), la misma para el titular y
 * para el Administrador responsable.
 *
 * Muestra solo lo que entrega el Backend: recepción, plazo vigente con su
 * prórroga, respuesta fundada, constancia de envío y plazo para reclamar ante
 * la Agencia. Las fechas civiles son el último día que cubre cada plazo; la
 * Web no las calcula. El derecho a reclamar se explica desde que el titular
 * ve una respuesta que rechaza; la fecha límite aparece con la constancia.
 */
export function PrivacyRequestSummary({ request }: { request: PrivacyRequestView }) {
  const dueDate = request.extension?.extendedUntilDate ?? request.initialDueDate;
  const response = request.response;
  const receipt = request.deliveryReceipt;
  // El reclamo ante la Agencia procede cuando la respuesta rechaza en todo o en parte.
  const claimApplies = response !== undefined && response.outcome !== "granted";

  return (
    <div className="flex flex-col gap-6">
      <dl className="m-0 flex flex-col gap-4 rounded-lg border border-border-low bg-surface-container-lowest p-6">
        <Row term="Derecho">{PRIVACY_REQUEST_KIND_LABELS[request.kind]}</Row>
        <Row term="Estado">{PRIVACY_REQUEST_STATUS_LABELS[request.status]}</Row>
        <Row term="Recibida">{formatAgendaInstant(request.receivedAt)}</Row>
        <Row term="Plazo de respuesta">
          Hasta el {formatCivilDateWithYear(dueDate)}
          {request.extension === undefined ? null : " (con prórroga)"}
        </Row>
        {request.extension === undefined ? null : (
          <Row term="Prórroga">
            {`${request.extension.days} ${request.extension.days === 1 ? "día" : "días"} más desde el ${formatCivilDateWithYear(request.initialDueDate)}. Motivo: ${request.extension.reason}`}
          </Row>
        )}
        {request.statusReason === undefined ? null : (
          <Row term="Motivo del estado">{request.statusReason}</Row>
        )}
      </dl>

      {response === undefined ? null : (
        <section
          aria-labelledby={`privacy-response-${request.id}`}
          className="flex flex-col gap-3 rounded-lg border border-border-low bg-surface-container-lowest p-6"
        >
          <h2 id={`privacy-response-${request.id}`} className={SECTION_TITLE_CLASS}>
            Respuesta
          </h2>
          <dl className="m-0 flex flex-col gap-4">
            <Row term="Resultado">{PRIVACY_RESPONSE_OUTCOME_LABELS[response.outcome]}</Row>
            <Row term="Fundamento">{response.reasons}</Row>
            <Row term="Respondida">{formatAgendaInstant(response.respondedAt)}</Row>
            {receipt === undefined ? (
              <>
                {request.view === "review" ? (
                  <Row term="Envío de la respuesta">Pendiente de registrar.</Row>
                ) : null}
                {claimApplies ? (
                  <Row term="Reclamo ante la Agencia">
                    {`Puedes reclamar ante la Agencia de Protección de Datos Personales dentro de los ${PRIVACY_AGENCY_CLAIM_BUSINESS_DAYS} días hábiles siguientes a la notificación de esta respuesta.`}
                  </Row>
                ) : null}
              </>
            ) : (
              <>
                <Row term="Enviada">
                  {`${formatAgendaInstant(receipt.sentAt)}, por ${PRIVACY_RESPONSE_DELIVERY_CHANNEL_LABELS[receipt.channel]}. Folio: ${receipt.reference}`}
                </Row>
                {claimApplies ? (
                  <Row term="Plazo para reclamar ante la Agencia">
                    {`Hasta el ${formatCivilDateWithYear(receipt.agencyClaimDueDate)}. El titular puede reclamar ante la Agencia de Protección de Datos Personales dentro de los ${PRIVACY_AGENCY_CLAIM_BUSINESS_DAYS} días hábiles siguientes a la notificación.`}
                  </Row>
                ) : null}
              </>
            )}
          </dl>
          {response.outcome === "granted" || response.outcome === "partially_granted" ? (
            <p className="m-0 text-base text-on-surface-variant">
              La concesión queda registrada. Cómo se aplica sobre datos reales sigue pendiente de
              una decisión de la UCT.
            </p>
          ) : (
            <p className="m-0 text-base text-on-surface-variant">
              La denegación conserva los datos del titular tal como estaban.
            </p>
          )}
        </section>
      )}
    </div>
  );
}

function Row({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="font-semibold text-on-surface">{term}</dt>
      <dd className="m-0 text-base whitespace-pre-line text-on-surface wrap-anywhere">
        {children}
      </dd>
    </div>
  );
}
