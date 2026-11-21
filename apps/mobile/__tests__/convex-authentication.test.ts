import { UserFacingError } from "../src/application/user-facing-error";
import {
  createAuthTokenSupplier,
  accountNotEnabledMessage,
  createConvexAuthAdapter,
  institutionalSignInFailedMessage,
  sessionCheckFailedMessage,
  type InstitutionalAuthClient,
} from "../src/infrastructure/convex-authentication";

type SessionAndRole = {
  session: { status: "authenticated"; email: string; name: string; population: string };
  role: { status: "authenticated"; role: string; email: string };
};

const unauthenticated = {
  session: { status: "unauthenticated" },
  role: { status: "unauthenticated" },
};

function authenticated(role: string): SessionAndRole {
  return {
    session: {
      status: "authenticated",
      email: "valentina@alu.uct.cl",
      name: "Valentina Rojas",
      population: "estudiante",
    },
    role: { status: "authenticated", role, email: "valentina@alu.uct.cl" },
  };
}

function withoutRole() {
  return { ...authenticated("student"), role: { status: "unauthenticated" } };
}

function setup() {
  const authClient = {
    signIn: { oauth2: jest.fn<ReturnType<InstitutionalAuthClient["signIn"]["oauth2"]>, never[]>() },
    signOut: jest.fn(async () => ({})),
    convex: { token: jest.fn() },
  };
  const tokens = createAuthTokenSupplier(authClient);
  const query = jest.fn();
  const mutation = jest.fn(async () => ({}));
  const adapter = createConvexAuthAdapter({
    authClient: authClient as unknown as InstitutionalAuthClient,
    convexClient: { query, mutation } as never,
    tokens,
  });
  return { adapter, authClient, query, mutation, tokens };
}

describe("restaurar la sesión", () => {
  test.each([
    ["student", "estudiante"],
    ["professional", "profesional"],
    ["intern", "practicante"],
    ["admin", "administrador"],
  ])("traduce el rol %s del servidor a %s", async (serverRole, appRole) => {
    const { adapter, authClient, query } = setup();
    authClient.convex.token.mockResolvedValue({ data: { token: "jwt" }, error: null });
    query.mockResolvedValue(authenticated(serverRole));

    await expect(adapter.restoreSession()).resolves.toEqual({
      user: {
        id: "valentina@alu.uct.cl",
        displayName: "Valentina Rojas",
        email: "valentina@alu.uct.cl",
        role: appRole,
        assignedAccompaniments: [],
      },
    });
    expect(authClient.signOut).not.toHaveBeenCalled();
  });

  test("sin token no consulta el rol y deja el dispositivo sin datos de la cuenta", async () => {
    const { adapter, authClient, query } = setup();
    authClient.convex.token.mockResolvedValue({ data: null, error: { status: 401 } });

    await expect(adapter.restoreSession()).resolves.toBeNull();
    expect(query).not.toHaveBeenCalled();
    expect(authClient.signOut).toHaveBeenCalledTimes(1);
  });

  test("una sesión inválida del servidor no entra a la app y se descarta", async () => {
    const { adapter, authClient, query, mutation } = setup();
    authClient.convex.token.mockResolvedValue({ data: { token: "jwt" }, error: null });
    query.mockResolvedValue(unauthenticated);

    await expect(adapter.restoreSession()).resolves.toBeNull();
    expect(mutation).not.toHaveBeenCalled();
    expect(authClient.signOut).toHaveBeenCalledTimes(1);
  });

  test("en el primer ingreso crea el perfil propio y entra con el rol del servidor", async () => {
    const { adapter, authClient, query, mutation } = setup();
    authClient.convex.token.mockResolvedValue({ data: { token: "jwt" }, error: null });
    query.mockResolvedValueOnce(withoutRole()).mockResolvedValueOnce(authenticated("student"));

    await expect(adapter.restoreSession()).resolves.toMatchObject({
      user: { role: "estudiante" },
    });
    expect(mutation).toHaveBeenCalledTimes(1);
    expect(authClient.signOut).not.toHaveBeenCalled();
  });

  test.each([
    ["la cuenta queda pendiente de habilitación", async () => ({})],
    [
      "el servidor rechaza crear el perfil",
      async () => {
        throw new Error("No autorizado");
      },
    ],
  ])("si %s, avisa que no está habilitada y descarta la sesión", async (_name, ensure) => {
    const { adapter, authClient, query, mutation } = setup();
    authClient.convex.token.mockResolvedValue({ data: { token: "jwt" }, error: null });
    query.mockResolvedValue(withoutRole());
    mutation.mockImplementation(ensure);

    const error = await adapter.restoreSession().catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(UserFacingError);
    expect((error as Error).message).toBe(accountNotEnabledMessage);
    expect(authClient.signOut).toHaveBeenCalledTimes(1);
  });

  test("un fallo de red al crear el perfil no cierra la sesión y se puede reintentar", async () => {
    const { adapter, authClient, query, mutation } = setup();
    authClient.convex.token.mockResolvedValue({ data: { token: "jwt" }, error: null });
    query.mockResolvedValue(withoutRole());
    mutation.mockRejectedValue(
      Object.assign(new Error("Network request failed"), {
        code: "network_error",
      }),
    );

    const error = await adapter.restoreSession().catch((cause: unknown) => cause);
    expect((error as Error).message).toBe(sessionCheckFailedMessage);
    expect(authClient.signOut).not.toHaveBeenCalled();
  });

  test("un fallo de red no cierra la sesión guardada y se puede reintentar", async () => {
    const { adapter, authClient } = setup();
    authClient.convex.token.mockRejectedValue(new TypeError("Network request failed"));

    const error = await adapter.restoreSession().catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(UserFacingError);
    expect((error as Error).message).toBe(sessionCheckFailedMessage);
    expect(authClient.signOut).not.toHaveBeenCalled();
  });
});

describe("ingreso institucional", () => {
  test.each([
    ["estudiante", "google-alu"],
    ["personal", "google-uct"],
  ] as const)("la población %s usa el proveedor %s y vuelve a la app", async (population, id) => {
    const { adapter, authClient, query } = setup();
    authClient.signIn.oauth2.mockResolvedValue({});
    authClient.convex.token.mockResolvedValue({ data: { token: "jwt" }, error: null });
    query.mockResolvedValue(authenticated("professional"));

    await expect(adapter.signInInstitutional(population)).resolves.toMatchObject({
      user: { role: "profesional" },
    });
    expect(authClient.signIn.oauth2).toHaveBeenCalledWith({
      providerId: id,
      callbackURL: "/",
      errorCallbackURL: "/",
    });
  });

  test("si la persona cancela en el navegador no hay sesión ni cuenta ficticia", async () => {
    const { adapter, authClient, query } = setup();
    authClient.signIn.oauth2.mockResolvedValue({});
    authClient.convex.token.mockResolvedValue({ data: null, error: { status: 401 } });

    await expect(adapter.signInInstitutional("estudiante")).resolves.toBeNull();
    expect(query).not.toHaveBeenCalled();
  });

  test("un rechazo del proveedor muestra un mensaje genérico sin su motivo", async () => {
    const { adapter, authClient } = setup();
    authClient.signIn.oauth2.mockResolvedValue({
      error: { status: 400, message: "hd mismatch para alguien@gmail.com" },
    });

    const error = await adapter.signInInstitutional("estudiante").catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(UserFacingError);
    expect((error as Error).message).toBe(institutionalSignInFailedMessage);
    expect((error as Error).message).not.toMatch(/gmail|hd mismatch/);
  });

  test("una red caída al abrir el ingreso se puede reintentar", async () => {
    const { adapter, authClient } = setup();
    authClient.signIn.oauth2.mockRejectedValue(new TypeError("Network request failed"));

    await expect(adapter.signInInstitutional("personal")).rejects.toThrow(
      institutionalSignInFailedMessage,
    );
  });

  test("no reutiliza el token de la cuenta anterior al ingresar con otra", async () => {
    const { adapter, authClient, query } = setup();
    authClient.signIn.oauth2.mockResolvedValue({});
    authClient.convex.token
      .mockResolvedValueOnce({ data: { token: "cuenta-anterior" }, error: null })
      .mockResolvedValueOnce({ data: { token: "cuenta-nueva" }, error: null });
    query.mockResolvedValue(authenticated("student"));

    await adapter.restoreSession();
    await adapter.signInInstitutional("estudiante");

    expect(authClient.convex.token).toHaveBeenCalledTimes(2);
  });
});

describe("cerrar sesión", () => {
  test("borra la sesión local aunque el servidor no responda", async () => {
    const { adapter, authClient, tokens } = setup();
    authClient.convex.token.mockResolvedValue({ data: { token: "jwt" }, error: null });
    await tokens.getAuthToken();
    authClient.signOut.mockRejectedValue(new TypeError("Network request failed"));

    await expect(adapter.logout(null)).resolves.toBeUndefined();

    authClient.convex.token.mockResolvedValue({ data: null, error: { status: 401 } });
    await expect(tokens.getAuthToken()).resolves.toBeNull();
    expect(authClient.convex.token).toHaveBeenCalledTimes(2);
  });
});

describe("token de la sesión", () => {
  test("reutiliza el token mientras es reciente y pide otro cuando pasa el plazo", async () => {
    let now = 0;
    const authClient = { convex: { token: jest.fn() } };
    authClient.convex.token
      .mockResolvedValueOnce({ data: { token: "uno" }, error: null })
      .mockResolvedValueOnce({ data: { token: "dos" }, error: null });
    const tokens = createAuthTokenSupplier(authClient, () => now);

    await expect(tokens.getAuthToken()).resolves.toBe("uno");
    now = 60_000;
    await expect(tokens.getAuthToken()).resolves.toBe("uno");
    now = 6 * 60_000;
    await expect(tokens.getAuthToken()).resolves.toBe("dos");
  });

  test("distingue la sesión ausente (401) de un fallo del servidor", async () => {
    const authClient = { convex: { token: jest.fn() } };
    const tokens = createAuthTokenSupplier(authClient);
    authClient.convex.token.mockResolvedValueOnce({ data: null, error: { status: 401 } });
    await expect(tokens.getAuthToken()).resolves.toBeNull();

    authClient.convex.token.mockResolvedValueOnce({ data: null, error: { status: 500 } });
    await expect(tokens.getAuthToken()).rejects.toThrow("token de la sesión");
  });
});
