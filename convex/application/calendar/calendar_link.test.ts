import { describe, expect, test } from "vitest";
import { CALENDAR_EVENTS_SCOPE } from "../../domain/calendar/calendar_event";
import type { CalendarConnectionMetadata } from "../../domain/calendar/calendar_link";
import type { AuthorizationReader } from "../authorization/authorize";
import {
  confirmCalendarLink,
  disconnectCalendarLink,
  getCalendarLinkStatus,
  type CalendarLinkMetadataStore,
  type CalendarOAuthLinkReader,
  type CalendarOAuthRevoker,
} from "./calendar_link";

type FakeProfile = {
  readonly _id: string;
  readonly role: "student" | "professional" | "intern" | "admin";
  readonly institutionalStatus: "enabled" | "disabled" | "pending";
  readonly accountStatus: "active" | "inactive";
  readonly tokenIdentifier: string;
};

const student: FakeProfile = {
  _id: "user-student",
  role: "student",
  institutionalStatus: "enabled",
  accountStatus: "active",
  tokenIdentifier: "token-student",
};

const professional: FakeProfile = {
  _id: "user-pro",
  role: "professional",
  institutionalStatus: "enabled",
  accountStatus: "active",
  tokenIdentifier: "token-pro",
};

const inactive: FakeProfile = {
  _id: "user-inactive",
  role: "student",
  institutionalStatus: "disabled",
  accountStatus: "active",
  tokenIdentifier: "token-inactive",
};

function fakeAuth(): AuthorizationReader {
  const profiles = [student, professional, inactive];
  return {
    findProfileByTokenIdentifier: async (tokenIdentifier) =>
      profiles.find((row) => row.tokenIdentifier === tokenIdentifier) ?? null,
    getProfileById: async (userId) => profiles.find((row) => row._id === userId) ?? null,
    getAccompaniment: async () => null,
    findActiveAssignments: async () => [],
  };
}

function fakeOAuth(
  scopes: readonly string[] | null,
  reference: string | null = "google-account-1",
): CalendarOAuthLinkReader {
  return {
    listGoogleScopes: async () => scopes,
    getAccountReference: async () => reference,
  };
}

function fakeRevoker(
  result: "revoked" | "not_found" | "unavailable" = "revoked",
): CalendarOAuthRevoker & { readonly calls: number } {
  const state = { calls: 0 };
  return {
    get calls() {
      return state.calls;
    },
    revokeAccess: async () => {
      state.calls += 1;
      return result;
    },
  };
}

function fakeStore(
  initial: Record<string, CalendarConnectionMetadata> = {},
): CalendarLinkMetadataStore & {
  readonly writes: Array<{ readonly userId: string; readonly kind: "connect" | "disconnect" }>;
} {
  const rows = new Map<string, CalendarConnectionMetadata>(Object.entries(initial));
  const writes: Array<{ readonly userId: string; readonly kind: "connect" | "disconnect" }> = [];
  return {
    writes,
    readMetadata: async (userId) => rows.get(userId) ?? null,
    connect: async (userId, _reference, now) => {
      if (userId === "missing") return { status: "invalid_reference" as const };
      writes.push({ userId, kind: "connect" });
      const existing = rows.get(userId);
      if (existing !== undefined && existing.revokedAt === undefined) {
        return { status: "already_linked" as const };
      }
      rows.set(userId, { linkedAt: existing?.linkedAt ?? now });
      return { status: existing === undefined ? ("linked" as const) : ("linked" as const) };
    },
    disconnect: async (userId, now) => {
      writes.push({ userId, kind: "disconnect" });
      const existing = rows.get(userId);
      if (existing === undefined) return { status: "not_found" as const };
      if (existing.revokedAt !== undefined) return { status: "already_unlinked" as const };
      rows.set(userId, { ...existing, revokedAt: now });
      return { status: "unlinked" as const };
    },
  };
}

describe("getCalendarLinkStatus", () => {
  test("exige sesión con perfil vigente", async () => {
    for (const tokenIdentifier of [null, "token-missing", "token-inactive"]) {
      const result = await getCalendarLinkStatus(
        { auth: fakeAuth(), oauth: fakeOAuth([CALENDAR_EVENTS_SCOPE]), store: fakeStore() },
        { tokenIdentifier },
      );
      expect(result).toEqual({
        status: "error",
        error: { code: "unauthorized", message: "No autorizado" },
      });
    }
  });

  test("confirma conectado solo con el alcance mínimo y sin credenciales", async () => {
    const result = await getCalendarLinkStatus(
      {
        auth: fakeAuth(),
        oauth: fakeOAuth([CALENDAR_EVENTS_SCOPE]),
        store: fakeStore({ "user-student": { linkedAt: 1000 } }),
      },
      { tokenIdentifier: "token-student" },
    );
    expect(result).toEqual({
      status: "ok",
      data: { connected: true, linkedAt: 1000, staleEventsMayRemain: false },
    });
    expect(JSON.stringify(result).toLowerCase()).not.toMatch(
      /token|secret|refresh|scope|account|correo/,
    );
  });

  test("el inicio institucional no cuenta como Calendar", async () => {
    const result = await getCalendarLinkStatus(
      { auth: fakeAuth(), oauth: fakeOAuth(["openid", "email", "profile"]), store: fakeStore() },
      { tokenIdentifier: "token-student" },
    );
    expect(result).toEqual({
      status: "ok",
      data: { connected: false, staleEventsMayRemain: false },
    });
  });

  test("avisa eventos previos tras desconexión local", async () => {
    const result = await getCalendarLinkStatus(
      {
        auth: fakeAuth(),
        oauth: fakeOAuth(null),
        store: fakeStore({ "user-student": { linkedAt: 1000, revokedAt: 2000 } }),
      },
      { tokenIdentifier: "token-student" },
    );
    expect(result).toEqual({
      status: "ok",
      data: { connected: false, linkedAt: 1000, revokedAt: 2000, staleEventsMayRemain: true },
    });
  });

  test("profesional también publica su propio vínculo", async () => {
    const result = await getCalendarLinkStatus(
      { auth: fakeAuth(), oauth: fakeOAuth([CALENDAR_EVENTS_SCOPE]), store: fakeStore() },
      { tokenIdentifier: "token-pro" },
    );
    expect(result).toEqual({
      status: "ok",
      data: { connected: true, staleEventsMayRemain: false },
    });
  });
});

describe("confirmCalendarLink", () => {
  test("rechazar la autorización no bloquea: responde desconectado sin error", async () => {
    const store = fakeStore();
    const result = await confirmCalendarLink(
      { auth: fakeAuth(), oauth: fakeOAuth([]), store, now: () => 3000 },
      { tokenIdentifier: "token-student" },
    );
    expect(result).toEqual({ status: "ok", data: { connected: false, status: "not_connected" } });
    expect(store.writes).toHaveLength(0);
  });

  test("vincula la cuenta propia con referencia del servidor", async () => {
    const store = fakeStore();
    const result = await confirmCalendarLink(
      {
        auth: fakeAuth(),
        oauth: fakeOAuth(["openid", CALENDAR_EVENTS_SCOPE]),
        store,
        now: () => 3000,
      },
      { tokenIdentifier: "token-student" },
    );
    expect(result.status).toBe("ok");
    expect(store.writes).toEqual([{ userId: "user-student", kind: "connect" }]);
    expect(JSON.stringify(result).toLowerCase()).not.toMatch(/token|secret|refresh|account|correo/);
  });

  test("una persona no vincula la cuenta de otra", async () => {
    const store = fakeStore();
    await confirmCalendarLink(
      { auth: fakeAuth(), oauth: fakeOAuth([CALENDAR_EVENTS_SCOPE]), store, now: () => 3000 },
      { tokenIdentifier: "token-pro" },
    );
    expect(store.writes).toEqual([{ userId: "user-pro", kind: "connect" }]);
  });

  test("sin sesión o sin vigencia responde unauthorized con código", async () => {
    for (const tokenIdentifier of [null, "token-missing", "token-inactive"]) {
      const result = await confirmCalendarLink(
        {
          auth: fakeAuth(),
          oauth: fakeOAuth([CALENDAR_EVENTS_SCOPE]),
          store: fakeStore(),
          now: () => 3000,
        },
        { tokenIdentifier },
      );
      expect(result).toEqual({
        status: "error",
        error: { code: "unauthorized", message: "No autorizado" },
      });
    }
  });

  test("un instante inválido responde conflict, no Error con texto", async () => {
    const result = await confirmCalendarLink(
      {
        auth: fakeAuth(),
        oauth: fakeOAuth([CALENDAR_EVENTS_SCOPE]),
        store: fakeStore(),
        now: () => 0,
      },
      { tokenIdentifier: "token-student" },
    );
    expect(result).toEqual({
      status: "error",
      error: { code: "conflict", message: "La solicitud entra en conflicto con el estado actual." },
    });
  });
});

describe("disconnectCalendarLink", () => {
  test("desconecta lo propio con aviso de eventos previos", async () => {
    const store = fakeStore({ "user-student": { linkedAt: 1000 } });
    const revoker = fakeRevoker("revoked");
    const result = await disconnectCalendarLink(
      { auth: fakeAuth(), oauth: revoker, store, now: () => 2000 },
      { tokenIdentifier: "token-student" },
    );
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.data.disconnected).toBe(true);
    expect(result.data.staleEventsMayRemain).toBe(true);
    expect(result.data.revokedAt).toBe(2000);
    expect(revoker.calls).toBe(1);
    expect(store.writes).toEqual([{ userId: "user-student", kind: "disconnect" }]);
  });

  test("revoca el acceso aunque no haya fila local del flujo anterior", async () => {
    const store = fakeStore();
    const result = await disconnectCalendarLink(
      { auth: fakeAuth(), oauth: fakeRevoker("revoked"), store, now: () => 2000 },
      { tokenIdentifier: "token-student" },
    );
    expect(result).toEqual({
      status: "ok",
      data: { disconnected: true, status: "unlinked", staleEventsMayRemain: true },
    });
  });

  test("si la revocación falla no marca nada local y responde conflict", async () => {
    const store = fakeStore({ "user-student": { linkedAt: 1000 } });
    const result = await disconnectCalendarLink(
      { auth: fakeAuth(), oauth: fakeRevoker("unavailable"), store, now: () => 2000 },
      { tokenIdentifier: "token-student" },
    );
    expect(result).toEqual({
      status: "error",
      error: { code: "conflict", message: "La solicitud entra en conflicto con el estado actual." },
    });
    expect(store.writes).toHaveLength(0);
  });

  test("una persona no desconecta la cuenta de otra", async () => {
    const store = fakeStore({ "user-student": { linkedAt: 1000 } });
    const result = await disconnectCalendarLink(
      { auth: fakeAuth(), oauth: fakeRevoker("not_found"), store, now: () => 2000 },
      { tokenIdentifier: "token-pro" },
    );
    expect(result).toEqual({
      status: "ok",
      data: { disconnected: false, status: "not_found", staleEventsMayRemain: false },
    });
    expect(store.writes).toEqual([{ userId: "user-pro", kind: "disconnect" }]);
  });

  test("es idempotente y no bloquea la reserva", async () => {
    const store = fakeStore({ "user-student": { linkedAt: 1000, revokedAt: 2000 } });
    const result = await disconnectCalendarLink(
      { auth: fakeAuth(), oauth: fakeRevoker("not_found"), store, now: () => 3000 },
      { tokenIdentifier: "token-student" },
    );
    expect(result.status).toBe("ok");
  });

  test("sin sesión responde unauthorized con código", async () => {
    const result = await disconnectCalendarLink(
      { auth: fakeAuth(), oauth: fakeRevoker(), store: fakeStore(), now: () => 2000 },
      { tokenIdentifier: null },
    );
    expect(result).toEqual({
      status: "error",
      error: { code: "unauthorized", message: "No autorizado" },
    });
  });
});
