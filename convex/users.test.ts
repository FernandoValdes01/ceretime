/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

/**
 * Prueba de integración para la entidad 'users' utilizando 'convex-test'
 * con el runner Vitest del monorepo.
 */
test("Persistencia de usuario: crear, consultar y verificar rol/estado en Convex", async () => {
  // Instancia el entorno de prueba con el esquema y funciones reales
  const t = convexTest(schema, modules);

  // Datos ficticios del usuario de prueba
  const dummyUserData = {
    email: "estudiante.ficticio@cereti.cl",
    fullName: "Usuario Ficticio de Prueba",
    role: "student" as const,
    institutionalStatus: "enabled" as const,
    accountStatus: "active" as const,
    tokenIdentifier: "https://accounts.google.com|ficticio-123",
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
  expect(fetchedUser?.tokenIdentifier).toBe(dummyUserData.tokenIdentifier);
});

test("Consultar un usuario inexistente retorna null", async () => {
  // Instancia el entorno de prueba con el esquema y funciones reales
  const t = convexTest(schema, modules);

  // ID con formato válido que no existe: se inserta y elimina un usuario ficticio
  const missingId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("users", {
      email: "temporal.ficticio@cereti.cl",
      fullName: "Temporal Ficticio",
      role: "student",
      institutionalStatus: "enabled",
      accountStatus: "active",
      tokenIdentifier: "https://accounts.google.com|temporal-456",
    });
    await ctx.db.delete(id);
    return id;
  });

  // La consulta de un ID inexistente debe retornar null
  const fetchedUser = await t.query(internal.users.getUserById, {
    id: missingId,
  });
  expect(fetchedUser).toBeNull();
});

test("Rechaza roles o estados inválidos al crear un usuario", async () => {
  // Instancia el entorno de prueba con el esquema y funciones reales
  const t = convexTest(schema, modules);

  // Datos ficticios del usuario de prueba
  const dummyUserData = {
    email: "estudiante.ficticio@cereti.cl",
    fullName: "Usuario Ficticio de Prueba",
    role: "student" as const,
    institutionalStatus: "enabled" as const,
    accountStatus: "active" as const,
    tokenIdentifier: "https://accounts.google.com|ficticio-123",
  };

  // Un rol fuera del catálogo debe ser rechazado por el validador
  await expect(
    t.mutation(internal.users.createTestUser, {
      ...dummyUserData,
      role: "superadmin" as never,
    }),
  ).rejects.toThrow("Validator error");

  // Un estado institucional fuera del catálogo debe ser rechazado por el validador
  await expect(
    t.mutation(internal.users.createTestUser, {
      ...dummyUserData,
      institutionalStatus: "graduated" as never,
    }),
  ).rejects.toThrow("Validator error");

  // Un estado de cuenta fuera del catálogo debe ser rechazado por el validador
  await expect(
    t.mutation(internal.users.createTestUser, {
      ...dummyUserData,
      accountStatus: "suspended" as never,
    }),
  ).rejects.toThrow("Validator error");
});

test("Vincula el perfil persistido con la identidad autenticada", async () => {
  // Instancia el entorno de prueba con el esquema y funciones reales
  const t = convexTest(schema, modules);

  // Identificador ficticio con forma de `tokenIdentifier` de Convex Auth
  const tokenIdentifier = "https://accounts.google.com|ficticio-789";

  // 1. Persistir el perfil asociado a la identidad ficticia
  const createdId = await t.mutation(internal.users.createTestUser, {
    email: "vinculado.ficticio@cereti.cl",
    fullName: "Vinculado Ficticio",
    role: "student" as const,
    institutionalStatus: "enabled" as const,
    accountStatus: "active" as const,
    tokenIdentifier,
  });
  expect(createdId).toBeDefined();

  // 2. Recuperar el mismo perfil mediante su identificador de identidad
  const linkedUser = await t.query(internal.users.getUserByTokenIdentifier, {
    tokenIdentifier,
  });
  expect(linkedUser).not.toBeNull();
  expect(linkedUser?._id).toEqual(createdId);
  expect(linkedUser?.email).toBe("vinculado.ficticio@cereti.cl");

  // 3. Un identificador desconocido no vincula ningún perfil
  const missingUser = await t.query(internal.users.getUserByTokenIdentifier, {
    tokenIdentifier: "https://accounts.google.com|inexistente-000",
  });
  expect(missingUser).toBeNull();
});

test("Rechaza perfiles duplicados para la misma identidad", async () => {
  // Instancia el entorno de prueba con el esquema y funciones reales
  const t = convexTest(schema, modules);

  // Perfil ficticio con identidad única
  const profile = {
    email: "duplicado.ficticio@cereti.cl",
    fullName: "Duplicado Ficticio",
    role: "student" as const,
    institutionalStatus: "enabled" as const,
    accountStatus: "active" as const,
    tokenIdentifier: "https://accounts.google.com|duplicado-111",
  };

  // 1. El primer perfil con esa identidad se persiste
  const createdId = await t.mutation(internal.users.createTestUser, profile);
  expect(createdId).toBeDefined();

  // 2. Un segundo perfil con la misma identidad debe ser rechazado
  await expect(
    t.mutation(internal.users.createTestUser, {
      ...profile,
      email: "otro.ficticio@cereti.cl",
    }),
  ).rejects.toThrow("Ya existe un perfil");
});
