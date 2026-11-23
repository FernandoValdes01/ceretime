import { ConvexHttpClient } from "convex/browser";
import type { FunctionArgs, FunctionReference, FunctionReturnType } from "convex/server";

/** Tope de espera de cada petición a Convex, también al pedir el token de la sesión. */
export const REQUEST_TIMEOUT_MS = 15_000;

export class MobileNetworkError extends Error {
  readonly code = "network_error";
}

/** Entrega el token de la sesión vigente, o `null` si no hay una. */
export type GetAuthToken = () => Promise<string | null>;

/**
 * Transporte puntual; los adaptadores de cada rol implementan los puertos de aplicación.
 * Con `getAuthToken` cada llamada viaja con la identidad de la sesión actual; sin él, es anónima.
 */
export function createMobileConvexClient(
  deploymentUrl: string | undefined,
  fetchImplementation: typeof globalThis.fetch = globalThis.fetch,
  timeoutMs = REQUEST_TIMEOUT_MS,
  getAuthToken?: GetAuthToken,
) {
  if (!deploymentUrl?.trim()) {
    throw new Error("Configura EXPO_PUBLIC_CONVEX_URL con la URL del deployment de prueba.");
  }

  const client = new ConvexHttpClient(deploymentUrl.trim(), {
    logger: false,
    fetch: async (input, init) => {
      // fetch de React Native no vence por sí solo: sin límite, una red colgada dejaría la pantalla cargando.
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      init?.signal?.addEventListener("abort", () => controller.abort());
      let response: Response;
      try {
        response = await fetchImplementation(input, { ...init, signal: controller.signal });
      } catch {
        // Solo el rechazo de fetch (incluido el vencimiento) es un fallo de red, no un error del contrato o del servidor.
        throw new MobileNetworkError("Network request failed");
      } finally {
        clearTimeout(timer);
      }
      if (response.status === 401 || response.status === 403) {
        throw Object.assign(new Error("No autorizado"), { code: "unauthorized" });
      }
      return response;
    },
  });

  // El token se pide en cada llamada: caduca y cambia al cerrar sesión o cambiar de cuenta.
  async function authenticate() {
    if (!getAuthToken) return;
    const token = await getAuthToken();
    if (token) client.setAuth(token);
    else client.clearAuth();
  }

  return {
    async query<Query extends FunctionReference<"query", "public">>(
      query: Query,
      args: FunctionArgs<Query>,
    ): Promise<FunctionReturnType<Query>> {
      await authenticate();
      return client.query(query, args);
    },
    async mutation<Mutation extends FunctionReference<"mutation", "public">>(
      mutation: Mutation,
      args: FunctionArgs<Mutation>,
    ): Promise<FunctionReturnType<Mutation>> {
      await authenticate();
      return client.mutation(mutation, args);
    },
    async action<Action extends FunctionReference<"action", "public">>(
      action: Action,
      args: FunctionArgs<Action>,
    ): Promise<FunctionReturnType<Action>> {
      await authenticate();
      return client.action(action, args);
    },
  };
}

export type MobileConvexClient = ReturnType<typeof createMobileConvexClient>;
