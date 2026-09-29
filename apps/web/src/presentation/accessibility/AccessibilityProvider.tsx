import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import {
  A11Y_STORAGE_KEY,
  AccessibilityContext,
  TEXT_SCALES,
  TEXT_SIZE_ORDER,
} from "./accessibility-context.ts";
import type { TextSize } from "./accessibility-context.ts";

/** Lee las preferencias guardadas sin efectos: inicializador perezoso de estado. */
function loadSavedPrefs(): { textSize: TextSize; highContrast: boolean } {
  try {
    const raw = localStorage.getItem(A11Y_STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw) as { textSize?: TextSize; highContrast?: boolean };
      return {
        textSize:
          saved.textSize && TEXT_SIZE_ORDER.includes(saved.textSize) ? saved.textSize : "normal",
        highContrast: typeof saved.highContrast === "boolean" ? saved.highContrast : false,
      };
    }
  } catch {
    // Sin preferencias guardadas: se usan los valores base.
  }
  return { textSize: "normal", highContrast: false };
}

export function AccessibilityProvider({ children }: { children: ReactNode }) {
  const [saved] = useState(loadSavedPrefs);
  const [textSize, setTextSizeState] = useState<TextSize>(saved.textSize);
  const [highContrast, setHighContrast] = useState(saved.highContrast);
  const [readAloud, setReadAloud] = useState(false);

  useEffect(() => {
    document.documentElement.style.setProperty("--font-scale", String(TEXT_SCALES[textSize]));
    document.documentElement.classList.toggle("hc", highContrast);
    try {
      localStorage.setItem(A11Y_STORAGE_KEY, JSON.stringify({ textSize, highContrast }));
    } catch {
      // Almacenamiento no disponible: la sesión sigue funcionando.
    }
  }, [textSize, highContrast]);

  const setTextSize = useCallback((size: TextSize) => setTextSizeState(size), []);

  const increaseText = useCallback(() => {
    setTextSizeState((current) =>
      TEXT_SIZE_ORDER[Math.min(TEXT_SIZE_ORDER.indexOf(current) + 1, TEXT_SIZE_ORDER.length - 1)],
    );
  }, []);

  const decreaseText = useCallback(() => {
    setTextSizeState((current) =>
      TEXT_SIZE_ORDER[Math.max(TEXT_SIZE_ORDER.indexOf(current) - 1, 0)],
    );
  }, []);

  const toggleHighContrast = useCallback(() => setHighContrast((value) => !value), []);

  const speak = useCallback((text: string) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "es-ES";
    utterance.rate = 0.95;
    window.speechSynthesis.speak(utterance);
  }, []);

  const stopSpeaking = useCallback(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
  }, []);

  const toggleReadAloud = useCallback(() => {
    setReadAloud((value) => {
      const next = !value;
      if (!next && typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
      return next;
    });
  }, []);

  return (
    <AccessibilityContext.Provider
      value={{
        textSize,
        highContrast,
        readAloud,
        setTextSize,
        toggleHighContrast,
        toggleReadAloud,
        increaseText,
        decreaseText,
        speak,
        stopSpeaking,
      }}
    >
      {children}
    </AccessibilityContext.Provider>
  );
}
