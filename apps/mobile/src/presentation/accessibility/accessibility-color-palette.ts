export const accessibilityColorPalettes = {
  standard: {
    background: "#FBF9F8",
    surface: "#FFFFFF",
    muted: "#F5F3F3",
    text: "#1B1C1C",
    secondary: "#3E4946",
    primary: "#00695B",
    success: "#005045",
    action: "#246259",
    actionPressed: "#17483F",
    outline: "#56625D",
    border: "#68736F",
    error: "#BA1A1A",
    errorSurface: "#FCEBEC",
    successSurface: "#E8F4F1",
    focus: "#2563EB",
    warning: "#704000",
    warningSurface: "#FFF3D8",
  },
  highContrast: {
    background: "#FFFFFF",
    surface: "#FFFFFF",
    muted: "#E5E5E5",
    text: "#000000",
    secondary: "#111111",
    primary: "#00473F",
    success: "#003C34",
    action: "#00473F",
    actionPressed: "#00332D",
    outline: "#222222",
    border: "#595959",
    error: "#8B0000",
    errorSurface: "#FFE5E5",
    successSurface: "#E5E5E5",
    focus: "#0033CC",
    warning: "#5F3700",
    warningSurface: "#FFF0CC",
  },
} as const;

export type AccessibilityColorToken = keyof (typeof accessibilityColorPalettes)["standard"];
export type AccessibilityColorPalette = Readonly<Record<AccessibilityColorToken, string>>;

export function getAccessibilityColorPalette(highContrast: boolean): AccessibilityColorPalette {
  return highContrast
    ? accessibilityColorPalettes.highContrast
    : accessibilityColorPalettes.standard;
}

export function getAccessibilityColorVariables(highContrast: boolean) {
  const palette = getAccessibilityColorPalette(highContrast);
  return Object.fromEntries(
    Object.entries(palette).map(([token, value]) => [
      `--student-${token.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`,
      value,
    ]),
  );
}

export function contrastRatio(foreground: string, background: string): number {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

function relativeLuminance(color: string): number {
  const match = /^#([\da-f]{6})$/i.exec(color);
  if (!match) throw new Error(`Color hexadecimal no válido: ${color}`);
  const channels = [0, 2, 4].map((offset) => {
    const channel = Number.parseInt(match[1].slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}
