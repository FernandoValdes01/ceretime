import { v } from "convex/values";
import { SPRINT_1_REQUEST_STATES } from "./domain/request/state";

/**
 * Validadores compartidos de identidad y roles.
 * Centralizan los literales aceptados para no duplicarlos entre el esquema y las funciones.
 * Operan exclusivamente con DATOS FICTICIOS durante desarrollo y pruebas.
 */
export const roleUnion = v.union(
  v.literal("student"),
  v.literal("professional"),
  v.literal("intern"),
  v.literal("admin"),
);

export const institutionalStatusUnion = v.union(
  v.literal("enabled"),
  v.literal("disabled"),
  v.literal("pending"),
);

export const accountStatusUnion = v.union(v.literal("active"), v.literal("inactive"));

export const accompanimentStatusUnion = v.union(
  v.literal("active"),
  v.literal("paused"),
  v.literal("closed"),
);

export const assignmentRoleUnion = v.union(v.literal("professional"), v.literal("intern"));

export const assignmentStatusUnion = v.union(v.literal("active"), v.literal("revoked"));

/**
 * Estados de solicitud habilitados en Sprint 1, derivados de los literales
 * del dominio (TI2-7) para que el esquema no defina nombres por su cuenta.
 */
const requestStatusLiterals = SPRINT_1_REQUEST_STATES.map((state) => v.literal(state));

export const requestStatusUnion = v.union(...requestStatusLiterals);
