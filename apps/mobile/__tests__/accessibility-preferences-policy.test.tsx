import {
  defaultAccessibilityPreferences,
  type AccessibilityPreferences,
} from "@/application/accessibility-preferences-models";
import { resolveAccessibilitySettings } from "@/presentation/accessibility/accessibility-preferences-policy";

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
      textScaleMultiplier: 1,
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
        textScaleMultiplier: textScale / 1.5,
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
      textScaleMultiplier: 0.5,
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
    ).toMatchObject({ textScale: 1, textScaleMultiplier: 1 });
  });
});
