import type { AccessibilityPreferences } from "../../application/accessibility-preferences-models";

export interface SystemAccessibilitySettings {
  readonly fontScale: number;
  readonly highContrast: boolean;
  readonly reduceMotion: boolean;
}

export interface EffectiveAccessibilitySettings {
  /** Absolute font scale after resolving the app preference and the system scale. */
  readonly textScale: number;
  /** Relative scale applied on top of React Native's system font scaling. */
  readonly textScaleMultiplier: number;
  readonly highContrast: boolean;
  readonly reduceMotion: boolean;
  readonly reduceMotionMode: "system" | "always" | "never";
}

export function resolveAccessibilitySettings(
  preferences: AccessibilityPreferences,
  system: SystemAccessibilitySettings,
): EffectiveAccessibilitySettings {
  const systemFontScale =
    Number.isFinite(system.fontScale) && system.fontScale > 0 ? system.fontScale : 1;
  const textScale = preferences.textScale === "system" ? systemFontScale : preferences.textScale;
  const reduceMotion =
    preferences.reduceMotion === "system" ? system.reduceMotion : preferences.reduceMotion === "on";

  return {
    textScale,
    textScaleMultiplier: textScale / systemFontScale,
    highContrast:
      preferences.highContrast === "system"
        ? system.highContrast
        : preferences.highContrast === "on",
    reduceMotion,
    reduceMotionMode:
      preferences.reduceMotion === "system"
        ? "system"
        : preferences.reduceMotion === "on"
          ? "always"
          : "never",
  };
}
