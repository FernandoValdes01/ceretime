import { Link } from "@tanstack/react-router";
import type { FollowUpHistoryAudience } from "../shared/follow-up/follow-up-record.tsx";
import { GESTION_FOCUS_VISIBLE } from "./assigned-accompaniments-list.tsx";
import { appointmentStatusLabel } from "./gestion-labels.ts";

const LINK = `inline-flex min-h-[44px] w-fit items-center rounded-[0.5rem] text-base font-semibold text-primary underline ${GESTION_FOCUS_VISIBLE}`;

/** Historial de seguimiento visto por el Profesional (TI2-165). */
export const PROFESSIONAL_FOLLOW_UP_HISTORY: FollowUpHistoryAudience = {
  audience: "professional",
  appointmentStatusLabel,
  renderAppointmentLink: (appointmentId) => (
    <Link to="/profesional/agenda/$appointmentId" params={{ appointmentId }} className={LINK}>
      Ver la atención
    </Link>
  ),
  emptyHint: "El seguimiento se registra desde el detalle de una atención realizada en la agenda.",
};
