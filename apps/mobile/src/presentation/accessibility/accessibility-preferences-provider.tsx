import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import {
  defaultAccessibilityPreferences,
  type AccessibilityPreferences,
} from "../../application/accessibility-preferences-models";
import type {
  AccessibilityPreferencesError,
  AccessibilityPreferencesPort,
  AccessibilityPreferencesReadResult,
} from "../../application/accessibility-preferences-port";

export interface AccessibilityPreferencesState {
  readonly preferences: AccessibilityPreferences;
  readonly status: "loading" | "ready" | "saving";
  readonly source: AccessibilityPreferencesReadResult["source"];
  readonly error: string | null;
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
  const [preferences, setPreferences] = useState(defaultAccessibilityPreferences);
  const [status, setStatus] = useState<AccessibilityPreferencesState["status"]>("loading");
  const [source, setSource] = useState<AccessibilityPreferencesState["source"]>("default");
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [loadedPort, setLoadedPort] = useState<AccessibilityPreferencesPort | null>(null);
  const busy = useRef(true);
  const lifetime = useRef<{ active: boolean; port: AccessibilityPreferencesPort } | null>(null);

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

  return (
    <PreferencesContext
      value={{
        preferences: loadedPort === port ? preferences : defaultAccessibilityPreferences,
        status: loadedPort === port ? status : "loading",
        source: loadedPort === port ? source : "default",
        error: loadedPort === port ? error : null,
        updatePreferences,
        reloadPreferences,
      }}
    >
      {children}
    </PreferencesContext>
  );
}

export function useAccessibilityPreferences() {
  const state = useContext(PreferencesContext);
  if (!state) throw new Error("Las preferencias necesitan AccessibilityPreferencesProvider.");
  return state;
}
