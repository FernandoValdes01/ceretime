import { describe, expect, test } from "vitest";
import {
  rejectExternalSession,
  rejectExternalUser,
  toInstitutionalGoogleUserInfo,
} from "./reject_external_user";

describe("rejectExternalUser", () => {
  test("rechaza correos fuera de la institución", async () => {
    await expect(rejectExternalUser("a@gmail.com")).resolves.toBe(false);
    await expect(rejectExternalUser("a@uct.cl.evil.com")).resolves.toBe(false);
    await expect(rejectExternalUser(null)).resolves.toBe(false);
    await expect(rejectExternalUser(undefined)).resolves.toBe(false);
    await expect(rejectExternalUser("")).resolves.toBe(false);
  });

  test("permite ambos dominios institucionales", async () => {
    await expect(rejectExternalUser("a@alu.uct.cl")).resolves.toBeUndefined();
    await expect(rejectExternalUser("b@uct.cl")).resolves.toBeUndefined();
  });
});

describe("rejectExternalSession", () => {
  const findUserWith = (email: unknown) => async (userId: string) =>
    userId === "usuario-ficticio" ? { email } : null;

  test("niega sesión a un usuario existente con correo no institucional", async () => {
    await expect(
      rejectExternalSession("usuario-ficticio", findUserWith("a@gmail.com")),
    ).resolves.toBe(false);
    await expect(rejectExternalSession("usuario-ficticio", findUserWith(undefined))).resolves.toBe(
      false,
    );
  });

  test("niega sesión cuando el usuario no existe o no se puede leer", async () => {
    await expect(rejectExternalSession("otro-usuario", findUserWith("a@alu.uct.cl"))).resolves.toBe(
      false,
    );
    await expect(rejectExternalSession("usuario-ficticio", null)).resolves.toBe(false);
  });

  test("permite la sesión de ambos dominios institucionales", async () => {
    await expect(
      rejectExternalSession("usuario-ficticio", findUserWith("a@alu.uct.cl")),
    ).resolves.toBeUndefined();
    await expect(
      rejectExternalSession("usuario-ficticio", findUserWith("b@uct.cl")),
    ).resolves.toBeUndefined();
  });
});

/** ID token ficticio sin firma real: solo importa el payload. */
function fakeIdToken(payload: unknown): string {
  const encode = (value: unknown) =>
    btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value))))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  return `${encode({ alg: "RS256" })}.${encode(payload)}.firma-ficticia`;
}

const CLIENT_ID = "cliente-ficticio-de-google";
const NOW = Date.UTC(2026, 10, 3, 12, 0, 0);

describe("toInstitutionalGoogleUserInfo", () => {
  const student = {
    iss: "https://accounts.google.com",
    aud: CLIENT_ID,
    exp: NOW / 1000 + 3600,
    sub: "google-sub-ficticio",
    email: "Estudiante.Ficticio@ALU.uct.cl",
    email_verified: true,
    hd: "alu.uct.cl",
    name: "Estudiante Ñandú",
    picture: "https://example.com/foto.png",
  };
  const userInfo = (payload: unknown, population: "estudiante" | "personal" = "estudiante") =>
    toInstitutionalGoogleUserInfo(fakeIdToken(payload), population, CLIENT_ID, NOW);

  test("entrega los datos mínimos de una cuenta aceptada", () => {
    expect(userInfo(student)).toEqual({
      id: "google-sub-ficticio",
      email: "estudiante.ficticio@alu.uct.cl",
      emailVerified: true,
      name: "Estudiante Ñandú",
      image: "https://example.com/foto.png",
    });
  });

  test("acepta el emisor de Google sin esquema", () => {
    expect(userInfo({ ...student, iss: "accounts.google.com" })).not.toBeNull();
  });

  test("usa el correo como nombre si el token no trae nombre", () => {
    const { name: _name, ...withoutName } = student;
    expect(userInfo(withoutName)?.name).toBe("estudiante.ficticio@alu.uct.cl");
  });

  test("rechaza la cuenta personal, la de otra población y el correo sin verificar", () => {
    const personal = { ...student, email: "a@gmail.com", hd: undefined };
    expect(userInfo(personal)).toBeNull();
    expect(userInfo(student, "personal")).toBeNull();
    expect(userInfo({ ...student, email_verified: false })).toBeNull();
    expect(userInfo({ ...student, hd: "uct.cl" })).toBeNull();
    expect(userInfo({ ...student, hd: undefined })).toBeNull();
  });

  test("rechaza el token de otro emisor, otro OAuth Client o ya expirado", () => {
    expect(userInfo({ ...student, iss: "https://evil.example.com" })).toBeNull();
    expect(userInfo({ ...student, iss: undefined })).toBeNull();
    expect(userInfo({ ...student, aud: "otro-cliente-de-google" })).toBeNull();
    expect(userInfo({ ...student, aud: [CLIENT_ID] })).toBeNull();
    expect(userInfo({ ...student, exp: NOW / 1000 })).toBeNull();
    expect(userInfo({ ...student, exp: String(NOW / 1000 + 3600) })).toBeNull();
  });

  test("rechaza tokens ausentes, mal formados o sin sujeto", () => {
    expect(toInstitutionalGoogleUserInfo(undefined, "estudiante", CLIENT_ID, NOW)).toBeNull();
    expect(toInstitutionalGoogleUserInfo("no-es-un-jwt", "estudiante", CLIENT_ID, NOW)).toBeNull();
    expect(toInstitutionalGoogleUserInfo("a.%%%.c", "estudiante", CLIENT_ID, NOW)).toBeNull();
    expect(userInfo([1, 2])).toBeNull();
    expect(userInfo({ ...student, sub: "" })).toBeNull();
  });
});
