import { useMutation, useQuery } from "convex/react";
import {
  ACCOMPANIMENT_TRANSITIONS,
  UNAUTHORIZED_ERROR_CODE,
  type AccompanimentStatus,
} from "../../../../../convex/domain/index.ts";
import { publicErrorOf } from "../../infrastructure/convex/public-error.ts";
import { ACCESS_DENIED_MESSAGE } from "../shared/view-states.tsx";
// Provisorio (TI2-3): importa los tipos generados por ruta relativa hasta que
// el monorepo defina el alias o paquete interno compartido.
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";

/**
 * Estado y profesionales del acompañamiento desde la Web del Profesional
 * (TI2-165).
 *
 * Cableado delgado sobre las operaciones públicas de TI2-140 y TI2-152
 * (`docs/contratos-sprint-3/seguimiento.md`): pausar, reactivar, consultar
 * cuántas atenciones cancelaría el cierre, cerrar, y leer, asignar y retirar
 * profesionales. La autorización y la
 * política de estados las aplica el Backend; acá solo se decide qué acciones
 * ofrecer, con la tabla canónica del dominio.
 */

export function usePauseAccompaniment() {
  return useMutation(api.presentation.accompaniments.pauseAccompaniment);
}

export function useReactivateAccompaniment() {
  return useMutation(api.presentation.accompaniments.reactivateAccompaniment);
}

export function useCloseAccompaniment() {
  return useMutation(api.presentation.accompaniments.closeAccompaniment);
}

/**
 * Profesionales asignados al acompañamiento y los que se le pueden asignar,
 * con su nombre (TI2-165). Responde `undefined` mientras carga.
 */
export function useAccompanimentProfessionals(accompanimentId: Id<"accompaniments">) {
  return useQuery(api.presentation.accompaniments.listAccompanimentProfessionals, {
    accompanimentId,
  });
}

/** Asignar y retirar profesionales usan las operaciones de TI2-140. */
export function useAssignAccompanimentAccess() {
  return useMutation(api.presentation.accompaniments.assignAccompanimentAccess);
}

export function useRevokeAccompanimentAccess() {
  return useMutation(api.presentation.accompaniments.revokeAccompanimentAccess);
}

/** Profesionales del acompañamiento, derivados del contrato generado. */
export type AccompanimentProfessionals = NonNullable<
  ReturnType<typeof useAccompanimentProfessionals>
>;

/** Lo que cancelaría el cierre, o por qué no se pudo consultar. */
export type ClosurePreviewState =
  | { readonly status: "loading" }
  | {
      readonly status: "ok";
      readonly appointmentsToCancel: number;
      readonly unrecordedAppointments: number;
    }
  | { readonly status: "error"; readonly message: string };

/**
 * Atenciones que cancelaría el cierre. Se consulta solo con la confirmación
 * del cierre abierta. Un fallo de la query no rompe la pantalla: llega como
 * estado `error`, con el aviso genérico si es una denegación.
 */
export function useClosurePreview(accompanimentId: Id<"accompaniments">): ClosurePreviewState {
  try {
    // El hook se invoca siempre y en el mismo orden: el try solo clasifica
    // el error que ya lanzó.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const preview = useQuery(api.presentation.accompaniments.getAccompanimentClosurePreview, {
      accompanimentId,
    });
    return preview === undefined ? { status: "loading" } : { status: "ok", ...preview };
  } catch (error) {
    return {
      status: "error",
      message:
        publicErrorOf(error)?.code === UNAUTHORIZED_ERROR_CODE
          ? ACCESS_DENIED_MESSAGE
          : "No pudimos revisar las atenciones del acompañamiento. Cierra esta confirmación y vuelve a intentarlo.",
    };
  }
}

/** Acciones de estado que la vista ofrece, en el orden en que se muestran. */
export type AccompanimentAction = "pause" | "reactivate" | "close";

const ACTION_BY_TARGET: Record<AccompanimentStatus, AccompanimentAction> = {
  paused: "pause",
  active: "reactivate",
  closed: "close",
};

/**
 * Acciones disponibles desde un estado, derivadas de `ACCOMPANIMENT_TRANSITIONS`.
 * Un acompañamiento cerrado no tiene ninguna: no se reabre ni se pausa.
 */
export function accompanimentActions(
  status: AccompanimentStatus,
): ReadonlyArray<AccompanimentAction> {
  return ACCOMPANIMENT_TRANSITIONS.filter((transition) => transition.from === status).map(
    (transition) => ACTION_BY_TARGET[transition.to],
  );
}
