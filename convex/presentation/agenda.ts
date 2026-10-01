import { ConvexError, v } from "convex/values";
import { query } from "../_generated/server";
import { AGENDA_CONTRACT_VERSION } from "../domain/agenda/availability";
import { API_CONTRACT_VERSION } from "../domain/errors/api_error";
import { RESERVATION_CONTRACT_VERSION } from "../domain/reservations/reservation";
import { SPACE_CATALOG_CONTRACT_VERSION, SPACE_CATALOG_MAX_ITEMS } from "../domain/spaces/space";
import {
  agendaContractVersion,
  apiContractVersion,
  reservationContractVersion,
  spaceCatalogContractVersion,
  spaceValidator,
} from "../validators";

/**
 * Borde de Presentación: contratos públicos de agenda versionados (TI2-87).
 *
 * Adaptadores delgados: validan la entrada, resuelven la identidad en el
 * servidor con `ctx.auth.getUserIdentity()` y no tocan `ctx.db` ni deciden
 * reglas de negocio. La prevención de cruces, la recurrencia efectiva y las
 * transiciones de reserva pertenecen a los casos de uso de otros módulos y
 * no se implementan acá. Toda denegación responde el genérico
 * `ConvexError("No autorizado")` sin revelar existencia ni motivo. Opera con
 * datos ficticios y respuestas tipadas con versión `v1`.
 */

const agendaContractValidator = v.object({
  version: agendaContractVersion,
  availabilityVersion: agendaContractVersion,
  spaceVersion: spaceCatalogContractVersion,
  reservationVersion: reservationContractVersion,
  errorVersion: apiContractVersion,
});

const spaceCatalogPageValidator = v.object({
  version: spaceCatalogContractVersion,
  items: v.array(spaceValidator),
  hasMore: v.boolean(),
  nextCursor: v.union(v.string(), v.null()),
});

/** Espacios ficticios del catálogo propio, sin datos reales ni ocupación. */
const FICTITIOUS_SPACES = [
  {
    id: "space-ficticio-c204",
    campus: "Campus San Francisco (ficticio)",
    building: "Edificio C (ficticio)",
    floor: "Piso 2",
    room: "Sala C-204",
    accessConditions: "Acceso por rampa lateral y puerta amplia (ficticio).",
    arrivalInstructions:
      "Desde el acceso principal, siga a la derecha 20 metros hasta la sala C-204 (ficticio).",
    version: SPACE_CATALOG_CONTRACT_VERSION,
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
    version: SPACE_CATALOG_CONTRACT_VERSION,
  },
  {
    id: "space-ficticio-b101",
    campus: "Campus Norte (ficticio)",
    building: "Edificio B (ficticio)",
    floor: "Piso 1",
    room: "Sala B-101",
    accessConditions: "Iluminación regulable y espacio para persona de apoyo (ficticio).",
    arrivalInstructions: "Desde la entrada norte, avance 10 metros hasta la sala B-101 (ficticio).",
    version: SPACE_CATALOG_CONTRACT_VERSION,
  },
] as const;

/**
 * Devuelve la versión vigente de los contratos de agenda, espacios, reserva
 * y errores. Exige identidad autenticada: sin identidad responde la
 * denegación genérica, sin exponer el motivo.
 */
export const getAgendaContractVersion = query({
  args: {},
  returns: agendaContractValidator,
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (identity === null) throw new ConvexError("No autorizado");
    return {
      version: AGENDA_CONTRACT_VERSION,
      availabilityVersion: AGENDA_CONTRACT_VERSION,
      spaceVersion: SPACE_CATALOG_CONTRACT_VERSION,
      reservationVersion: RESERVATION_CONTRACT_VERSION,
      errorVersion: API_CONTRACT_VERSION,
    };
  },
});

/**
 * Lectura propia del catálogo de espacios con datos ficticios y tope 50.
 *
 * Exige identidad autenticada y respeta el límite sin filtrar por
 * compatibilidad ni ocupación: no implementa reglas de negocio y se
 * reemplaza por la lectura persistida en las tareas de conexión. El exceso
 * se rechaza con mensaje estable en español, nunca se trunca en silencio.
 */
export const listSpaceCatalog = query({
  args: { limit: v.number(), cursor: v.optional(v.string()) },
  returns: spaceCatalogPageValidator,
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (identity === null) throw new ConvexError("No autorizado");
    if (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > SPACE_CATALOG_MAX_ITEMS) {
      throw new Error("El límite debe estar entre 1 y 50.");
    }
    if (args.cursor !== undefined && args.cursor.trim().length === 0) {
      throw new Error("El cursor no puede estar vacío.");
    }
    const start = args.cursor
      ? FICTITIOUS_SPACES.findIndex((space) => space.id === args.cursor) + 1
      : 0;
    const safeStart = start < 0 ? FICTITIOUS_SPACES.length : start;
    const items = FICTITIOUS_SPACES.slice(safeStart, safeStart + args.limit).map((space) => ({
      ...space,
    }));
    const hasMore = safeStart + args.limit < FICTITIOUS_SPACES.length;
    return {
      version: SPACE_CATALOG_CONTRACT_VERSION,
      items,
      hasMore,
      nextCursor: hasMore ? (items[items.length - 1]?.id ?? null) : null,
    };
  },
});
