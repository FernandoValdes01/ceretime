import { act, render, screen, waitFor } from "@testing-library/react-native";
import { AccessibilityInfo, AppState, Text } from "react-native";
import { useEffect } from "react";
import {
  defaultAccessibilityPreferences,
  type AccessibilityPreferences,
} from "@/application/accessibility-preferences-models";
import type { AccessibilityPreferencesPort } from "@/application/accessibility-preferences-port";
import {
  AccessibilityPreferencesProvider,
  useAccessibilityPreferences,
} from "@/presentation/accessibility/accessibility-preferences-provider";

const { ReducedMotionManager } = jest.requireActual(
  "react-native-reanimated/lib/module/ReducedMotion",
) as {
  ReducedMotionManager: {
    jsValue: boolean;
    uiValue: { value: boolean };
  };
};

const systemPreferences = {
  ...defaultAccessibilityPreferences,
  reduceMotion: "system",
} satisfies AccessibilityPreferences;

function createPort(
  preferences: AccessibilityPreferences = systemPreferences,
): AccessibilityPreferencesPort {
  return {
    read: async () => ({ preferences, source: "stored", error: null }),
    update: async (patch) => ({ ok: true, preferences: { ...preferences, ...patch } }),
  };
}

let effectiveMotion = false;
let effectiveHighContrast = false;
function Consumer() {
  const { effective } = useAccessibilityPreferences();
  useEffect(() => {
    effectiveMotion = effective.reduceMotion;
    effectiveHighContrast = effective.highContrast;
  }, [effective]);
  return (
    <>
      <Text>{effective.reduceMotion ? "movimiento reducido" : "movimiento normal"}</Text>
      <Text>{effective.highContrast ? "alto contraste" : "contraste normal"}</Text>
    </>
  );
}

describe("preferencias de accesibilidad del sistema", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("actualiza movimiento en vivo y retira la suscripción al desmontar", async () => {
    let onMotionChanged: ((enabled: boolean) => void) | undefined;
    let onContrastChanged: ((enabled: boolean) => void) | undefined;
    const removeMotionListener = jest.fn();
    const removeContrastListener = jest.fn();
    const removeAppStateListener = jest.fn();
    jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(false);
    jest.spyOn(AccessibilityInfo, "isDarkerSystemColorsEnabled").mockResolvedValue(false);
    (jest.spyOn(AccessibilityInfo, "addEventListener") as jest.Mock).mockImplementation(
      (eventName, handler) => {
        if (eventName === "reduceMotionChanged") {
          onMotionChanged = handler as unknown as (enabled: boolean) => void;
          return { remove: removeMotionListener };
        }
        if (eventName === "highTextContrastChanged" || eventName === "darkerSystemColorsChanged") {
          onContrastChanged = handler as unknown as (enabled: boolean) => void;
          return { remove: removeContrastListener };
        }
        return { remove: jest.fn() };
      },
    );
    jest.spyOn(AppState, "addEventListener").mockReturnValue({ remove: removeAppStateListener });

    const view = render(
      <AccessibilityPreferencesProvider port={createPort()}>
        <Consumer />
      </AccessibilityPreferencesProvider>,
    );
    expect(await screen.findByText("movimiento normal")).toBeOnTheScreen();
    expect(screen.getByText("contraste normal")).toBeOnTheScreen();

    act(() => onContrastChanged?.(true));
    expect(screen.getByText("alto contraste")).toBeOnTheScreen();
    expect(effectiveHighContrast).toBe(true);

    act(() => onMotionChanged?.(true));
    expect(screen.getByText("movimiento reducido")).toBeOnTheScreen();
    expect(effectiveMotion).toBe(true);

    view.unmount();
    expect(removeMotionListener).toHaveBeenCalledTimes(1);
    expect(removeContrastListener).toHaveBeenCalledTimes(1);
    expect(removeAppStateListener).toHaveBeenCalledTimes(1);
  });

  test("actualiza el modo global de Reanimated cuando cambia el ajuste del sistema", async () => {
    let onMotionChanged: ((enabled: boolean) => void) | undefined;
    jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(false);
    jest.spyOn(AccessibilityInfo, "isDarkerSystemColorsEnabled").mockResolvedValue(false);
    (jest.spyOn(AccessibilityInfo, "addEventListener") as jest.Mock).mockImplementation(
      (eventName, handler) => {
        if (eventName === "reduceMotionChanged") {
          onMotionChanged = handler as unknown as (enabled: boolean) => void;
        }
        return { remove: jest.fn() };
      },
    );
    jest.spyOn(AppState, "addEventListener").mockReturnValue({ remove: jest.fn() });

    const view = render(
      <AccessibilityPreferencesProvider port={createPort()}>
        <Consumer />
      </AccessibilityPreferencesProvider>,
    );

    await waitFor(() => expect(ReducedMotionManager.jsValue).toBe(false));
    act(() => onMotionChanged?.(true));
    await waitFor(() => {
      expect(ReducedMotionManager.jsValue).toBe(true);
      expect(ReducedMotionManager.uiValue.value).toBe(true);
    });

    act(() => onMotionChanged?.(false));
    await waitFor(() => {
      expect(ReducedMotionManager.jsValue).toBe(false);
      expect(ReducedMotionManager.uiValue.value).toBe(false);
    });

    view.unmount();
  });

  test.each(["reduceMotionChanged", "darkerSystemColorsChanged"] as const)(
    "una lectura pendiente actualiza el otro ajuste después del evento %s",
    async (eventName) => {
      let resolveMotion!: (enabled: boolean) => void;
      let resolveContrast!: (enabled: boolean) => void;
      const handlers: Record<string, (enabled: boolean) => void> = {};
      jest
        .spyOn(AccessibilityInfo, "isReduceMotionEnabled")
        .mockImplementation(() => new Promise((resolve) => (resolveMotion = resolve)));
      jest
        .spyOn(AccessibilityInfo, "isDarkerSystemColorsEnabled")
        .mockImplementation(() => new Promise((resolve) => (resolveContrast = resolve)));
      (jest.spyOn(AccessibilityInfo, "addEventListener") as jest.Mock).mockImplementation(
        (name, handler) => {
          handlers[name] = handler as unknown as (enabled: boolean) => void;
          return { remove: jest.fn() };
        },
      );
      jest.spyOn(AppState, "addEventListener").mockReturnValue({ remove: jest.fn() });

      render(
        <AccessibilityPreferencesProvider port={createPort()}>
          <Consumer />
        </AccessibilityPreferencesProvider>,
      );

      await act(async () => {
        handlers[eventName](true);
        resolveMotion(eventName === "reduceMotionChanged" ? false : true);
        resolveContrast(eventName === "darkerSystemColorsChanged" ? false : true);
      });

      expect(screen.getByText("movimiento reducido")).toBeOnTheScreen();
      expect(screen.getByText("alto contraste")).toBeOnTheScreen();
    },
  );

  test("vuelve a consultar alto contraste al regresar a la aplicación", async () => {
    let onAppStateChange: ((state: string) => void) | undefined;
    jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(false);
    jest
      .spyOn(AccessibilityInfo, "isDarkerSystemColorsEnabled")
      .mockResolvedValueOnce(false)
      .mockResolvedValue(true);
    jest
      .spyOn(AccessibilityInfo, "isHighTextContrastEnabled")
      .mockResolvedValueOnce(false)
      .mockResolvedValue(true);
    (jest.spyOn(AccessibilityInfo, "addEventListener") as jest.Mock).mockReturnValue({
      remove: jest.fn(),
    });
    (jest.spyOn(AppState, "addEventListener") as jest.Mock).mockImplementation(
      (_event, handler) => {
        onAppStateChange = handler as unknown as (state: string) => void;
        return { remove: jest.fn() };
      },
    );

    render(
      <AccessibilityPreferencesProvider port={createPort()}>
        <Consumer />
      </AccessibilityPreferencesProvider>,
    );
    expect(await screen.findByText("contraste normal")).toBeOnTheScreen();

    act(() => onAppStateChange?.("active"));
    expect(await screen.findByText("alto contraste")).toBeOnTheScreen();
    await waitFor(() => expect(effectiveHighContrast).toBe(true));
  });

  test("una preferencia local explícita conserva precedencia al cambiar el sistema", async () => {
    let onMotionChanged: ((enabled: boolean) => void) | undefined;
    jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(true);
    jest.spyOn(AccessibilityInfo, "isDarkerSystemColorsEnabled").mockResolvedValue(false);
    (jest.spyOn(AccessibilityInfo, "addEventListener") as jest.Mock).mockImplementation(
      (eventName, handler) => {
        if (eventName === "reduceMotionChanged") {
          onMotionChanged = handler as unknown as (enabled: boolean) => void;
        }
        return { remove: jest.fn() };
      },
    );
    jest.spyOn(AppState, "addEventListener").mockReturnValue({ remove: jest.fn() });

    const view = render(
      <AccessibilityPreferencesProvider
        port={createPort({ ...systemPreferences, reduceMotion: "off" })}
      >
        <Consumer />
      </AccessibilityPreferencesProvider>,
    );
    expect(await screen.findByText("movimiento normal")).toBeOnTheScreen();

    act(() => onMotionChanged?.(true));
    expect(screen.getByText("movimiento normal")).toBeOnTheScreen();
    expect(effectiveMotion).toBe(false);
    view.unmount();
  });
});
