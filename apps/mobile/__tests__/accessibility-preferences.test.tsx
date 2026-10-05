import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Pressable, Text } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect } from "react";
import {
  createMockAuthenticationPort,
  mockAuthCredentials,
} from "@/infrastructure/mock-authentication";
import { NavigationSessionProvider, useNavigationSession } from "@/presentation/navigation/session";
import {
  defaultAccessibilityPreferences,
  isAccessibilityPreferences,
  type AccessibilityPreferences,
} from "@/application/accessibility-preferences-models";
import type { AccessibilityPreferencesPort } from "@/application/accessibility-preferences-port";
import {
  accessibilityPreferencesStorageKey,
  createLocalAccessibilityPreferencesAdapter,
} from "@/infrastructure/local-accessibility-preferences-adapter";
import {
  AccessibilityPreferencesProvider,
  useAccessibilityPreferences,
  type AccessibilityPreferencesState,
} from "@/presentation/accessibility/accessibility-preferences-provider";

const enlargedPreferences: AccessibilityPreferences = {
  textScale: 2,
  highContrast: "on",
  reduceMotion: "on",
};

function memoryStorage(initial: string | null = null) {
  let stored = initial;
  return {
    getItem: jest.fn(async () => stored),
    setItem: jest.fn(async (_key: string, value: string) => {
      stored = value;
    }),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

describe("almacenamiento local de preferencias", () => {
  test("datos ausentes usan defaults y no escriben durante la lectura", async () => {
    const storage = memoryStorage();
    const adapter = createLocalAccessibilityPreferencesAdapter(storage);
    expect(await adapter.read()).toEqual({
      preferences: defaultAccessibilityPreferences,
      source: "default",
      error: null,
    });
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  test.each([
    "",
    "{",
    "null",
    "[]",
    '{"version":2}',
    JSON.stringify({ version: 1, preferences: { ...enlargedPreferences, textScale: 4 } }),
    JSON.stringify({ version: 1, preferences: { textScale: 2 } }),
    JSON.stringify({ version: 1, preferences: { ...enlargedPreferences, reduceMotion: true } }),
  ])("recupera datos inválidos sin bloquear ni sobrescribir: %s", async (raw) => {
    const storage = memoryStorage(raw);
    expect(await createLocalAccessibilityPreferencesAdapter(storage).read()).toEqual({
      preferences: defaultAccessibilityPreferences,
      source: "recovered",
      error: null,
    });
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  test("el contrato valida solo tamaños y ajustes admitidos", () => {
    expect(isAccessibilityPreferences(defaultAccessibilityPreferences)).toBe(true);
    expect(isAccessibilityPreferences(enlargedPreferences)).toBe(true);
    expect(isAccessibilityPreferences({ ...enlargedPreferences, highContrast: "maybe" })).toBe(
      false,
    );
    expect(isAccessibilityPreferences(undefined)).toBe(false);
  });

  test("reiniciar el adaptador conserva valores y persiste solo preferencias versionadas", async () => {
    const storage = memoryStorage();
    expect(
      await createLocalAccessibilityPreferencesAdapter(storage).update(enlargedPreferences),
    ).toEqual({
      ok: true,
      preferences: enlargedPreferences,
    });
    expect(storage.setItem).toHaveBeenCalledWith(
      accessibilityPreferencesStorageKey,
      JSON.stringify({ version: 1, preferences: enlargedPreferences }),
    );
    expect(await createLocalAccessibilityPreferencesAdapter(storage).read()).toEqual({
      preferences: enlargedPreferences,
      source: "stored",
      error: null,
    });
  });

  test("la instancia comparte lectura y procesa actualizaciones en orden sin perder campos", async () => {
    const storage = memoryStorage();
    const adapter = createLocalAccessibilityPreferencesAdapter(storage);
    await Promise.all([adapter.read(), adapter.read()]);
    expect(storage.getItem).toHaveBeenCalledTimes(1);
    const pending = deferred<void>();
    storage.setItem.mockImplementationOnce(async () => pending.promise);
    const first = adapter.update({ textScale: 1.5 });
    const second = adapter.update({ highContrast: "on" });
    await waitFor(() => expect(storage.setItem).toHaveBeenCalledTimes(1));
    expect((await adapter.read()).preferences).toEqual(defaultAccessibilityPreferences);
    pending.resolve();
    await Promise.all([first, second]);
    expect((await adapter.read()).preferences).toEqual({
      ...defaultAccessibilityPreferences,
      textScale: 1.5,
      highContrast: "on",
    });
    expect(storage.setItem).toHaveBeenCalledTimes(2);
  });

  test("un fallo de escritura conserva caché, permite reintentar y no simula éxito", async () => {
    const storage = memoryStorage();
    const adapter = createLocalAccessibilityPreferencesAdapter(storage);
    storage.setItem.mockRejectedValueOnce(new Error("detalle privado del dispositivo"));
    expect(await adapter.update({ highContrast: "on" })).toEqual({
      ok: false,
      error: "write-failed",
    });
    expect((await adapter.read()).preferences).toEqual(defaultAccessibilityPreferences);
    expect(await adapter.update({ reduceMotion: "on" })).toEqual({
      ok: true,
      preferences: { ...defaultAccessibilityPreferences, reduceMotion: "on" },
    });
  });

  test("un fallo de lectura permite reintentar y evita sobrescribir preferencias desconocidas", async () => {
    const storage = memoryStorage(JSON.stringify({ version: 1, preferences: enlargedPreferences }));
    storage.getItem.mockRejectedValueOnce(new Error("detalle privado"));
    const adapter = createLocalAccessibilityPreferencesAdapter(storage);
    expect(await adapter.update({ textScale: 1 })).toEqual({ ok: false, error: "read-failed" });
    expect(storage.setItem).not.toHaveBeenCalled();
    expect((await adapter.read()).preferences).toEqual(enlargedPreferences);
  });

  test("rechaza valores inválidos y descarta campos ajenos antes de persistir", async () => {
    const storage = memoryStorage();
    const adapter = createLocalAccessibilityPreferencesAdapter(storage);
    expect(
      await adapter.update({ textScale: 4 } as unknown as Partial<AccessibilityPreferences>),
    ).toEqual({ ok: false, error: "invalid-preferences" });
    expect(storage.setItem).not.toHaveBeenCalled();
    await adapter.update({
      ...enlargedPreferences,
      studentName: "Nombre ficticio",
    } as AccessibilityPreferences);
    expect(storage.setItem.mock.calls[0][1]).not.toContain("studentName");
  });

  test("el adaptador predeterminado usa AsyncStorage y recupera datos en otra instancia", async () => {
    await AsyncStorage.clear();
    await createLocalAccessibilityPreferencesAdapter().update(enlargedPreferences);
    expect((await createLocalAccessibilityPreferencesAdapter().read()).preferences).toEqual(
      enlargedPreferences,
    );
    await AsyncStorage.clear();
  });
});

let currentState: AccessibilityPreferencesState;
let currentSession: ReturnType<typeof useNavigationSession>;
function SessionConsumer() {
  const session = useNavigationSession();
  useEffect(() => {
    currentSession = session;
  }, [session]);
  return null;
}
function Consumer({ name }: { name: string }) {
  const state = useAccessibilityPreferences();
  useEffect(() => {
    currentState = state;
  }, [state]);
  return (
    <>
      <Text>{`${name}: ${state.status} ${state.preferences.textScale}`}</Text>
      {state.error ? <Text accessibilityRole="alert">{state.error}</Text> : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Ampliar ${name}`}
        onPress={() => void state.updatePreferences({ textScale: 2 })}
      >
        <Text>Ampliar</Text>
      </Pressable>
    </>
  );
}

describe("proveedor único de preferencias", () => {
  test("entrar y salir de los cuatro roles conserva la instancia y las preferencias", async () => {
    const storage = memoryStorage();
    render(
      <AccessibilityPreferencesProvider port={createLocalAccessibilityPreferencesAdapter(storage)}>
        <NavigationSessionProvider
          authPort={createMockAuthenticationPort()}
          demoCredentials={mockAuthCredentials}
        >
          <Consumer name="uno" />
          <SessionConsumer />
        </NavigationSessionProvider>
      </AccessibilityPreferencesProvider>,
    );
    await screen.findByText("uno: ready system");
    await act(async () => {
      await currentState.updatePreferences({ textScale: 2 });
    });
    for (const role of ["estudiante", "profesional", "practicante", "administrador"] as const) {
      await act(async () => {
        await currentSession.selectRole(role);
      });
      expect(currentSession.role).toBe(role);
      expect(currentState.preferences.textScale).toBe(2);
      await act(async () => {
        await currentSession.signOut();
      });
      expect(currentSession.role).toBeNull();
      expect(currentState.preferences.textScale).toBe(2);
    }
    expect(storage.getItem).toHaveBeenCalledTimes(1);
    expect(storage.setItem).toHaveBeenCalledTimes(1);
  });

  test("dos consumidores se hidratan juntos y reciben una actualización confirmada", async () => {
    const port = createLocalAccessibilityPreferencesAdapter(memoryStorage());
    render(
      <AccessibilityPreferencesProvider port={port}>
        <Consumer name="uno" />
        <Consumer name="dos" />
      </AccessibilityPreferencesProvider>,
    );
    await screen.findByText("uno: ready system");
    fireEvent.press(screen.getByRole("button", { name: "Ampliar uno" }));
    await screen.findByText("uno: ready 2");
    expect(screen.getByText("dos: ready 2")).toBeOnTheScreen();
  });

  test("defaults mantienen consumidores utilizables tras fallo de lectura y reintento", async () => {
    const storage = memoryStorage(JSON.stringify({ version: 1, preferences: enlargedPreferences }));
    storage.getItem.mockRejectedValueOnce(new Error("información privada"));
    render(
      <AccessibilityPreferencesProvider port={createLocalAccessibilityPreferencesAdapter(storage)}>
        <Consumer name="uno" />
      </AccessibilityPreferencesProvider>,
    );
    await screen.findByRole("alert");
    expect(screen.getByText("uno: ready system")).toBeOnTheScreen();
    expect(screen.queryByText(/información privada/)).not.toBeOnTheScreen();
    act(() => currentState.reloadPreferences());
    await screen.findByText("uno: ready 2");
    expect(screen.queryByRole("alert")).not.toBeOnTheScreen();
  });

  test("un guardado pendiente conserva valores y rechaza pulsaciones duplicadas", async () => {
    const storage = memoryStorage();
    const pending = deferred<void>();
    storage.setItem.mockImplementationOnce(async () => pending.promise);
    render(
      <AccessibilityPreferencesProvider port={createLocalAccessibilityPreferencesAdapter(storage)}>
        <Consumer name="uno" />
      </AccessibilityPreferencesProvider>,
    );
    await screen.findByText("uno: ready system");
    let saved!: Promise<boolean>;
    act(() => {
      saved = currentState.updatePreferences({ textScale: 2 });
    });
    expect(screen.getByText("uno: saving system")).toBeOnTheScreen();
    expect(await currentState.updatePreferences({ textScale: 1 })).toBe(false);
    await act(async () => {
      pending.resolve();
      await expect(saved).resolves.toBe(true);
    });
    expect(screen.getByText("uno: ready 2")).toBeOnTheScreen();
    expect(storage.setItem).toHaveBeenCalledTimes(1);
  });

  test("un error de guardado es visible y conserva los valores anteriores", async () => {
    const storage = memoryStorage();
    storage.setItem.mockRejectedValueOnce(new Error("información privada"));
    render(
      <AccessibilityPreferencesProvider port={createLocalAccessibilityPreferencesAdapter(storage)}>
        <Consumer name="uno" />
      </AccessibilityPreferencesProvider>,
    );
    await screen.findByText("uno: ready system");
    let result = true;
    await act(async () => {
      result = await currentState.updatePreferences({ textScale: 2 });
    });
    expect(result).toBe(false);
    expect(screen.getByRole("alert")).toHaveTextContent(/Se conservan los valores anteriores\./);
    expect(screen.getByText("uno: ready system")).toBeOnTheScreen();
    expect(screen.queryByText(/información privada/)).not.toBeOnTheScreen();
  });

  test("ignora hidratación de un puerto anterior y su resolución tras desmontar", async () => {
    const pending = deferred<Awaited<ReturnType<AccessibilityPreferencesPort["read"]>>>();
    const oldPort: AccessibilityPreferencesPort = {
      read: () => pending.promise,
      update: jest.fn(),
    };
    const nextPort = createLocalAccessibilityPreferencesAdapter(memoryStorage());
    const view = render(
      <AccessibilityPreferencesProvider port={oldPort}>
        <Consumer name="uno" />
      </AccessibilityPreferencesProvider>,
    );
    expect(screen.getByText("uno: loading system")).toBeOnTheScreen();
    view.rerender(
      <AccessibilityPreferencesProvider port={nextPort}>
        <Consumer name="uno" />
      </AccessibilityPreferencesProvider>,
    );
    await screen.findByText("uno: ready system");
    await act(async () => {
      pending.resolve({ preferences: enlargedPreferences, source: "stored", error: null });
      await pending.promise;
    });
    expect(screen.getByText("uno: ready system")).toBeOnTheScreen();
    const pendingAfterUnmount =
      deferred<Awaited<ReturnType<AccessibilityPreferencesPort["read"]>>>();
    view.rerender(
      <AccessibilityPreferencesProvider
        port={{ read: () => pendingAfterUnmount.promise, update: jest.fn() }}
      >
        <Consumer name="uno" />
      </AccessibilityPreferencesProvider>,
    );
    const lastState = currentState;
    view.unmount();
    await act(async () => {
      pendingAfterUnmount.resolve({
        preferences: enlargedPreferences,
        source: "stored",
        error: null,
      });
      await pendingAfterUnmount.promise;
    });
    expect(currentState).toBe(lastState);
  });
});
