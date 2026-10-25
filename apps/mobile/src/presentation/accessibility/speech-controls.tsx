import { useCallback, useEffect, useRef, useState } from "react";
import { useFocusEffect } from "expo-router";
import {
  AccessibilityInfo,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { parseSpeechCommand, type SpeechCommand } from "../../application/speech-command-parser";
import type { SpeechPort, SpeechRecognitionPort } from "../../application/speech-port";
import type { StudentRequestSubmissionState } from "../hooks/use-submit-student-request";
import { StudentText } from "../estudiante/student-text";
import { useOptionalAccessibilityPreferences } from "./accessibility-preferences-provider";
import { getAccessibilityColorPalette } from "./accessibility-color-palette";

export function StudentRequestSpeechControls({
  speechPort,
  submission,
}: {
  readonly speechPort: SpeechPort;
  readonly submission: Pick<StudentRequestSubmissionState, "status" | "receipt">;
}) {
  const text =
    submission.status === "submitting"
      ? "Enviando solicitud ficticia."
      : submission.status === "error"
        ? "No pudimos enviar la solicitud ficticia. Puedes reintentar."
        : submission.status === "success" && submission.receipt
          ? `Solicitud ficticia enviada. Referencia: ${submission.receipt.requestId}.`
          : "";

  return <SpeechControls speechPort={speechPort} text={text} />;
}

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
  const [message, setMessage] = useState(text);
  if (message !== text) {
    setMessage(text);
    setStatus("idle");
  }
  const mounted = useRef(false);
  const request = useRef(0);
  const screenReaderEventVersion = useRef(0);

  const preferences = useOptionalAccessibilityPreferences();
  const palette = getAccessibilityColorPalette(preferences?.effective.highContrast ?? false);
  const stopSpeech = useCallback(() => speechPort.stop(), [speechPort]);

  // Cambiar el mensaje invalida la lectura anterior sin iniciar otra automáticamente.
  useEffect(() => {
    return () => {
      request.current += 1;
      void stopSpeech().catch(() => undefined);
    };
  }, [text, stopSpeech]);

  useEffect(() => {
    mounted.current = true;
    const queryVersion = screenReaderEventVersion.current;
    const subscription = AccessibilityInfo.addEventListener("screenReaderChanged", (enabled) => {
      screenReaderEventVersion.current += 1;
      setReaderEnabled(enabled);
      if (enabled) {
        const id = ++request.current;
        setStatus("idle");
        void stopSpeech().catch(() => {
          if (mounted.current && request.current === id) setStatus("failed");
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
      const id = ++request.current;
      setStatus("idle");
      try {
        await stopSpeech();
      } catch {
        if (mounted.current && request.current === id) setStatus("failed");
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
    <View style={[styles.container, { backgroundColor: palette.surface }]}>
      <StudentText selectable style={[styles.message, { color: palette.text }]}>
        {text}
      </StudentText>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={status === "speaking" ? "Detener lectura" : label}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={handlePress}
        android_ripple={{ color: palette.actionPressed }}
        style={[styles.button, { backgroundColor: palette.action }, disabled && styles.disabled]}
      >
        <StudentText weight="semibold" style={styles.buttonLabel}>
          {status === "speaking" ? "Detener lectura" : label}
        </StudentText>
      </Pressable>
      {readerEnabled ? (
        <StudentText style={[styles.message, { color: palette.secondary }]}>
          El lector de pantalla del sistema puede leer el texto visible.
        </StudentText>
      ) : status === "failed" ? (
        <StudentText
          accessibilityLiveRegion="polite"
          style={[styles.message, { color: palette.secondary }]}
        >
          No se pudo reproducir el audio. Revisa el texto en pantalla y vuelve a intentarlo.
        </StudentText>
      ) : null}
    </View>
  );
}

type SpeechCommandStatus =
  | "idle"
  | "listening"
  | "silence"
  | "denied"
  | "unavailable"
  | "unknown"
  | "failed";

export function SpeechCommandControls({
  speechPort,
  onOpenRequests,
  onBack,
  onCancel,
}: {
  readonly speechPort: SpeechRecognitionPort;
  readonly onOpenRequests: () => void;
  readonly onBack: () => void;
  readonly onCancel: () => void;
}) {
  const [status, setStatus] = useState<SpeechCommandStatus>("idle");
  const mounted = useRef(false);
  const listening = useRef(false);
  const generation = useRef(0);

  const stopRecognition = useCallback(() => {
    generation.current += 1;
    listening.current = false;
    if (mounted.current) setStatus("idle");
    void speechPort.stop().catch(() => undefined);
  }, [speechPort]);

  const runCommand = useCallback(
    (command: SpeechCommand) => {
      stopRecognition();
      if (command === "open-requests") onOpenRequests();
      if (command === "back") onBack();
      if (command === "cancel") onCancel();
    },
    [onBack, onCancel, onOpenRequests, stopRecognition],
  );

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      listening.current = false;
      generation.current += 1;
    };
  }, [speechPort]);

  useFocusEffect(
    useCallback(
      () => () => {
        listening.current = false;
        generation.current += 1;
        if (mounted.current) setStatus("idle");
        void speechPort.stop().catch(() => undefined);
      },
      [speechPort],
    ),
  );

  async function handleVoicePress() {
    if (listening.current) {
      stopRecognition();
      return;
    }

    const requestId = ++generation.current;
    listening.current = true;
    setStatus("listening");
    try {
      const result = await speechPort.recognize();
      if (!mounted.current || generation.current !== requestId) return;
      listening.current = false;
      if (result.status === "recognized") {
        const command = parseSpeechCommand(result.transcript);
        if (command.type === "unknown") {
          setStatus("unknown");
          return;
        }
        runCommand(command.type);
        return;
      }
      setStatus(result.status === "stopped" ? "idle" : result.status);
    } catch {
      if (mounted.current && generation.current === requestId) {
        listening.current = false;
        setStatus("failed");
      }
    }
  }

  const statusMessage: Record<SpeechCommandStatus, string | null> = {
    idle: null,
    listening: "Escuchando. También puedes usar los botones en cualquier momento.",
    silence: "No se detectó voz. Puedes usar los botones.",
    denied: "No hay permiso para usar el micrófono. Puedes usar los botones.",
    unavailable: "El reconocimiento de voz no está disponible. Puedes usar los botones.",
    unknown: "No reconocí ese comando. Prueba abrir solicitudes, volver o cancelar.",
    failed: "Falló el reconocimiento. Puedes volver a intentarlo o usar los botones.",
  };

  return (
    <View style={commandStyles.container}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          status === "listening" ? "Detener reconocimiento" : "Usar comando de voz"
        }
        accessibilityState={{ disabled: false }}
        onPress={handleVoicePress}
        android_ripple={{ color: "#17483F" }}
        style={styles.button}
      >
        <Text style={styles.buttonLabel}>
          {status === "listening" ? "Detener escucha" : "Usar comando de voz"}
        </Text>
      </Pressable>
      <View style={commandStyles.actions}>
        <CommandButton label="Abrir solicitudes" onPress={() => runCommand("open-requests")} />
        <CommandButton label="Volver" onPress={() => runCommand("back")} />
        <CommandButton label="Cancelar" onPress={() => runCommand("cancel")} />
      </View>
      {statusMessage[status] ? (
        <Text accessibilityLiveRegion="polite" style={commandStyles.message}>
          {statusMessage[status]}
        </Text>
      ) : null}
    </View>
  );
}

export function SpeechCommandLauncher({
  speechPort,
  onOpenRequests,
  onBack,
  bottomOffset = 0,
}: {
  readonly speechPort: SpeechRecognitionPort;
  readonly onOpenRequests: () => void;
  readonly onBack: () => void;
  readonly bottomOffset?: number;
}) {
  const [open, setOpen] = useState(false);

  function closeThen(action: () => void) {
    setOpen(false);
    action();
  }

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Comandos de voz"
        accessibilityHint="Abre los comandos abrir solicitudes, volver y cancelar"
        onPress={() => setOpen(true)}
        android_ripple={{ color: "#D3E4DF" }}
        style={[styles.launcher, { bottom: bottomOffset }]}
      >
        <Text style={styles.launcherLabel}>Comandos de voz</Text>
      </Pressable>
      {open ? (
        <Modal
          transparent
          visible
          animationType="fade"
          statusBarTranslucent
          onRequestClose={() => setOpen(false)}
        >
          <View style={styles.modalBackdrop}>
            <View accessibilityViewIsModal style={styles.modalSheet}>
              <View style={styles.modalHeader}>
                <Text accessibilityRole="header" style={styles.modalTitle}>
                  Comandos de voz
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Cerrar comandos de voz"
                  onPress={() => setOpen(false)}
                  style={styles.modalClose}
                >
                  <Text style={styles.modalCloseLabel}>Cerrar</Text>
                </Pressable>
              </View>
              <ScrollView
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={styles.modalContent}
              >
                <SpeechCommandControls
                  speechPort={speechPort}
                  onOpenRequests={() => closeThen(onOpenRequests)}
                  onBack={() => closeThen(onBack)}
                  onCancel={() => setOpen(false)}
                />
              </ScrollView>
            </View>
          </View>
        </Modal>
      ) : null}
    </>
  );
}

function CommandButton({
  label,
  onPress,
}: {
  readonly label: string;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: false }}
      onPress={onPress}
      android_ripple={{ color: "#D3E4DF" }}
      style={commandStyles.secondaryButton}
    >
      <Text style={commandStyles.secondaryLabel}>{label}</Text>
    </Pressable>
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
  launcher: {
    position: "absolute",
    right: 16,
    minHeight: 48,
    minWidth: 44,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 24,
    backgroundColor: "#246259",
    boxShadow: "0 2px 6px rgba(24, 44, 49, 0.28)",
  },
  launcherLabel: { color: "#FFFFFF", fontSize: 16, fontWeight: "600", textAlign: "center" },
  modalBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0, 0, 0, 0.4)" },
  modalSheet: {
    maxHeight: "85%",
    gap: 16,
    padding: 20,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    backgroundColor: "#FFFFFF",
  },
  modalHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
  modalTitle: { flex: 1, color: "#18312E", fontSize: 22, fontWeight: "700" },
  modalClose: {
    minHeight: 44,
    minWidth: 44,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  modalCloseLabel: { color: "#17483F", fontSize: 16, fontWeight: "600" },
  modalContent: { gap: 12, paddingBottom: 8 },
});

const commandStyles = StyleSheet.create({
  container: { gap: 12 },
  actions: { gap: 8 },
  secondaryButton: {
    minHeight: 52,
    minWidth: 44,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderWidth: 2,
    borderColor: "#246259",
    borderRadius: 12,
    backgroundColor: "#FFFFFF",
  },
  secondaryLabel: { color: "#17483F", fontSize: 17, fontWeight: "600", textAlign: "center" },
  message: { color: "#334745", fontSize: 16, lineHeight: 24 },
});
