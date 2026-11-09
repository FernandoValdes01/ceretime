import { ConvexHttpClient } from "convex/browser";
import type { FunctionArgs, FunctionReference, FunctionReturnType } from "convex/server";

class MobileNetworkError extends Error {
  readonly code = "network_error";
}

/** Transporte puntual sin sesión; los adaptadores de cada rol implementan los puertos de aplicación. */
export function createMobileConvexClient(
  deploymentUrl: string | undefined,
  fetchImplementation: typeof globalThis.fetch = globalThis.fetch,
) {
  if (!deploymentUrl?.trim()) {
    throw new Error("Configura EXPO_PUBLIC_CONVEX_URL con la URL del deployment de prueba.");
  }

  const client = new ConvexHttpClient(deploymentUrl.trim(), {
    logger: false,
    fetch: async (input, init) => {
      let response: Response;
      try {
        response = await fetchImplementation(input, init);
      } catch {
        // Solo el rechazo de fetch es un fallo de red, no un error del contrato o del servidor.
        throw new MobileNetworkError("Network request failed");
      }
      if (response.status === 401 || response.status === 403) {
        throw Object.assign(new Error("No autorizado"), { code: "unauthorized" });
      }
      return response;
    },
  });

  return {
    query<Query extends FunctionReference<"query", "public">>(
      query: Query,
      args: FunctionArgs<Query>,
    ): Promise<FunctionReturnType<Query>> {
      return client.query(query, args);
    },
    mutation<Mutation extends FunctionReference<"mutation", "public">>(
      mutation: Mutation,
      args: FunctionArgs<Mutation>,
    ): Promise<FunctionReturnType<Mutation>> {
      return client.mutation(mutation, args);
    },
    action<Action extends FunctionReference<"action", "public">>(
      action: Action,
      args: FunctionArgs<Action>,
    ): Promise<FunctionReturnType<Action>> {
      return client.action(action, args);
    },
  };
}

export type MobileConvexClient = ReturnType<typeof createMobileConvexClient>;
