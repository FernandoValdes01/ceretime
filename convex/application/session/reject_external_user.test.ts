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
  test("niega sesión a un usuario existente con correo no institucional", async () => {
    await expect(rejectExternalSession({ email: "a@gmail.com" })).resolves.toBe(false);
    await expect(rejectExternalSession({ email: undefined })).resolves.toBe(false);
  });

  test("niega sesión cuando el usuario no se puede leer", async () => {
    await expect(rejectExternalSession(null)).resolves.toBe(false);
  });

  test("permite la sesión de ambos dominios institucionales", async () => {
    await expect(rejectExternalSession({ email: "a@alu.uct.cl" })).resolves.toBeUndefined();
    await expect(rejectExternalSession({ email: "b@uct.cl" })).resolves.toBeUndefined();
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

describe("toInstitutionalGoogleUserInfo", () => {
  const student = {
    sub: "google-sub-ficticio",
    email: "Estudiante.Ficticio@ALU.uct.cl",
    email_verified: true,
    hd: "alu.uct.cl",
    name: "Estudiante Ñandú",
    picture: "https://example.com/foto.png",
  };

  test("entrega los datos mínimos de una cuenta aceptada", () => {
    expect(toInstitutionalGoogleUserInfo(fakeIdToken(student), "estudiante")).toEqual({
      id: "google-sub-ficticio",
      email: "estudiante.ficticio@alu.uct.cl",
      emailVerified: true,
      name: "Estudiante Ñandú",
      image: "https://example.com/foto.png",
    });
  });

  test("usa el correo como nombre si el token no trae nombre", () => {
    const { name: _name, ...withoutName } = student;
    expect(toInstitutionalGoogleUserInfo(fakeIdToken(withoutName), "estudiante")?.name).toBe(
      "estudiante.ficticio@alu.uct.cl",
    );
  });

  test("rechaza la cuenta personal, la de otra población y el correo sin verificar", () => {
    const personal = { sub: "x", email: "a@gmail.com", email_verified: true, name: "A" };
    expect(toInstitutionalGoogleUserInfo(fakeIdToken(personal), "estudiante")).toBeNull();
    expect(toInstitutionalGoogleUserInfo(fakeIdToken(student), "personal")).toBeNull();
    expect(
      toInstitutionalGoogleUserInfo(
        fakeIdToken({ ...student, email_verified: false }),
        "estudiante",
      ),
    ).toBeNull();
    expect(
      toInstitutionalGoogleUserInfo(fakeIdToken({ ...student, hd: "uct.cl" }), "estudiante"),
    ).toBeNull();
  });

  test("rechaza tokens ausentes, mal formados o sin sujeto", () => {
    expect(toInstitutionalGoogleUserInfo(undefined, "estudiante")).toBeNull();
    expect(toInstitutionalGoogleUserInfo("no-es-un-jwt", "estudiante")).toBeNull();
    expect(toInstitutionalGoogleUserInfo("a.%%%.c", "estudiante")).toBeNull();
    expect(toInstitutionalGoogleUserInfo(fakeIdToken([1, 2]), "estudiante")).toBeNull();
    expect(
      toInstitutionalGoogleUserInfo(fakeIdToken({ ...student, sub: "" }), "estudiante"),
    ).toBeNull();
  });
});
