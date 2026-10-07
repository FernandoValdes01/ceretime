export interface AccessibilityPreferences {
  readonly textScale: "system" | 1 | 1.5 | 2;
  readonly highContrast: "system" | "on" | "off";
  readonly reduceMotion: "system" | "on" | "off";
}

export const defaultAccessibilityPreferences: AccessibilityPreferences = Object.freeze({
  textScale: "system",
  highContrast: "system",
  reduceMotion: "system",
});

export function isAccessibilityPreferences(value: unknown): value is AccessibilityPreferences {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  const isSetting = (setting: unknown) =>
    setting === "system" || setting === "on" || setting === "off";
  return (
    ["system", 1, 1.5, 2].includes(candidate.textScale as string | number) &&
    isSetting(candidate.highContrast) &&
    isSetting(candidate.reduceMotion)
  );
}
