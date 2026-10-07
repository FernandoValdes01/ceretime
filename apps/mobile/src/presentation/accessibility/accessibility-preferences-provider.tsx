import { AccessibilityInfo, AppState, Platform, useWindowDimensions } from "react-native";
import { vars } from "nativewind";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type PropsWithChildren,
} from "react";
import { View } from "react-native";
import { ReducedMotionConfig, ReduceMotion } from "react-native-reanimated";
import {
  defaultAccessibilityPreferences,
  type AccessibilityPreferences,
} from "../../application/accessibility-preferences-models";
import type {
  AccessibilityPreferencesError,
  AccessibilityPreferencesPort,
  AccessibilityPreferencesReadResult,
} from "../../application/accessibility-preferences-port";
import {
  resolveAccessibilitySettings,
  type SystemAccessibilitySettings,
} from "./accessibility-preferences-policy";
import { getAccessibilityColorVariables } from "./accessibility-color-palette";

export interface AccessibilityPreferencesState {
  readonly preferences: AccessibilityPreferences;
  readonly status: "loading" | "ready" | "saving";
  readonly source: AccessibilityPreferencesReadResult["source"];
  readonly error: string | null;
  readonly effective: ReturnType<typeof resolveAccessibilitySettings>;
  readonly reloadPreferences: () => void;
  readonly updatePreferences: (patch: Partial<AccessibilityPreferences>) => Promise<boolean>;
}

const PreferencesContext = createContext<AccessibilityPreferencesState | null>(null);
const errorMessages: Record<AccessibilityPreferencesError, string> = {
  "read-failed": "No fue posible leer tus preferencias. Puedes volver a intentarlo.",
  "write-failed": "No fue posible guardar tus preferencias. Se conservan los valores anteriores.",
  "invalid-preferences": "La preferencia indicada no es válida.",
};

export function AccessibilityPreferencesProvider({
  port,
  children,
}: PropsWithChildren<{ readonly port: AccessibilityPreferencesPort }>) {
  const { fontScale } = useWindowDimensions();
  const [systemSettings, setSystemSettings] = useState<
    Omit<SystemAccessibilitySettings, "fontScale">
  >(() => ({
    highContrast: false,
    reduceMotion: false,
  }));
  const [preferences, setPreferences] = useState(defaultAccessibilityPreferences);
  const [status, setStatus] = useState<AccessibilityPreferencesState["status"]>("loading");
  const [source, setSource] = useState<AccessibilityPreferencesState["source"]>("default");
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [loadedPort, setLoadedPort] = useState<AccessibilityPreferencesPort | null>(null);
  const busy = useRef(true);
  const lifetime = useRef<{ active: boolean; port: AccessibilityPreferencesPort } | null>(null);

  useEffect(() => {
    let active = true;
    let queryVersion = 0;

    async function refreshSystemSettings() {
      const version = ++queryVersion;
      const contrastQuery =
        Platform.OS === "android"
          ? AccessibilityInfo.isHighTextContrastEnabled()
          : Platform.OS === "ios"
            ? AccessibilityInfo.isDarkerSystemColorsEnabled()
            : Promise.resolve(false);
      const [reduceMotion, highContrast] = await Promise.all([
        AccessibilityInfo.isReduceMotionEnabled().catch(() => false),
        contrastQuery.catch(() => false),
      ]);

      if (!active || version !== queryVersion) return;
      setSystemSettings((current) => ({ ...current, reduceMotion, highContrast }));
    }

    function updateHighContrast(highContrast: boolean) {
      queryVersion += 1;
      if (active) setSystemSettings((current) => ({ ...current, highContrast }));
    }

    const motionSubscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      (reduceMotion) => {
        queryVersion += 1;
        if (active) setSystemSettings((current) => ({ ...current, reduceMotion }));
      },
    );
    const contrastSubscription =
      Platform.OS === "android"
        ? AccessibilityInfo.addEventListener("highTextContrastChanged", updateHighContrast)
        : Platform.OS === "ios"
          ? AccessibilityInfo.addEventListener("darkerSystemColorsChanged", updateHighContrast)
          : null;
    const appStateSubscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void refreshSystemSettings();
    });
    void refreshSystemSettings();

    return () => {
      active = false;
      queryVersion += 1;
      motionSubscription.remove();
      contrastSubscription?.remove();
      appStateSubscription.remove();
    };
  }, []);

  useEffect(() => {
    const operation = { active: true, port };
    lifetime.current = operation;
    busy.current = true;
    void (async () => {
      try {
        const result = await port.read();
        if (!operation.active) return;
        setPreferences(result.preferences);
        setSource(result.source);
        setError(result.error ? errorMessages[result.error] : null);
      } catch {
        if (!operation.active) return;
        setPreferences(defaultAccessibilityPreferences);
        setSource("default");
        setError(errorMessages["read-failed"]);
      } finally {
        if (operation.active) {
          busy.current = false;
          setLoadedPort(port);
          setStatus("ready");
        }
      }
    })();
    return () => {
      operation.active = false;
    };
  }, [port, reload]);

  async function updatePreferences(patch: Partial<AccessibilityPreferences>): Promise<boolean> {
    const operation = lifetime.current;
    if (busy.current || loadedPort !== port || !operation?.active || operation.port !== port)
      return false;
    busy.current = true;
    setStatus("saving");
    setError(null);
    try {
      const result = await port.update(patch);
      if (!operation.active) return false;
      if (!result.ok) {
        setError(errorMessages[result.error]);
        return false;
      }
      setPreferences(result.preferences);
      setSource("stored");
      return true;
    } catch {
      if (operation.active) setError(errorMessages["write-failed"]);
      return false;
    } finally {
      if (operation.active) {
        busy.current = false;
        setStatus("ready");
      }
    }
  }

  function reloadPreferences() {
    if (busy.current) return;
    busy.current = true;
    setStatus("loading");
    setError(null);
    setReload((value) => value + 1);
  }

  const effective = resolveAccessibilitySettings(
    loadedPort === port ? preferences : defaultAccessibilityPreferences,
    { ...systemSettings, fontScale },
  );
  const textScaleVariables = Object.fromEntries(
    [
      ["--ceretime-font-xs", 12],
      ["--ceretime-font-sm", 14],
      ["--ceretime-font-base", 16],
      ["--ceretime-font-lg", 18],
      ["--ceretime-font-xl", 20],
      ["--ceretime-font-2xl", 24],
      ["--ceretime-font-3xl", 30],
      ["--ceretime-font-4xl", 36],
      ["--ceretime-font-28", 28],
      ["--ceretime-line-xs", 16],
      ["--ceretime-line-sm", 20],
      ["--ceretime-line-base", 24],
      ["--ceretime-line-lg", 28],
      ["--ceretime-line-xl", 28],
      ["--ceretime-line-2xl", 32],
      ["--ceretime-line-3xl", 36],
      ["--ceretime-line-4xl", 40],
      ...[20, 25, 26, 28, 29, 34, 37].map((size) => [`--ceretime-line-${size}`, size]),
    ].map(([name, size]) => {
      return [String(name), `${Number(size) * effective.textScaleMultiplier}px`];
    }),
  );
  const MotionConfig = ReducedMotionConfig as ComponentType<{ mode: ReduceMotion }> | undefined;
  const reduceMotionModes = ReduceMotion as typeof ReduceMotion | undefined;

  return (
    <PreferencesContext
      value={{
        preferences: loadedPort === port ? preferences : defaultAccessibilityPreferences,
        status: loadedPort === port ? status : "loading",
        source: loadedPort === port ? source : "default",
        error: loadedPort === port ? error : null,
        effective,
        updatePreferences,
        reloadPreferences,
      }}
    >
      <View
        style={[
          { flex: 1 },
          vars({
            ...textScaleVariables,
            ...getAccessibilityColorVariables(effective.highContrast),
          }),
        ]}
      >
        {MotionConfig && reduceMotionModes ? (
          <MotionConfig
            mode={effective.reduceMotion ? reduceMotionModes.Always : reduceMotionModes.Never}
          />
        ) : null}
        {children}
      </View>
    </PreferencesContext>
  );
}

export function useAccessibilityPreferences() {
  const state = useContext(PreferencesContext);
  if (!state) throw new Error("Las preferencias necesitan AccessibilityPreferencesProvider.");
  return state;
}

export function useOptionalAccessibilityPreferences() {
  return useContext(PreferencesContext);
}
