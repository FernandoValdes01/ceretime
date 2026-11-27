import type {
  FollowUpResponsible,
  FollowUpTaskStatus,
} from "../../../../../../convex/domain/index.ts";

/**
 * Etiquetas del seguimiento (TI2-165, TI2-166).
 *
 * Responsables y estados de una tarea según el contrato de
 * `docs/contratos-sprint-3/seguimiento.md`. Ante un literal desconocido se
 * muestra el valor.
 */
const FOLLOW_UP_RESPONSIBLE_LABELS: Record<FollowUpResponsible, string> = {
  student: "Estudiante",
  professional: "Profesional",
  cereti: "CERETI",
};

const FOLLOW_UP_TASK_STATUS_LABELS: Record<FollowUpTaskStatus, string> = {
  pending: "Pendiente",
  in_progress: "En curso",
  done: "Hecha",
  cancelled: "Cancelada",
};

/** Etiqueta del responsable de una tarea del seguimiento. */
export function followUpResponsibleLabel(responsible: string): string {
  return FOLLOW_UP_RESPONSIBLE_LABELS[responsible as FollowUpResponsible] ?? responsible;
}

/** Etiqueta del estado de una tarea del seguimiento. */
export function followUpTaskStatusLabel(status: string): string {
  return FOLLOW_UP_TASK_STATUS_LABELS[status as FollowUpTaskStatus] ?? status;
}
