// Preferencias de accesibilidad que la persona elige en la app; "system" respeta el ajuste del dispositivo.
const textScales = ["system", 1, 1.5, 2] as const;
const toggleSettings = ["system", "on", "off"] as const;

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

function isOneOf<const T>(options: readonly T[], value: unknown): value is T {
  return options.some((option) => option === value);
}

// Valida lo leído del almacenamiento local, que puede venir de otra versión o estar corrupto.
export function isAccessibilityPreferences(value: unknown): value is AccessibilityPreferences {
  if (typeof value !== "object" || value === null) return false;

  const { textScale, highContrast, reduceMotion } = value as Partial<
    Record<keyof AccessibilityPreferences, unknown>
  >;

  return (
    isOneOf(textScales, textScale) &&
    isOneOf(toggleSettings, highContrast) &&
    isOneOf(toggleSettings, reduceMotion)
  );
}
