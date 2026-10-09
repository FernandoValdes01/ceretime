import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  defaultAccessibilityPreferences,
  isAccessibilityPreferences,
  type AccessibilityPreferences,
} from "../application/accessibility-preferences-models";
import type {
  AccessibilityPreferencesPort,
  AccessibilityPreferencesReadResult,
  AccessibilityPreferencesUpdateResult,
} from "../application/accessibility-preferences-port";

export const accessibilityPreferencesStorageKey = "ceretime.accessibility-preferences.v1";

interface PreferencesStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

function snapshot(preferences: AccessibilityPreferences): AccessibilityPreferences {
  return Object.freeze({
    textScale: preferences.textScale,
    highContrast: preferences.highContrast,
    reduceMotion: preferences.reduceMotion,
  });
}

function decode(raw: string | null): AccessibilityPreferencesReadResult {
  if (raw === null) {
    return { preferences: defaultAccessibilityPreferences, source: "default", error: null };
  }
  try {
    const envelope: unknown = JSON.parse(raw);
    if (
      typeof envelope === "object" &&
      envelope !== null &&
      "version" in envelope &&
      envelope.version === 1 &&
      "preferences" in envelope &&
      isAccessibilityPreferences(envelope.preferences)
    ) {
      return { preferences: snapshot(envelope.preferences), source: "stored", error: null };
    }
  } catch {
    // Los datos inválidos se recuperan en memoria; leer no escribe en el dispositivo.
  }
  return { preferences: defaultAccessibilityPreferences, source: "recovered", error: null };
}

export function createLocalAccessibilityPreferencesAdapter(
  storage: PreferencesStorage = AsyncStorage,
): AccessibilityPreferencesPort {
  let cached: AccessibilityPreferencesReadResult | null = null;
  let reading: Promise<AccessibilityPreferencesReadResult> | null = null;
  let writes: Promise<unknown> = Promise.resolve();

  function read(): Promise<AccessibilityPreferencesReadResult> {
    if (cached) return Promise.resolve(cached);
    if (reading) return reading;
    reading = (async () => {
      try {
        const raw = await Promise.resolve().then(() =>
          storage.getItem(accessibilityPreferencesStorageKey),
        );
        const result = decode(raw);
        cached = result;
        return result;
      } catch {
        return {
          preferences: defaultAccessibilityPreferences,
          source: "default",
          error: "read-failed",
        } as const;
      } finally {
        reading = null;
      }
    })();
    return reading;
  }

  return {
    read,
    update(patch) {
      // Copiar antes de esperar impide que quien llama altere la operación pendiente.
      const requested = { ...patch };
      const operation = writes.then(async (): Promise<AccessibilityPreferencesUpdateResult> => {
        const current = await read();
        if (current.error) return { ok: false, error: current.error };
        const merged = { ...current.preferences, ...requested };
        if (!isAccessibilityPreferences(merged)) return { ok: false, error: "invalid-preferences" };
        const preferences = snapshot(merged);
        try {
          await storage.setItem(
            accessibilityPreferencesStorageKey,
            JSON.stringify({ version: 1, preferences }),
          );
          cached = { preferences, source: "stored", error: null };
          return { ok: true, preferences };
        } catch {
          return { ok: false, error: "write-failed" };
        }
      });
      writes = operation;
      return operation;
    },
  };
}
