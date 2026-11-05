// Preferencias de accesibilidad que la persona elige en la app; "system" respeta el ajuste del dispositivo.
export const textScales = ["system", 1, 1.5, 2] as const;
export const toggleSettings = ["system", "on", "off"] as const;

export type TextScale = (typeof textScales)[number];
export type ToggleSetting = (typeof toggleSettings)[number];

export interface AccessibilityPreferences {
  readonly textScale: TextScale;
  readonly highContrast: ToggleSetting;
  readonly reduceMotion: ToggleSetting;
}

export const defaultAccessibilityPreferences: AccessibilityPreferences = Object.freeze({
  textScale: "system",
  highContrast: "system",
  reduceMotion: "system",
});
