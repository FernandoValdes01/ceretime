import { useCallback, useEffect, useRef, useState } from "react";
import { useFocusEffect } from "expo-router";
import { AccessibilityInfo, Pressable, StyleSheet, Text, View } from "react-native";
import type { SpeechPort } from "../../application/speech-port";

export function SpeechControls({
  speechPort,
  text,
  label = "Leer en voz alta",
}: {
  readonly speechPort: SpeechPort;
  readonly text: string;
  readonly label?: string;
}) {
  const [readerEnabled, setReaderEnabled] = useState(true);
  const [status, setStatus] = useState<"idle" | "speaking" | "failed">("idle");
  const mounted = useRef(false);
  const request = useRef(0);
  const screenReaderEventVersion = useRef(0);

  const stopSpeech = useCallback(() => speechPort.stop(), [speechPort]);

  useEffect(() => {
    mounted.current = true;
    const queryVersion = screenReaderEventVersion.current;
    const subscription = AccessibilityInfo.addEventListener("screenReaderChanged", (enabled) => {
      screenReaderEventVersion.current += 1;
      setReaderEnabled(enabled);
      if (enabled) {
        request.current += 1;
        setStatus("idle");
        void stopSpeech().catch(() => {
          if (mounted.current) setStatus("failed");
        });
      }
    });
    void AccessibilityInfo.isScreenReaderEnabled()
      .then((enabled) => {
        if (mounted.current && screenReaderEventVersion.current === queryVersion)
          setReaderEnabled(enabled);
      })
      .catch(() => {
        if (mounted.current && screenReaderEventVersion.current === queryVersion)
          setReaderEnabled(true);
      });

    return () => {
      mounted.current = false;
      subscription.remove();
    };
  }, [stopSpeech]);

  useFocusEffect(
    useCallback(
      () => () => {
        request.current += 1;
        if (mounted.current) setStatus("idle");
        void stopSpeech().catch(() => undefined);
      },
      [stopSpeech],
    ),
  );

  async function handlePress() {
    if (readerEnabled) return;
    if (status === "speaking") {
      request.current += 1;
      setStatus("idle");
      try {
        await stopSpeech();
      } catch {
        if (mounted.current) setStatus("failed");
      }
      return;
    }

    const id = ++request.current;
    setStatus("speaking");
    try {
      const result = await speechPort.speak(text);
      if (!mounted.current || request.current !== id) return;
      setStatus(result.status === "failed" ? "failed" : "idle");
    } catch {
      if (mounted.current && request.current === id) setStatus("failed");
    }
  }

  const disabled = readerEnabled || !text.trim();

  return (
    <View style={styles.container}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={status === "speaking" ? "Detener lectura" : label}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={handlePress}
        android_ripple={{ color: "#17483F" }}
        style={[styles.button, disabled && styles.disabled]}
      >
        <Text style={styles.buttonLabel}>{status === "speaking" ? "Detener lectura" : label}</Text>
      </Pressable>
      {readerEnabled ? (
        <Text style={styles.message}>
          El lector de pantalla del sistema puede leer el texto visible.
        </Text>
      ) : status === "failed" ? (
        <Text accessibilityLiveRegion="polite" style={styles.message}>
          No se pudo reproducir el audio. Revisa el texto en pantalla y vuelve a intentarlo.
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 12 },
  button: {
    minHeight: 52,
    minWidth: 44,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: "#246259",
  },
  disabled: { opacity: 0.55 },
  buttonLabel: { color: "#FFFFFF", fontSize: 17, fontWeight: "600", textAlign: "center" },
  message: { color: "#42565B", fontSize: 16, lineHeight: 24 },
});
