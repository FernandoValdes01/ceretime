import { betterAuth } from "better-auth/minimal";
import { memoryAdapter } from "better-auth/adapters/memory";
import { genericOAuth } from "better-auth/plugins/generic-oauth";
import { describe, expect, test } from "vitest";
import { CALENDAR_EVENTS_SCOPE } from "../../domain/calendar/calendar_event";
import {
  googleWorkspaceProvider,
  guardGoogleOAuth,
  requestsClientScopes,
  requestsGoogleSignIn,
} from "./google_providers";

const credentials = {
  clientId: "cliente-ficticio-de-google",
  clientSecret: "secreto-ficticio",
};

/** ID token ficticio sin firma real: solo importa el payload. */
function fakeIdToken(payload: unknown): string {
  const encode = (value: unknown) =>
    btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value))))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  return `${encode({ alg: "RS256" })}.${encode(payload)}.firma-ficticia`;
}

describe("googleWorkspaceProvider", () => {
  test("cada población usa su proveedor y pide su dominio a Google", () => {
    const student = googleWorkspaceProvider("estudiante", credentials);
    const staff = googleWorkspaceProvider("personal", credentials);
    expect(student.providerId).toBe("google-alu");
    expect(student.authorizationUrlParams).toEqual({ hd: "alu.uct.cl" });
    expect(staff.providerId).toBe("google-uct");
    expect(staff.authorizationUrlParams).toEqual({ hd: "uct.cl" });
  });

  test("pide solo identidad, con PKCE y endpoints fijos de Google", () => {
    const provider = googleWorkspaceProvider("estudiante", credentials);
    expect(provider.scopes).toEqual(["openid", "email", "profile"]);
    expect(provider.pkce).toBe(true);
    expect(provider.discoveryUrl).toBeUndefined();
    expect(provider.authorizationUrl).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(provider.tokenUrl).toBe("https://oauth2.googleapis.com/token");
    expect(provider.issuer).toBe("https://accounts.google.com");
    expect(provider.clientId).toBe(credentials.clientId);
  });

  test("getUserInfo valida la población y el OAuth Client del proveedor", async () => {
    const token = fakeIdToken({
      iss: "https://accounts.google.com",
      aud: credentials.clientId,
      exp: Math.floor(Date.now() / 1000) + 3600,
      sub: "google-sub-ficticio",
      email: "estudiante.ficticio@alu.uct.cl",
      email_verified: true,
      hd: "alu.uct.cl",
      name: "Estudiante Ficticio",
    });
    const student = googleWorkspaceProvider("estudiante", credentials);
    const staff = googleWorkspaceProvider("personal", credentials);
    const otherClient = googleWorkspaceProvider("estudiante", {
      ...credentials,
      clientId: "otro-cliente-de-google",
    });
    const tokens = { idToken: token };
    await expect(student.getUserInfo?.(tokens)).resolves.toMatchObject({
      email: "estudiante.ficticio@alu.uct.cl",
    });
    await expect(staff.getUserInfo?.(tokens)).resolves.toBeNull();
    await expect(otherClient.getUserInfo?.(tokens)).resolves.toBeNull();
  });
});

describe("requestsClientScopes", () => {
  test("detecta scopes del cliente en el inicio y la vinculación genérica", () => {
    for (const path of ["/sign-in/oauth2", "/sign-in/social", "/oauth2/link"]) {
      expect(
        requestsClientScopes(path, { scopes: ["https://www.googleapis.com/auth/calendar"] }),
      ).toBe(true);
      expect(requestsClientScopes(path, { scopes: [] })).toBe(true);
    }
  });

  test("solo permite calendar.events al vincular Calendar con google", () => {
    expect(
      requestsClientScopes("/link-social", {
        provider: "google",
        scopes: [CALENDAR_EVENTS_SCOPE],
      }),
    ).toBe(false);
    expect(requestsClientScopes("/link-social", { provider: "google" })).toBe(false);
    expect(
      requestsClientScopes("/link-social", {
        provider: "google-alu",
        scopes: [CALENDAR_EVENTS_SCOPE],
      }),
    ).toBe(true);
    expect(
      requestsClientScopes("/link-social", {
        provider: "google",
        scopes: ["https://www.googleapis.com/auth/calendar"],
      }),
    ).toBe(true);
    expect(
      requestsClientScopes("/link-social", {
        provider: "google",
        scopes: [CALENDAR_EVENTS_SCOPE, "https://www.googleapis.com/auth/drive"],
      }),
    ).toBe(true);
    expect(requestsClientScopes("/link-social", { provider: "google", scopes: [] })).toBe(true);
  });

  test("permite el inicio sin scopes y las demás rutas", () => {
    expect(requestsClientScopes("/sign-in/oauth2", { providerId: "google-alu" })).toBe(false);
    expect(requestsClientScopes("/sign-in/oauth2", undefined)).toBe(false);
    expect(requestsClientScopes("/get-session", { scopes: ["openid"] })).toBe(false);
  });
});

describe("requestsGoogleSignIn", () => {
  test("bloquea el inicio por google y no los proveedores institucionales", () => {
    expect(requestsGoogleSignIn("/sign-in/social", { provider: "google" })).toBe(true);
    expect(requestsGoogleSignIn("/sign-in/social", { provider: "google-alu" })).toBe(false);
    expect(requestsGoogleSignIn("/sign-in/oauth2", { providerId: "google" })).toBe(false);
  });
});

describe("guardGoogleOAuth", () => {
  // Instancia de Better Auth en memoria con los mismos hooks y proveedores que
  // `convex/auth.ts`: confirma el comportamiento de las rutas reales.
  const auth = betterAuth({
    baseURL: "http://localhost:3000",
    secret: "secreto-ficticio-de-pruebas-con-largo-suficiente",
    database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
    socialProviders: {
      google: {
        clientId: credentials.clientId,
        clientSecret: credentials.clientSecret,
      },
    },
    hooks: { before: guardGoogleOAuth },
    plugins: [genericOAuth({ config: [googleWorkspaceProvider("estudiante", credentials)] })],
  });
  const post = (path: string, body: object) =>
    auth.handler(
      new Request(`http://localhost:3000/api/auth${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:3000" },
        body: JSON.stringify(body),
      }),
    );

  test("rechaza el inicio que pide alcances extra", async () => {
    const response = await post("/sign-in/oauth2", {
      providerId: "google-alu",
      scopes: ["https://www.googleapis.com/auth/calendar"],
    });
    expect(response.status).toBe(400);
  });

  test("rechaza el inicio por google, que solo vincula Calendar", async () => {
    const response = await post("/sign-in/social", {
      provider: "google",
      callbackURL: "/",
    });
    expect(response.status).toBe(400);
  });

  test("el inicio institucional sin alcances extra pide solo identidad con hd", async () => {
    const response = await post("/sign-in/oauth2", { providerId: "google-alu" });
    expect(response.status).toBe(200);
    const { url } = (await response.json()) as { url: string };
    const authorization = new URL(url);
    expect(authorization.origin + authorization.pathname).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
    expect(authorization.searchParams.get("scope")).toBe("openid email profile");
    expect(authorization.searchParams.get("hd")).toBe("alu.uct.cl");
  });

  test("la vinculación de Calendar llega al endpoint y exige sesión", async () => {
    const response = await post("/link-social", {
      provider: "google",
      scopes: [CALENDAR_EVENTS_SCOPE],
      callbackURL: "/",
    });
    expect(response.status).toBe(401);
  });

  test("rechaza otros alcances y otros proveedores en /link-social", async () => {
    const otherScope = await post("/link-social", {
      provider: "google",
      scopes: ["https://www.googleapis.com/auth/calendar"],
      callbackURL: "/",
    });
    expect(otherScope.status).toBe(400);

    const otherProvider = await post("/link-social", {
      provider: "google-alu",
      scopes: [CALENDAR_EVENTS_SCOPE],
      callbackURL: "/",
    });
    expect(otherProvider.status).toBe(400);
  });
});
