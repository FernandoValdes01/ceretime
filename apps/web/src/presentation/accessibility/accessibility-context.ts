import { createContext, useContext } from "react";

/**
 * Estado de preferencias de accesibilidad (rescate del mockup v0).
 *
 * Vive en Presentación y no toca el backend: tamaño del texto, alto
 * contraste y lectura en voz alta, con persistencia en `localStorage`.
 */

export type TextSize = "normal" | "grande" | "muy-grande";

export const TEXT_SCALES: Record<TextSize, number> = {
  normal: 1,
  grande: 1.15,
  "muy-grande": 1.3,
};

export const TEXT_SIZE_ORDER: TextSize[] = ["normal", "grande", "muy-grande"];

export const A11Y_STORAGE_KEY = "ceretime:a11y-prefs";

export type AccessibilityState = {
  textSize: TextSize;
  highContrast: boolean;
  readAloud: boolean;
  setTextSize: (size: TextSize) => void;
  toggleHighContrast: () => void;
  toggleReadAloud: () => void;
  increaseText: () => void;
  decreaseText: () => void;
  speak: (text: string) => void;
  stopSpeaking: () => void;
};

export const AccessibilityContext = createContext<AccessibilityState | null>(null);

export function useAccessibility() {
  const context = useContext(AccessibilityContext);
  if (!context) {
    throw new Error("useAccessibility debe usarse dentro de AccessibilityProvider");
  }
  return context;
}
