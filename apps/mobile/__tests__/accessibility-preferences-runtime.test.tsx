import { act, render, screen } from "@testing-library/react-native";
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
function Consumer() {
  const { effective } = useAccessibilityPreferences();
  useEffect(() => {
    effectiveMotion = effective.reduceMotion;
  }, [effective]);
  return <Text>{effective.reduceMotion ? "movimiento reducido" : "movimiento normal"}</Text>;
}

describe("preferencias de accesibilidad del sistema", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("actualiza movimiento en vivo y retira la suscripción al desmontar", async () => {
    let onMotionChanged: ((enabled: boolean) => void) | undefined;
    const removeMotionListener = jest.fn();
    jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(false);
    jest.spyOn(AccessibilityInfo, "isDarkerSystemColorsEnabled").mockResolvedValue(false);
    (jest.spyOn(AccessibilityInfo, "addEventListener") as jest.Mock).mockImplementation(
      (eventName, handler) => {
        if (eventName === "reduceMotionChanged") {
          onMotionChanged = handler as unknown as (enabled: boolean) => void;
        }
        return { remove: removeMotionListener };
      },
    );
    jest.spyOn(AppState, "addEventListener").mockReturnValue({ remove: jest.fn() });

    const view = render(
      <AccessibilityPreferencesProvider port={createPort()}>
        <Consumer />
      </AccessibilityPreferencesProvider>,
    );
    expect(await screen.findByText("movimiento normal")).toBeOnTheScreen();

    act(() => onMotionChanged?.(true));
    expect(screen.getByText("movimiento reducido")).toBeOnTheScreen();
    expect(effectiveMotion).toBe(true);

    view.unmount();
    expect(removeMotionListener).toHaveBeenCalledTimes(1);
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
