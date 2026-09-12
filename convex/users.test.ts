import { expect, test } from "bun:test";
import { convexTest } from "convex-test";
import * as api from "./_generated/api";
import { internal } from "./_generated/api";
import * as server from "./_generated/server";
import schema from "./schema";
import * as users from "./users";

/**
 * Prueba de integración para la entidad 'users' utilizando 'convex-test'
 * mapeando la carpeta '_generated' para compatibilidad nativa con Bun.
 */
test("Persistencia de usuario: crear, consultar y verificar rol/estado en Convex", async () => {
  // Mapeo de módulos incluyendo _generated para detectar la raíz de Convex
  const modules = {
    "./_generated/api.js": async () => api,
    "./_generated/server.js": async () => server,
    "./users.ts": async () => users,
  };

  // Instancia el entorno de prueba con el esquema y funciones reales
  const t = convexTest(schema, modules);

  // Datos ficticios del usuario de prueba
  const dummyUserData = {
    email: "estudiante.ficticio@cereti.cl",
    fullName: "Usuario Ficticio de Prueba",
    role: "student" as const,
    institutionalStatus: "enabled" as const,
    accountStatus: "active" as const,
  };

  // 1. Ejecutar la mutación interna real de Convex
  const createdId = await t.mutation(internal.users.createTestUser, dummyUserData);
  expect(createdId).toBeDefined();

  // 2. Ejecutar la consulta interna real de Convex
  const fetchedUser = await t.query(internal.users.getUserById, {
    id: createdId,
  });

  // 3. Validar datos contra la base de datos de Convex
  expect(fetchedUser).not.toBeNull();
  expect(fetchedUser?.email).toBe(dummyUserData.email);
  expect(fetchedUser?.fullName).toBe(dummyUserData.fullName);
  expect(fetchedUser?.role).toBe(dummyUserData.role);
  expect(fetchedUser?.institutionalStatus).toBe(dummyUserData.institutionalStatus);
  expect(fetchedUser?.accountStatus).toBe(dummyUserData.accountStatus);
});
