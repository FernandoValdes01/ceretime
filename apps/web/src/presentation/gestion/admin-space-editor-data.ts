import { useEffect, useState } from "react";
import type { ListSpacesResult, SaveSpaceInput } from "../../application/agenda/agenda-port.ts";
import type { Space } from "../../../../../convex/domain/index.ts";
import { getAgendaPort } from "./professional-availability-data.ts";

/**
 * Lectura y validación de formato del editor de espacios del Administrador (TI2-04).
 *
 * Un solo puerto vigente: reutiliza el singleton de gestión (TI2-103) con el
 * adaptador ficticio hasta TI2-123/TI2-125, que lo sustituye por la API real
 * sin tocar presentación. La lectura responde `undefined` mientras carga; los
 * fallos técnicos se traducen al estado `error` tipado y la denegación al
 * estado `denied` genérico sin detalles sensibles.
 *
 * Los validadores de formato solo revisan presencia y texto legible de los
 * campos del contrato para dar errores accesibles. No sustituyen los
 * invariantes de Dominio: la forma del espacio vive en el barrel
 * (`convex/domain/index.ts`) y la escritura real del catálogo no está
 * entregada (TI2-99 entrega lectura, no escritura); todo guardado es
 * simulado con datos ficticios y no anuncia persistencia real.
 */

export type SpaceFormState = {
  campus: string;
  building: string;
  floor: string;
  room: string;
  accessConditions: string;
  arrivalInstructions: string;
};

export const EMPTY_SPACE_FORM: SpaceFormState = {
  campus: "",
  building: "",
  floor: "",
  room: "",
  accessConditions: "",
  arrivalInstructions: "",
};

/** Prefill del formulario con los campos del contrato del espacio a editar. */
export function toSpaceForm(space: Space): SpaceFormState {
  return {
    campus: space.campus,
    building: space.building,
    floor: space.floor,
    room: space.room,
    accessConditions: space.accessConditions,
    arrivalInstructions: space.arrivalInstructions,
  };
}

/** Errores de formato del formulario de espacio, vacíos cuando es válido. */
export function validateSpaceForm(form: SpaceFormState): Record<string, string> {
  const errors: Record<string, string> = {};
  if (form.campus.trim() === "") {
    errors.campus = "Indica el campus del espacio.";
  }
  if (form.building.trim() === "") {
    errors.building = "Indica el edificio del espacio.";
  }
  if (form.floor.trim() === "") {
    errors.floor = "Indica el piso del espacio.";
  }
  if (form.room.trim() === "") {
    errors.room = "Indica la sala del espacio.";
  }
  if (form.accessConditions.trim() === "") {
    errors.accessConditions = "Describe las condiciones de acceso del espacio.";
  }
  if (form.arrivalInstructions.trim() === "") {
    errors.arrivalInstructions = "Describe las instrucciones de llegada al espacio.";
  }
  return errors;
}

/** Convierte el formulario válido a la entrada tipada del puerto. */
export function toSaveSpaceInput(form: SpaceFormState, editingId: string | null): SaveSpaceInput {
  return {
    ...(editingId === null ? {} : { id: editingId }),
    campus: form.campus.trim(),
    building: form.building.trim(),
    floor: form.floor.trim(),
    room: form.room.trim(),
    accessConditions: form.accessConditions.trim(),
    arrivalInstructions: form.arrivalInstructions.trim(),
  };
}

export function useSpaceCatalog(attempt: number) {
  const [result, setResult] = useState<ListSpacesResult | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    getAgendaPort()
      .listSpaces()
      .then(
        (next) => {
          if (!cancelled) {
            setResult(next);
          }
        },
        () => {
          if (!cancelled) {
            setResult({
              status: "error",
              message: "No pudimos cargar los espacios. Inténtalo de nuevo.",
            });
          }
        },
      );
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  return result;
}
