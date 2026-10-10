import {
  accessibilityColorPalettes,
  contrastRatio,
  getAccessibilityColorVariables,
} from "@/presentation/accessibility/accessibility-color-palette";

test.each(Object.entries(accessibilityColorPalettes))(
  "la variante %s mantiene contraste medido en sus tokens de texto y estado",
  (_variant, palette) => {
    const textColors = [
      palette.text,
      palette.secondary,
      palette.primary,
      palette.success,
      palette.error,
    ];
    const surfaces = [palette.background, palette.surface, palette.muted];

    for (const textColor of textColors) {
      for (const surface of surfaces)
        expect(contrastRatio(textColor, surface)).toBeGreaterThanOrEqual(4.5);
    }
    for (const indicatorColor of [palette.outline, palette.border, palette.focus]) {
      expect(contrastRatio(indicatorColor, palette.surface)).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrastRatio(palette.warning, palette.warningSurface)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(palette.error, palette.errorSurface)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(palette.success, palette.successSurface)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio("#FFFFFF", palette.primary)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio("#FFFFFF", palette.success)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio("#FFFFFF", palette.action)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio("#FFFFFF", palette.actionPressed)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio("#FFFFFF", palette.error)).toBeGreaterThanOrEqual(4.5);
  },
);

test("las variables nativas cambian al activar alto contraste", () => {
  expect(getAccessibilityColorVariables(false)["--student-text"]).toBe("#1B1C1C");
  expect(getAccessibilityColorVariables(true)["--student-text"]).toBe("#000000");
  expect(getAccessibilityColorVariables(true)["--student-warning-surface"]).toBe("#FFF0CC");
});
