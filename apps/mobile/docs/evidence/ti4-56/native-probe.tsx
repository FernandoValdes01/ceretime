import { useCallback, useEffect, useRef, useState } from "react";
import { useFocusEffect } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { parseSpeechCommand } from "../../../src/application/speech-command-parser";
import type { SpeechCommand } from "../../../src/application/speech-command-parser";
import type { SpeechRecognitionPort } from "../../../src/application/speech-port";

const commandLabels: Record<SpeechCommand, string> = {
  "open-requests": "Abrir solicitudes",
  back: "Volver",
  cancel: "Cancelar",
};

export function NativeSpeechProbe({
  recognitionPort,
}: {
  readonly recognitionPort: SpeechRecognitionPort;
}) {
  const [listening, setListening] = useState(false);
  const [message, setMessage] = useState("Prueba un comando de voz o usa el control para detener.");
  const mounted = useRef(false);
  const request = useRef(0);

  const stopRecognition = useCallback(async () => {
    request.current += 1;
    if (mounted.current) {
      setListening(false);
      setMessage("Reconocimiento detenido.");
    }
    try {
      await recognitionPort.stop();
    } catch {
      if (mounted.current) setMessage("No se pudo detener el reconocimiento.");
    }
  }, [recognitionPort]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      request.current += 1;
    };
  }, [recognitionPort]);

  useFocusEffect(
    useCallback(
      () => () => {
        request.current += 1;
        if (mounted.current) setListening(false);
        void recognitionPort.stop().catch(() => undefined);
      },
      [recognitionPort],
    ),
  );

  async function handlePress() {
    if (listening) {
      await stopRecognition();
      return;
    }

    const id = ++request.current;
    setListening(true);
    setMessage("Escuchando un comando…");
    try {
      const result = await recognitionPort.recognize();
      if (!mounted.current || request.current !== id) return;
      setListening(false);
      if (result.status === "recognized") {
        const command = parseSpeechCommand(result.transcript);
        setMessage(
          command.type === "unknown"
            ? "Frase desconocida. No se realizará ninguna acción."
            : `Comando reconocido: ${commandLabels[command.type]}. No se realizará ninguna acción en esta prueba.`,
        );
        return;
      }

      const messages = {
        silence: "No se detectó voz.",
        denied: "Permiso de micrófono denegado.",
        unavailable: "El reconocimiento local en español no está disponible.",
        failed: "Falló el reconocimiento de voz.",
        stopped: "Reconocimiento detenido.",
      } as const;
      setMessage(messages[result.status]);
    } catch {
      if (mounted.current && request.current === id) {
        setListening(false);
        setMessage("Falló el reconocimiento de voz.");
      }
    }
  }

  return (
    <View style={styles.container}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={listening ? "Detener reconocimiento" : "Probar comando de voz"}
        accessibilityState={{ busy: listening }}
        onPress={handlePress}
        android_ripple={{ color: "#17483F" }}
        style={styles.button}
      >
        <Text style={styles.buttonLabel}>
          {listening ? "Detener reconocimiento" : "Probar comando de voz"}
        </Text>
      </Pressable>
      <Text accessibilityLiveRegion="polite" style={styles.message}>
        {message}
      </Text>
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
  buttonLabel: { color: "#FFFFFF", fontSize: 17, fontWeight: "600", textAlign: "center" },
  message: { color: "#42565B", fontSize: 16, lineHeight: 24 },
});
