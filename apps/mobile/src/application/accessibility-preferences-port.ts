// Puerto de lectura y escritura de las preferencias; lo implementa el adaptador de AsyncStorage.
import type { AccessibilityPreferences } from "../domain/accessibility-preferences-models";

export type AccessibilityPreferencesError = "read-failed" | "write-failed" | "invalid-preferences";

export interface AccessibilityPreferencesReadResult {
  readonly preferences: AccessibilityPreferences;
  readonly source: "stored" | "default" | "recovered";
  readonly error: "read-failed" | null;
}

export type AccessibilityPreferencesUpdateResult =
  | { readonly ok: true; readonly preferences: AccessibilityPreferences }
  | { readonly ok: false; readonly error: AccessibilityPreferencesError };

export interface AccessibilityPreferencesPort {
  read(): Promise<AccessibilityPreferencesReadResult>;
  update(patch: Partial<AccessibilityPreferences>): Promise<AccessibilityPreferencesUpdateResult>;
}
