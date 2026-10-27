import { useEffect, useMemo, useState } from "react";
import { router } from "expo-router";
import * as Speech from "expo-speech";
import { AccessibilityInfo, Pressable, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { SpeechPort } from "@/application/speech-port";
import { mobileDependencies } from "@/composition/mobile-dependencies";
import { createMockStudentRequestSubmitter } from "@/infrastructure/mock-student-request-submitter";
import { StudentRequestSpeechControls } from "@/presentation/accessibility/speech-controls";
import { useAccessibilityPreferences } from "@/presentation/accessibility/accessibility-preferences-provider";
import { getAccessibilityColorPalette } from "@/presentation/accessibility/accessibility-color-palette";
import { useSubmitStudentRequest } from "@/presentation/hooks/use-submit-student-request";
import { StudentText } from "@/presentation/estudiante/student-text";

// Consumidor de diagnóstico: copiar temporalmente a app/ti4-60-probe.tsx.
export default function TI460Probe() {
  const preferences = useAccessibilityPreferences();
  const palette = getAccessibilityColorPalette(preferences.effective.highContrast);
  const [visible, setVisible] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [readerEnabled, setReaderEnabled] = useState<boolean | null>(null);
  const submitter = useMemo(
    () => createMockStudentRequestSubmitter({ delayMs: 9000, failureMode: "once" }),
    [],
  );
  const submission = useSubmitStudentRequest(submitter);
  const speechPort = useMemo<SpeechPort>(
    () => ({
      async speak(text) {
        console.info("TI4-60 read-request", unavailable ? "simulated-unavailable" : "native");
        const result = unavailable
          ? ({ status: "failed", reason: "locale-voice-unavailable" } as const)
          : await mobileDependencies.speechPort.speak(text);
        console.info("TI4-60 read-result", JSON.stringify(result));
        return result;
      },
      async stop() {
        console.info("TI4-60 stop-request");
        await mobileDependencies.speechPort.stop();
        console.info("TI4-60 stop-completed");
      },
    }),
    [unavailable],
  );

  useEffect(() => {
    console.info("TI4-60 submission", submission.status);
  }, [submission.status]);

  useEffect(() => {
    void AccessibilityInfo.isScreenReaderEnabled().then(setReaderEnabled);
    const subscription = AccessibilityInfo.addEventListener("screenReaderChanged", (enabled) => {
      setReaderEnabled(enabled);
      console.info("TI4-60 screen-reader", enabled);
    });
    void Speech.getAvailableVoicesAsync().then((voices) => {
      console.info(
        "TI4-60 Spanish voices",
        JSON.stringify(voices.filter((voice) => /^es(?:[-_]|$)/i.test(voice.language))),
      );
    });
    return () => subscription.remove();
  }, []);

  function action(label: string, onPress: () => void) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={onPress}
        style={{
          minHeight: 48,
          minWidth: 44,
          padding: 12,
          borderWidth: 1,
          borderColor: palette.border,
          borderRadius: 8,
        }}
      >
        <StudentText style={{ fontSize: 16, color: palette.text }}>{label}</StudentText>
      </Pressable>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: palette.surface }}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
        <StudentText
          accessibilityRole="header"
          weight="bold"
          style={{ fontSize: 24, color: palette.text }}
        >
          Prueba TI4-60
        </StudentText>
        <StudentText style={{ fontSize: 16, color: palette.secondary }}>
          Datos ficticios. TalkBack: {String(readerEnabled)}. Estado: {submission.status}.
        </StudentText>
        {visible ? (
          <StudentRequestSpeechControls speechPort={speechPort} submission={submission} />
        ) : null}
        <View style={{ gap: 12 }}>
          {action(
            "Enviar ejemplo",
            () =>
              void submission.submit({
                needSummary: "Acceder al material ficticio.",
                expectedOutcome: "Leer el material ficticio.",
                accessNeeds: [{ id: "writtenCommunication", label: "Comunicación escrita" }],
                generalAvailability: { preferredWeekdays: [1] },
                modalityPreference: "online",
                preferredAccessibleInformationChannel: "Correo accesible",
              }),
          )}
          {action(visible ? "Desmontar lector" : "Montar lector", () => setVisible(!visible))}
          {action(unavailable ? "Restaurar motor" : "Simular motor no disponible", () =>
            setUnavailable(!unavailable),
          )}
          {action("Texto al 200 %", () => void preferences.updatePreferences({ textScale: 2 }))}
          {action(
            "Texto del sistema",
            () => void preferences.updatePreferences({ textScale: "system" }),
          )}
          {action(
            "Activar alto contraste",
            () => void preferences.updatePreferences({ highContrast: "on" }),
          )}
          {action(
            "Restaurar contraste",
            () => void preferences.updatePreferences({ highContrast: "system" }),
          )}
          {action("Salir de prueba", () => router.replace("/"))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
