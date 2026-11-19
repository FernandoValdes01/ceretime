import { describe, expect, test } from "vitest";
import type { AuthenticatedProfile } from "../../domain/identity/roles";
import type { NewOwnProfile, OwnProfileStore } from "./ports";
import { ensureOwnProfileUseCase } from "./profile";

function memoryStore(existing: ReadonlyArray<NewOwnProfile> = []) {
  const rows: NewOwnProfile[] = [...existing];
  const view = (row: NewOwnProfile): AuthenticatedProfile => ({
    fullName: row.fullName,
    email: row.email,
    role: row.role,
    institutionalStatus: row.institutionalStatus,
    accountStatus: row.accountStatus,
  });
  const store: OwnProfileStore = {
    findByTokenIdentifier: async (tokenIdentifier) => {
      const row = rows.find((candidate) => candidate.tokenIdentifier === tokenIdentifier);
      return row === undefined ? null : view(row);
    },
    isEmailRegistered: async (email) => rows.some((row) => row.email === email),
    create: async (profile) => {
      rows.push(profile);
      return view(profile);
    },
  };
  return { store, rows };
}

const NOW = 1_762_700_000_000;

describe("ensureOwnProfileUseCase (TI2-182)", () => {
  test("crea al Estudiante habilitado con la fecha de habilitación", async () => {
    const { store, rows } = memoryStore();
    const profile = await ensureOwnProfileUseCase(
      { tokenIdentifier: "t|est", email: "Est@alu.uct.cl", name: "Estudiante Ficticio" },
      { profiles: store, now: () => NOW },
    );
    expect(profile).toMatchObject({ role: "student", institutionalStatus: "enabled" });
    expect(rows).toEqual([
      expect.objectContaining({
        email: "est@alu.uct.cl",
        tokenIdentifier: "t|est",
        enabledAt: NOW,
      }),
    ]);
  });

  test("crea al personal pendiente y sin fecha de habilitación", async () => {
    const { store, rows } = memoryStore();
    await ensureOwnProfileUseCase(
      { tokenIdentifier: "t|pro", email: "pro@uct.cl", name: "" },
      { profiles: store, now: () => NOW },
    );
    expect(rows[0]).toMatchObject({ role: "professional", institutionalStatus: "pending" });
    expect(rows[0]?.enabledAt).toBeUndefined();
    expect(rows[0]?.fullName).toBe("pro");
  });

  test("no crea nada sin identidad, con correo externo o con correo ya registrado", async () => {
    const { store, rows } = memoryStore([
      {
        email: "dup@uct.cl",
        fullName: "Otra Persona",
        role: "admin",
        institutionalStatus: "enabled",
        accountStatus: "active",
        tokenIdentifier: "t|otra",
      },
    ]);
    const deps = { profiles: store, now: () => NOW };
    await expect(ensureOwnProfileUseCase(null, deps)).rejects.toThrow("No autorizado");
    await expect(
      ensureOwnProfileUseCase({ tokenIdentifier: "t|ext", email: "x@gmail.com" }, deps),
    ).rejects.toThrow("No autorizado");
    await expect(
      ensureOwnProfileUseCase({ tokenIdentifier: "t|dup", email: "dup@uct.cl" }, deps),
    ).rejects.toThrow("No autorizado");
    expect(rows).toHaveLength(1);
  });
});
