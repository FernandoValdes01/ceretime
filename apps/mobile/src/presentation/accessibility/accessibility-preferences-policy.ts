// Combina las preferencias de la app con los ajustes del sistema y traduce tamaños de letra en Android.
import type {
  AccessibilityPreferences,
  ToggleSetting,
} from "../../application/accessibility-preferences-models";

export interface SystemAccessibilitySettings {
  readonly fontScale: number;
  readonly highContrast: boolean;
  readonly reduceMotion: boolean;
}

export interface EffectiveAccessibilitySettings {
  // Escala absoluta: la elegida en la app o, con "system", la del dispositivo.
  readonly textScale: number;
  readonly highContrast: boolean;
  readonly reduceMotion: boolean;
  readonly reduceMotionMode: "system" | "always" | "never";
}

const reduceMotionModes = {
  system: "system",
  on: "always",
  off: "never",
} as const satisfies Record<ToggleSetting, EffectiveAccessibilitySettings["reduceMotionMode"]>;

function resolveToggle(setting: ToggleSetting, systemValue: boolean): boolean {
  return setting === "system" ? systemValue : setting === "on";
}

export function resolveAccessibilitySettings(
  preferences: AccessibilityPreferences,
  system: SystemAccessibilitySettings,
): EffectiveAccessibilitySettings {
  const systemFontScale =
    Number.isFinite(system.fontScale) && system.fontScale > 0 ? system.fontScale : 1;
  const textScale = preferences.textScale === "system" ? systemFontScale : preferences.textScale;

  return {
    textScale,
    highContrast: resolveToggle(preferences.highContrast, system.highContrast),
    reduceMotion: resolveToggle(preferences.reduceMotion, system.reduceMotion),
    reduceMotionMode: reduceMotionModes[preferences.reduceMotion],
  };
}

// Desde Android 14 la escala de letra no es lineal: los textos grandes crecen menos. Estas tablas replican
// las de la plataforma (tamaño en dp por cada tamaño de referencia en sp) para que la escala elegida en la
// app se vea igual que si el usuario la hubiera elegido en el sistema. Android 14 omite las escalas < 1,15.
const androidFontScaleTables = [
  { scale: 1.05, dp: [8.4, 10.5, 12.6, 14.8, 18.6, 20.6, 24.4, 30, 100] },
  { scale: 1.1, dp: [8.8, 11, 13.2, 15.6, 19.2, 21.2, 24.8, 30, 100] },
  { scale: 1.15, dp: [9.2, 11.5, 13.8, 16.4, 19.8, 21.8, 25.2, 30, 100] },
  { scale: 1.2, dp: [9.6, 12, 14.4, 17.2, 20.4, 22.4, 25.6, 30, 100] },
  { scale: 1.3, dp: [10.4, 13, 15.6, 18.8, 21.6, 23.6, 26.4, 30, 100] },
  { scale: 1.5, dp: [12, 15, 18, 22, 24, 26, 28, 30, 100] },
  { scale: 1.8, dp: [14.4, 18, 21.6, 24.4, 27.6, 30.8, 32.8, 34.8, 100] },
  { scale: 2, dp: [16, 20, 24, 26, 30, 34, 36, 38, 100] },
] as const;
const android14FontScaleTables = androidFontScaleTables.filter(({ scale }) => scale >= 1.15);
const androidFontScaleReferenceSizes = [8, 10, 12, 14, 18, 20, 24, 30, 100] as const;

// Devuelve el tamaño en sp que, con la escala actual del sistema, se ve como `fontSize` a `targetScale`.
// En Android 14+ invierte la tabla no lineal por búsqueda binaria; en el resto basta una proporción.
export function getNativeFontSize(
  fontSize: number,
  targetScale: number,
  systemScale: number,
  platform: string,
  platformVersion: number | string,
): number {
  const version = Number(platformVersion);
  const safeSystemScale = Number.isFinite(systemScale) && systemScale > 0 ? systemScale : 1;
  if (
    targetScale === safeSystemScale ||
    platform !== "android" ||
    version < 34 ||
    (safeSystemScale < 1.05 && targetScale < 1.05)
  ) {
    return roundNativeFontSize(fontSize * (targetScale / safeSystemScale));
  }

  const targetDp = convertAndroidSpToDp(fontSize, targetScale, version);
  let lower = 0;
  let upper = Math.max(fontSize * 4, 400);
  for (let iteration = 0; iteration < 40; iteration += 1) {
    const candidate = (lower + upper) / 2;
    if (convertAndroidSpToDp(candidate, safeSystemScale, version) < targetDp) lower = candidate;
    else upper = candidate;
  }
  return roundNativeFontSize((lower + upper) / 2);
}

function roundNativeFontSize(fontSize: number): number {
  return Math.round(fontSize * 100) / 100;
}

// Interpola en la tabla de Android por escala y por tamaño, como hace la plataforma.
function convertAndroidSpToDp(fontSize: number, scale: number, platformVersion: number): number {
  const fontScaleTables =
    platformVersion === 34 ? android14FontScaleTables : androidFontScaleTables;
  if (scale < fontScaleTables[0].scale) return fontSize * scale;

  const upperIndex = fontScaleTables.findIndex((table) => table.scale >= scale);
  if (upperIndex < 0) return fontSize * scale;
  const lowerTable = fontScaleTables[Math.max(0, upperIndex - 1)];
  const upperTable = fontScaleTables[upperIndex] ?? lowerTable;
  const scaleProgress =
    upperTable.scale === lowerTable.scale
      ? 0
      : (scale - lowerTable.scale) / (upperTable.scale - lowerTable.scale);
  const sizeUpperIndex = androidFontScaleReferenceSizes.findIndex((size) => size >= fontSize);
  if (sizeUpperIndex < 0) return fontSize;
  const sizeLowerIndex = sizeUpperIndex - 1;
  const lowerSize = sizeLowerIndex < 0 ? 0 : androidFontScaleReferenceSizes[sizeLowerIndex];
  const upperSize = androidFontScaleReferenceSizes[sizeUpperIndex];
  const lowerSizeDp = sizeLowerIndex < 0 ? 0 : lowerTable.dp[sizeLowerIndex];
  const upperSizeDp = upperTable.dp[sizeUpperIndex];
  const sizeProgress = (fontSize - lowerSize) / (upperSize - lowerSize);
  const lowerDp = interpolate(lowerSizeDp, lowerTable.dp[sizeUpperIndex], sizeProgress);
  const upperDp = interpolate(
    sizeLowerIndex < 0 ? 0 : upperTable.dp[sizeLowerIndex],
    upperSizeDp,
    sizeProgress,
  );
  return interpolate(lowerDp, upperDp, scaleProgress);
}

function interpolate(start: number, end: number, progress: number) {
  return start + (end - start) * progress;
}
