import { describe, expect, test } from "vitest";
import { CALENDAR_EVENTS_SCOPE } from "../../domain/calendar/calendar_event";
import type { CalendarConnectionMetadata } from "../../domain/calendar/calendar_link";
import type { AuthorizationReader } from "../authorization/authorize";
import {
  checkCalendarLinkAccess,
  confirmCalendarLink,
  getCalendarLinkStatus,
  markCalendarDisconnected,
  revokeCalendarOAuthAccess,
  type CalendarLinkMetadataStore,
  type CalendarLinkSyncScheduler,
  type CalendarOAuthAccess,
  type CalendarOAuthLinkReader,
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

const intern: FakeProfile = {
  _id: "user-intern",
  role: "intern",
  institutionalStatus: "enabled",
  accountStatus: "active",
  tokenIdentifier: "token-intern",
};

const admin: FakeProfile = {
  _id: "user-admin",
  role: "admin",
  institutionalStatus: "enabled",
  accountStatus: "active",
  tokenIdentifier: "token-admin",
};

const inactive: FakeProfile = {
  _id: "user-inactive",
  role: "student",
  institutionalStatus: "disabled",
  accountStatus: "active",
  tokenIdentifier: "token-inactive",
};

function fakeAuth(): AuthorizationReader {
  const profiles = [student, professional, intern, admin, inactive];
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

function fakeAccess(
  tokens:
    | { readonly accessToken: string | null; readonly refreshToken: string | null }
    | "missing"
    | "unavailable" = {
    accessToken: "access-ficticio",
    refreshToken: "refresh-ficticio",
  },
  revoke: "revoked" | "already_invalid" | "unavailable" = "revoked",
): CalendarOAuthAccess & { readonly calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    readTokens: async () => {
      calls.push("read");
      if (tokens === "missing") return { status: "missing" as const };
      if (tokens === "unavailable") return { status: "unavailable" as const };
      return { status: "found" as const, tokens };
    },
    revokeToken: async (token) => {
      calls.push(`revoke:${token}`);
      return revoke;
    },
    deleteAccount: async () => {
      calls.push("delete");
      return "deleted" as const;
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

function linkSync(): {
  readonly linkSync: CalendarLinkSyncScheduler & {
    readonly scheduled: { readonly userId: string; readonly now: number }[];
  };
} {
  const scheduled: { readonly userId: string; readonly now: number }[] = [];
  return {
    linkSync: {
      scheduled,
      scheduleFutureSync: async (userId, now) => {
        scheduled.push({ userId, now });
      },
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
      { auth: fakeAuth(), oauth: fakeOAuth([]), store, now: () => 3000, ...linkSync() },
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
        ...linkSync(),
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
      {
        auth: fakeAuth(),
        oauth: fakeOAuth([CALENDAR_EVENTS_SCOPE]),
        store,
        now: () => 3000,
        ...linkSync(),
      },
      { tokenIdentifier: "token-pro" },
    );
    expect(store.writes).toEqual([{ userId: "user-pro", kind: "connect" }]);
  });

  test("practicante y administrador reciben unauthorized", async () => {
    for (const tokenIdentifier of ["token-intern", "token-admin"]) {
      const store = fakeStore();
      const result = await confirmCalendarLink(
        {
          auth: fakeAuth(),
          oauth: fakeOAuth([CALENDAR_EVENTS_SCOPE]),
          store,
          now: () => 3000,
          ...linkSync(),
        },
        { tokenIdentifier },
      );
      expect(result).toEqual({
        status: "error",
        error: { code: "unauthorized", message: "No autorizado" },
      });
      expect(store.writes).toHaveLength(0);
    }
  });

  test("sin sesión o sin vigencia responde unauthorized con código", async () => {
    for (const tokenIdentifier of [null, "token-missing", "token-inactive"]) {
      const result = await confirmCalendarLink(
        {
          auth: fakeAuth(),
          oauth: fakeOAuth([CALENDAR_EVENTS_SCOPE]),
          store: fakeStore(),
          now: () => 3000,
          ...linkSync(),
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
        ...linkSync(),
      },
      { tokenIdentifier: "token-student" },
    );
    expect(result).toEqual({
      status: "error",
      error: { code: "conflict", message: "La solicitud entra en conflicto con el estado actual." },
    });
  });

  test("al vincular programa el recorrido por páginas de las futuras vigentes", async () => {
    const sync = linkSync();
    const result = await confirmCalendarLink(
      {
        auth: fakeAuth(),
        oauth: fakeOAuth([CALENDAR_EVENTS_SCOPE]),
        store: fakeStore(),
        linkSync: sync.linkSync,
        now: () => 3000,
      },
      { tokenIdentifier: "token-student" },
    );
    expect(result.status).toBe("ok");
    expect(sync.linkSync.scheduled).toEqual([{ userId: "user-student", now: 3000 }]);
  });

  test("rechazar la autorización no programa nada", async () => {
    const sync = linkSync();
    const result = await confirmCalendarLink(
      {
        auth: fakeAuth(),
        oauth: fakeOAuth([]),
        store: fakeStore(),
        linkSync: sync.linkSync,
        now: () => 3000,
      },
      { tokenIdentifier: "token-student" },
    );
    expect(result).toEqual({ status: "ok", data: { connected: false, status: "not_connected" } });
    expect(sync.linkSync.scheduled).toHaveLength(0);
  });
});

describe("checkCalendarLinkAccess", () => {
  test("estudiante y profesional acceden; otros roles, nadie", async () => {
    for (const [tokenIdentifier, expected] of [
      ["token-student", true],
      ["token-pro", true],
      ["token-intern", false],
      ["token-admin", false],
      ["token-inactive", false],
      ["token-missing", false],
      [null, false],
    ] as const) {
      expect(await checkCalendarLinkAccess({ auth: fakeAuth() }, { tokenIdentifier })).toBe(
        expected,
      );
    }
  });
});

describe("revokeCalendarOAuthAccess", () => {
  test("revoca antes de borrar, con el refresh token", async () => {
    const access = fakeAccess();
    const result = await revokeCalendarOAuthAccess({ access });
    expect(result).toEqual({ status: "ok", data: { status: "revoked" } });
    expect(access.calls).toEqual(["read", "revoke:refresh-ficticio", "delete"]);
  });

  test("un token ya inválido cuenta como revocado y borra igual", async () => {
    const access = fakeAccess(undefined, "already_invalid");
    const result = await revokeCalendarOAuthAccess({ access });
    expect(result).toEqual({ status: "ok", data: { status: "revoked" } });
    expect(access.calls).toEqual(["read", "revoke:refresh-ficticio", "delete"]);
  });

  test("sin cuenta vinculada responde not_found sin llamar a Google", async () => {
    const access = fakeAccess("missing");
    const result = await revokeCalendarOAuthAccess({ access });
    expect(result).toEqual({ status: "ok", data: { status: "not_found" } });
    expect(access.calls).toEqual(["read"]);
  });

  test("sin lectura de tokens responde conflict sin borrar ni revocar", async () => {
    const access = fakeAccess("unavailable");
    const result = await revokeCalendarOAuthAccess({ access });
    expect(result).toEqual({
      status: "error",
      error: { code: "conflict", message: "La solicitud entra en conflicto con el estado actual." },
    });
    expect(access.calls).toEqual(["read"]);
  });

  test("si Google no responde no borra nada y responde conflict", async () => {
    const access = fakeAccess(undefined, "unavailable");
    const result = await revokeCalendarOAuthAccess({ access });
    expect(result).toEqual({
      status: "error",
      error: { code: "conflict", message: "La solicitud entra en conflicto con el estado actual." },
    });
    expect(access.calls).toEqual(["read", "revoke:refresh-ficticio"]);
  });

  test("sin refresh token revoca con el access token", async () => {
    const access = fakeAccess({ accessToken: "access-ficticio", refreshToken: null });
    const result = await revokeCalendarOAuthAccess({ access });
    expect(result).toEqual({ status: "ok", data: { status: "revoked" } });
    expect(access.calls).toEqual(["read", "revoke:access-ficticio", "delete"]);
  });
});

describe("markCalendarDisconnected", () => {
  test("desconecta lo propio con aviso de eventos previos", async () => {
    const store = fakeStore({ "user-student": { linkedAt: 1000 } });
    const result = await markCalendarDisconnected(
      { auth: fakeAuth(), store, now: () => 2000 },
      { tokenIdentifier: "token-student", revoked: "revoked" },
    );
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.data.disconnected).toBe(true);
    expect(result.data.staleEventsMayRemain).toBe(true);
    expect(result.data.revokedAt).toBe(2000);
    expect(store.writes).toEqual([{ userId: "user-student", kind: "disconnect" }]);
  });

  test("si se revocó en Google informa desconectado aunque no haya fila local", async () => {
    const store = fakeStore();
    const result = await markCalendarDisconnected(
      { auth: fakeAuth(), store, now: () => 2000 },
      { tokenIdentifier: "token-student", revoked: "revoked" },
    );
    expect(result).toEqual({
      status: "ok",
      data: { disconnected: true, status: "unlinked", staleEventsMayRemain: true },
    });
  });

  test("el profesional también desconecta lo propio", async () => {
    const store = fakeStore({ "user-pro": { linkedAt: 1000 } });
    const result = await markCalendarDisconnected(
      { auth: fakeAuth(), store, now: () => 2000 },
      { tokenIdentifier: "token-pro", revoked: "revoked" },
    );
    expect(result.status).toBe("ok");
  });

  test("una persona no desconecta la cuenta de otra", async () => {
    const store = fakeStore({ "user-student": { linkedAt: 1000 } });
    const result = await markCalendarDisconnected(
      { auth: fakeAuth(), store, now: () => 2000 },
      { tokenIdentifier: "token-pro", revoked: "not_found" },
    );
    expect(result).toEqual({
      status: "ok",
      data: { disconnected: false, status: "not_found", staleEventsMayRemain: false },
    });
    expect(store.writes).toEqual([{ userId: "user-pro", kind: "disconnect" }]);
  });

  test("practicante y administrador reciben unauthorized", async () => {
    for (const tokenIdentifier of ["token-intern", "token-admin"]) {
      const result = await markCalendarDisconnected(
        { auth: fakeAuth(), store: fakeStore(), now: () => 2000 },
        { tokenIdentifier, revoked: "not_found" },
      );
      expect(result).toEqual({
        status: "error",
        error: { code: "unauthorized", message: "No autorizado" },
      });
    }
  });

  test("es idempotente y no bloquea la reserva", async () => {
    const store = fakeStore({ "user-student": { linkedAt: 1000, revokedAt: 2000 } });
    const result = await markCalendarDisconnected(
      { auth: fakeAuth(), store, now: () => 3000 },
      { tokenIdentifier: "token-student", revoked: "not_found" },
    );
    expect(result.status).toBe("ok");
  });

  test("sin sesión responde unauthorized con código", async () => {
    const result = await markCalendarDisconnected(
      { auth: fakeAuth(), store: fakeStore(), now: () => 2000 },
      { tokenIdentifier: null, revoked: "not_found" },
    );
    expect(result).toEqual({
      status: "error",
      error: { code: "unauthorized", message: "No autorizado" },
    });
  });
});
