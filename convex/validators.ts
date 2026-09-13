import { v } from "convex/values";

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
