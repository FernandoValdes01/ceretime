import {
  defaultAccessibilityPreferences,
  type AccessibilityPreferences,
} from "@/application/accessibility-preferences-models";
import {
  getNativeFontSize,
  resolveAccessibilitySettings,
} from "@/presentation/accessibility/accessibility-preferences-policy";

describe("política efectiva de accesibilidad", () => {
  test("system sigue el tamaño del sistema sin volver a escalarlo", () => {
    expect(
      resolveAccessibilitySettings(defaultAccessibilityPreferences, {
        fontScale: 1.5,
        highContrast: true,
        reduceMotion: true,
      }),
    ).toEqual({
      textScale: 1.5,
      highContrast: true,
      reduceMotion: true,
      reduceMotionMode: "system",
    });
  });

  test.each([1, 1.5, 2] as const)(
    "una preferencia local de %s reemplaza el tamaño del sistema",
    (textScale) => {
      const preferences: AccessibilityPreferences = {
        ...defaultAccessibilityPreferences,
        textScale,
      };
      expect(
        resolveAccessibilitySettings(preferences, {
          fontScale: 1.5,
          highContrast: false,
          reduceMotion: false,
        }),
      ).toMatchObject({
        textScale,
        highContrast: false,
        reduceMotion: false,
        reduceMotionMode: "system",
      });
    },
  );

  test("las preferencias explícitas prevalecen sobre el sistema", () => {
    expect(
      resolveAccessibilitySettings(
        { textScale: 1, highContrast: "off", reduceMotion: "off" },
        { fontScale: 2, highContrast: true, reduceMotion: true },
      ),
    ).toEqual({
      textScale: 1,
      highContrast: false,
      reduceMotion: false,
      reduceMotionMode: "never",
    });
  });

  test("recupera un tamaño de sistema inválido con escala neutral", () => {
    expect(
      resolveAccessibilitySettings(defaultAccessibilityPreferences, {
        fontScale: Number.NaN,
        highContrast: false,
        reduceMotion: false,
      }),
    ).toMatchObject({ textScale: 1 });
  });

  test("compensa el escalado no lineal Android para el tamaño elegido en la app", () => {
    expect(getNativeFontSize(20, 1.5, 2, "android", 37)).toBeCloseTo(14);
    expect(getNativeFontSize(20, 2, 1, "android", 37)).toBeCloseTo(34);
    expect(getNativeFontSize(20, 1.5, 2, "ios", "18.0")).toBeCloseTo(15);
    expect(getNativeFontSize(20, 1.5, 1.5, "android", 37)).toBe(20);
    expect(getNativeFontSize(20, 1.5, Number.NaN, "android", 37)).toBeCloseTo(26);
  });

  test("Android 14 conserva el escalado lineal hasta su primera curva no lineal", () => {
    expect(getNativeFontSize(30, 1, 1.1, "android", 34)).toBeCloseTo(30 / 1.1);
    expect(getNativeFontSize(30, 1, 1.14, "android", 34)).toBeCloseTo(30 / 1.14);
    expect(getNativeFontSize(30, 1, 1.15, "android", 34)).toBeCloseTo(30);
  });

  test("Android 15 conserva la curva no lineal para la escala 1.1", () => {
    expect(getNativeFontSize(30, 1, 1.1, "android", 35)).toBeCloseTo(30);
  });
});
