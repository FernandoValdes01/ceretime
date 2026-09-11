import { expect, test } from "bun:test";
import { createTestUserHandler, getUserByIdHandler } from "./users";

/**
 * Prueba de persistencia para la entidad 'users' utilizando datos ficticios.
 */
test("Persistencia de usuario: crear, consultar y verificar rol/estado", async () => {
  const mockDb = new Map<string, any>();
  let idCounter = 1;

  const mockCtx = {
    db: {
      insert: async (_table: string, doc: any) => {
        const id = `users:${idCounter++}` as any;
        const record = { _id: id, _creationTime: Date.now(), ...doc };
        mockDb.set(id, record);
        return id;
      },
      get: async (id: any) => {
        return mockDb.get(id) || null;
      },
    },
  };

  // Datos ficticios del usuario de prueba
  const dummyUserData = {
    email: "estudiante.ficticio@cereti.cl",
    fullName: "Usuario Ficticio de Prueba",
    role: "student" as const,
    institutionalStatus: "enabled" as const,
    accountStatus: "active" as const,
  };

  // 1. Crear usuario ficticio
  const createdId = await createTestUserHandler(mockCtx, dummyUserData);
  expect(createdId).toBeDefined();

  // 2. Consultar usuario por ID
  const fetchedUser = await getUserByIdHandler(mockCtx, {
    id: createdId,
  });

  // 3. Validar coincidencia de campos, rol y estados
  expect(fetchedUser).not.toBeNull();
  expect(fetchedUser?.email).toBe(dummyUserData.email);
  expect(fetchedUser?.fullName).toBe(dummyUserData.fullName);
  expect(fetchedUser?.role).toBe(dummyUserData.role);
  expect(fetchedUser?.institutionalStatus).toBe(dummyUserData.institutionalStatus);
  expect(fetchedUser?.accountStatus).toBe(dummyUserData.accountStatus);
});
