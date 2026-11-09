import {
  createConvexDataDependencies,
  createDemoDataDependencies,
  getMobileConvexClient,
  mobileDependencies,
} from "../composition/mobile-dependencies";
import { API_ERROR_MESSAGES, type ApiErrorCode } from "../../../../convex/domain/errors/api_error";
import { makeFunctionReference } from "convex/server";
import { api } from "../../../../convex/_generated/api";
import { UserFacingError } from "../application/user-facing-error";
import {
  isMobileAccessDenied,
  toMobileOperationError,
} from "../presentation/to-mobile-operation-error";
import { createMobileConvexClient } from "./convex-client";

const deploymentUrl = "https://mobile-test.convex.cloud";
const fallback = "No se pudo completar la operación.";

function httpResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => "Detalle interno que no se debe mostrar",
  } as Response;
}

function setup() {
  const fetchMock = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>();
  return { fetchMock, client: createMobileConvexClient(deploymentUrl, fetchMock) };
}

test("consulta la API pública con el SDK real y conserva la respuesta sin inventar una sesión", async () => {
  const { client, fetchMock } = setup();
  fetchMock.mockResolvedValue(
    httpResponse({ status: "success", value: { status: "unauthenticated" } }),
  );
  await expect(client.query(api.presentation.session.getSessionState, {})).resolves.toEqual({
    status: "unauthenticated",
  });
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe(`${deploymentUrl}/api/query`);
  expect(JSON.parse(init!.body as string)).toMatchObject({
    path: "presentation/session:getSessionState",
    args: [{}],
  });
  expect(init!.headers).not.toHaveProperty("Authorization");
});

test("conserva null como ausencia de datos válida", async () => {
  const { client, fetchMock } = setup();
  fetchMock.mockResolvedValue(httpResponse({ status: "success", value: null }));
  await expect(client.query(api.presentation.session.getSessionState, {})).resolves.toBeNull();
});

test("distingue una red caída y permite reintentar sin mostrar el error técnico", async () => {
  const { client, fetchMock } = setup();
  fetchMock.mockRejectedValueOnce(new TypeError("Network request failed: detalle privado"));
  const error = await client
    .query(api.presentation.session.getSessionState, {})
    .catch((error: unknown) => error);
  expect(error).toMatchObject({ code: "network_error" });
  expect(isMobileAccessDenied(error)).toBe(false);
  expect(toMobileOperationError(error, fallback).message).toBe(
    "No se pudo conectar. Revisa tu conexión e intenta nuevamente.",
  );
  fetchMock.mockResolvedValue(
    httpResponse({ status: "success", value: { status: "unauthenticated" } }),
  );
  await expect(client.query(api.presentation.session.getSessionState, {})).resolves.toEqual({
    status: "unauthenticated",
  });
});

test.each(["unauthorized", "conflict", "no_availability", "internal"])(
  "conserva el código público %s y oculta detalles del servidor",
  async (code) => {
    const { client, fetchMock } = setup();
    fetchMock.mockResolvedValue(
      httpResponse(
        {
          status: "error",
          errorMessage: "Detalle interno",
          errorData: { code, message: "Información privada" },
        },
        560,
      ),
    );
    const error = await client
      .query(api.presentation.session.getSessionState, {})
      .catch((error: unknown) => error);
    expect(isMobileAccessDenied(error)).toBe(code === "unauthorized");
    const visible = toMobileOperationError(error, fallback);
    expect(visible).toBeInstanceOf(UserFacingError);
    expect(visible.message).not.toMatch(/privada|interno/);
    expect(visible.message).toBe(API_ERROR_MESSAGES[code as ApiErrorCode] ?? fallback);
  },
);

test.each([401, 403])("reconoce acceso rechazado por HTTP %s", async (status) => {
  const { client, fetchMock } = setup();
  fetchMock.mockResolvedValue(httpResponse({}, status));
  const error = await client
    .query(api.presentation.session.getSessionState, {})
    .catch((error: unknown) => error);
  expect(isMobileAccessDenied(error)).toBe(true);
  expect(toMobileOperationError(error, fallback).message).toBe("No autorizado");
});

test("un error HTTP del servidor no se clasifica como fallo de red ni acceso denegado", async () => {
  const { client, fetchMock } = setup();
  fetchMock.mockResolvedValue(httpResponse({}, 500));
  const error = await client
    .query(api.presentation.session.getSessionState, {})
    .catch((error: unknown) => error);
  expect(error).not.toHaveProperty("code", "network_error");
  expect(isMobileAccessDenied(error)).toBe(false);
  expect(toMobileOperationError(error, fallback).message).toBe(fallback);
});

test.each([undefined, "", "   ", "not-a-url", "https://mobile-test.convex.site"])(
  "rechaza configuración ausente o inválida: %s",
  (url) => {
    const fetchMock = jest.fn();
    expect(() => createMobileConvexClient(url, fetchMock)).toThrow(/.+/);
    expect(fetchMock).not.toHaveBeenCalled();
  },
);

test("usa el mismo transporte para mutations y actions públicas", async () => {
  const { client, fetchMock } = setup();
  fetchMock.mockResolvedValue(httpResponse({ status: "success", value: null }));
  await client.mutation(api.presentation.requests.createRequest, { accessNeeds: "Acceso físico" });
  // Una referencia pública tipada permite probar actions sin inventar un endpoint de CERETI.
  await client.action(makeFunctionReference<"action">("test:publicAction"), {});
  expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
    `${deploymentUrl}/api/mutation`,
    `${deploymentUrl}/api/action`,
  ]);
});

test("la composición valida la variable y comparte el cliente entre fábricas por rol sin cambiar la demostración", () => {
  const previousUrl = process.env.EXPO_PUBLIC_CONVEX_URL;
  const demoReader = mobileDependencies.studentAreaReader;
  try {
    delete process.env.EXPO_PUBLIC_CONVEX_URL;
    expect(() => getMobileConvexClient()).toThrow("EXPO_PUBLIC_CONVEX_URL");
    process.env.EXPO_PUBLIC_CONVEX_URL = deploymentUrl;
    const ports = createDemoDataDependencies();
    const factories = {
      student: jest.fn(() => ({
        studentAreaReader: ports.studentAreaReader,
        studentRequestSubmitter: ports.studentRequestSubmitter,
      })),
      professional: jest.fn(() => ({
        professionalAgendaReader: ports.professionalAgendaReader,
        professionalAccompanimentReader: ports.professionalAccompanimentReader,
        professionalReviewPort: ports.professionalReviewPort,
      })),
      intern: jest.fn(() => ({ internAccompanimentReader: ports.internAccompanimentReader })),
      administrator: jest.fn(() => ({
        administratorAccountsPort: ports.administratorAccountsPort,
      })),
    };
    expect(createConvexDataDependencies(factories)).toEqual(ports);
    for (const factory of Object.values(factories)) {
      expect(factory).toHaveBeenCalledWith(getMobileConvexClient());
    }
    expect(mobileDependencies.studentAreaReader).toBe(demoReader);
  } finally {
    if (previousUrl === undefined) delete process.env.EXPO_PUBLIC_CONVEX_URL;
    else process.env.EXPO_PUBLIC_CONVEX_URL = previousUrl;
  }
});
