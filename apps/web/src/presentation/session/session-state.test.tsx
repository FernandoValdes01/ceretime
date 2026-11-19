// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { ConvexError } from "convex/values";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

type Pair = {
  session:
    | {
        status: "authenticated";
        email: string;
        name: string;
        population: "estudiante" | "personal";
      }
    | { status: "unauthenticated" };
  role:
    | {
        status: "authenticated";
        role: "student" | "professional" | "intern" | "admin";
        email: string;
      }
    | { status: "unauthenticated" };
};

let mockedPair: Pair | undefined;
const ensureMyProfile = vi.fn<() => Promise<unknown>>();

vi.mock("convex/react", () => ({
  useQuery: () => mockedPair,
  useMutation: () => ensureMyProfile,
}));

function sinRol(email: string, population: "estudiante" | "personal"): Pair {
  return {
    session: { status: "authenticated", email, name: "Ficticio", population },
    role: { status: "unauthenticated" },
  };
}

async function loadHook() {
  // Módulo nuevo en cada prueba: el registro de correos ya pedidos es global.
  vi.resetModules();
  const { useSessionAndRole } = await import("./session-state.ts");
  return useSessionAndRole;
}

beforeEach(() => {
  mockedPair = undefined;
  ensureMyProfile.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("creación del perfil propio al iniciar sesión (TI2-182)", () => {
  test("una sesión sin rol espera el perfil antes de entregar el par", async () => {
    let resolve: () => void = () => undefined;
    ensureMyProfile.mockReturnValue(new Promise<void>((r) => (resolve = r)));
    mockedPair = sinRol("nueva@alu.uct.cl", "estudiante");
    const useSessionAndRole = await loadHook();

    const { result } = renderHook(() => useSessionAndRole());
    expect(result.current).toBeUndefined();
    expect(ensureMyProfile).toHaveBeenCalledTimes(1);

    mockedPair = {
      ...mockedPair,
      role: { status: "authenticated", role: "student", email: "nueva@alu.uct.cl" },
    };
    await act(async () => resolve());
    await waitFor(() => expect(result.current).toEqual(mockedPair));
  });

  test("una cuenta pendiente recibe su par sin rol y no repite la petición", async () => {
    ensureMyProfile.mockResolvedValue({});
    mockedPair = sinRol("pendiente@uct.cl", "personal");
    const useSessionAndRole = await loadHook();

    const first = renderHook(() => useSessionAndRole());
    await waitFor(() => expect(first.result.current).toEqual(mockedPair));
    const second = renderHook(() => useSessionAndRole());
    expect(second.result.current).toEqual(mockedPair);
    expect(ensureMyProfile).toHaveBeenCalledTimes(1);
  });

  test("un fallo de red libera la navegación y el siguiente montaje reintenta", async () => {
    ensureMyProfile.mockRejectedValueOnce(new Error("red caída")).mockResolvedValue({});
    mockedPair = sinRol("falla@alu.uct.cl", "estudiante");
    const useSessionAndRole = await loadHook();

    const first = renderHook(() => useSessionAndRole());
    await waitFor(() => expect(first.result.current).toEqual(mockedPair));
    expect(ensureMyProfile).toHaveBeenCalledTimes(1);

    const second = renderHook(() => useSessionAndRole());
    await waitFor(() => expect(ensureMyProfile).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(second.result.current).toEqual(mockedPair));
    renderHook(() => useSessionAndRole());
    expect(ensureMyProfile).toHaveBeenCalledTimes(2);
  });

  test("la denegación del Backend no se repite en cada ruta", async () => {
    ensureMyProfile.mockRejectedValue(new ConvexError("No autorizado"));
    mockedPair = sinRol("duplicado@uct.cl", "personal");
    const useSessionAndRole = await loadHook();

    const first = renderHook(() => useSessionAndRole());
    await waitFor(() => expect(first.result.current).toEqual(mockedPair));
    expect(renderHook(() => useSessionAndRole()).result.current).toEqual(mockedPair);
    expect(ensureMyProfile).toHaveBeenCalledTimes(1);
  });

  test("una sesión con rol o sin sesión no pide el perfil", async () => {
    const useSessionAndRole = await loadHook();
    mockedPair = {
      session: {
        status: "authenticated",
        email: "e@alu.uct.cl",
        name: "F",
        population: "estudiante",
      },
      role: { status: "authenticated", role: "student", email: "e@alu.uct.cl" },
    };
    expect(renderHook(() => useSessionAndRole()).result.current).toEqual(mockedPair);
    mockedPair = { session: { status: "unauthenticated" }, role: { status: "unauthenticated" } };
    expect(renderHook(() => useSessionAndRole()).result.current).toEqual(mockedPair);
    expect(ensureMyProfile).not.toHaveBeenCalled();
  });
});
