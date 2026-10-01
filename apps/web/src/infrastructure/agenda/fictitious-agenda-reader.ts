import { AGENDA_CONTRACT_VERSION } from "../../application/agenda/agenda-contracts";
import type {
  CanonicalSpaceCatalogPage,
  FictitiousAvailabilityBlock,
} from "../../application/agenda/agenda-contracts";

/**
 * Lectura temporal de disponibilidad con datos ficticios (TI2-87).
 *
 * Adaptador Web provisional: devuelve bloques ficticios con respuestas
 * tipadas a la forma `v1`, sin implementar reglas de negocio (no decide
 * cruces, recurrencia ni compatibilidad con necesidades de acceso). Se
 * reemplaza por `api.presentation.agenda.*` en las tareas de conexión.
 */

export type FictitiousAgendaMode = "success" | "empty" | "error";

export interface FictitiousAgendaReaderOptions {
  readonly delayMs?: number;
  readonly mode?: FictitiousAgendaMode;
}

const FICTITIOUS_BLOCKS: readonly FictitiousAvailabilityBlock[] = [
  {
    id: "block-ficticio-1",
    professionalId: "profesional-ficticio-1",
    weekday: 4,
    from: "09:00",
    to: "10:00",
    durationMinutes: 60,
    modality: "inPerson",
    spaceId: "space-ficticio-c204",
    version: AGENDA_CONTRACT_VERSION,
  },
  {
    id: "block-ficticio-2",
    professionalId: "profesional-ficticio-1",
    weekday: 4,
    from: "11:30",
    to: "12:30",
    durationMinutes: 60,
    modality: "online",
    version: AGENDA_CONTRACT_VERSION,
  },
];

/** Mensaje genérico de la lectura temporal, sin detalles internos. */
export const FICTITIOUS_AGENDA_ERROR = "No pudimos cargar la disponibilidad ficticia.";

export function createFictitiousAvailabilityReader(options: FictitiousAgendaReaderOptions = {}) {
  const { delayMs = 0, mode = "success" } = options;
  return {
    async readAvailability(): Promise<readonly FictitiousAvailabilityBlock[]> {
      if (delayMs > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
      }
      if (mode === "error") throw new Error(FICTITIOUS_AGENDA_ERROR);
      if (mode === "empty") return [];
      return FICTITIOUS_BLOCKS;
    },
  };
}

/** Espacios ficticios con la misma forma que `CanonicalSpaceCatalogPage`. */
const FICTITIOUS_SPACE_PAGE: CanonicalSpaceCatalogPage = {
  version: "v1",
  items: [
    {
      id: "space-ficticio-c204",
      campus: "Campus San Francisco (ficticio)",
      building: "Edificio C (ficticio)",
      floor: "Piso 2",
      room: "Sala C-204",
      accessConditions: "Acceso por rampa lateral y puerta amplia (ficticio).",
      arrivalInstructions:
        "Desde el acceso principal, siga a la derecha 20 metros hasta la sala C-204 (ficticio).",
      version: "v1",
    },
    {
      id: "space-ficticio-d105",
      campus: "Campus San Francisco (ficticio)",
      building: "Edificio D (ficticio)",
      floor: "Piso 1",
      room: "Sala D-105",
      accessConditions: "Sala silenciosa con sillas móviles (ficticio).",
      arrivalInstructions:
        "Desde el acceso principal, siga a la izquierda 15 metros hasta la sala D-105 (ficticio).",
      version: "v1",
    },
  ],
  hasMore: false,
  nextCursor: null,
};

export type FictitiousSpaceCatalogMode = "success" | "empty" | "error";

export interface FictitiousSpaceCatalogOptions {
  readonly delayMs?: number;
  readonly mode?: FictitiousSpaceCatalogMode;
}

/** Mensaje genérico del catálogo temporal, sin detalles internos. */
export const FICTITIOUS_SPACE_CATALOG_ERROR = "No pudimos cargar el catálogo ficticio.";

/**
 * Lectura propia del catálogo con datos ficticios (TI2-87).
 *
 * Devuelve la página tal cual, sin filtrar por compatibilidad ni ocupación:
 * no implementa reglas de negocio y se reemplaza por
 * `api.presentation.agenda.listSpaceCatalog` en las tareas de conexión.
 */
export function createFictitiousSpaceCatalogReader(options: FictitiousSpaceCatalogOptions = {}) {
  const { delayMs = 0, mode = "success" } = options;
  return {
    async readSpaceCatalog(): Promise<CanonicalSpaceCatalogPage> {
      if (delayMs > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
      }
      if (mode === "error") throw new Error(FICTITIOUS_SPACE_CATALOG_ERROR);
      if (mode === "empty") return { ...FICTITIOUS_SPACE_PAGE, items: [] };
      return FICTITIOUS_SPACE_PAGE;
    },
  };
}
