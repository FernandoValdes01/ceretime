import { useEffect, useMemo, useState } from "react";
import * as Speech from "expo-speech";
import { AccessibilityInfo, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { SpeechPort } from "@/application/speech-port";
import { SpeechControls } from "@/presentation/accessibility/speech-controls";
import { mobileDependencies } from "@/composition/mobile-dependencies";

const sampleText =
  "Esta es una prueba de lectura en voz alta en español de Chile. El texto permanece visible en pantalla.";

export default function TI455Probe() {
  const [result, setResult] = useState("Preparando el motor de voz…");
  const [screenReader, setScreenReader] = useState("consultando");
  const speechPort = useMemo<SpeechPort>(
    () => ({
      async speak(text) {
        const outcome = await mobileDependencies.speechPort.speak(text);
        setResult(
          `Resultado de voz: ${outcome.status}${"reason" in outcome ? ` (${outcome.reason})` : ""}`,
        );
        return outcome;
      },
      async stop() {
        await mobileDependencies.speechPort.stop();
        setResult("Resultado de voz: stopped");
      },
    }),
    [],
  );

  useEffect(() => {
    const subscription = AccessibilityInfo.addEventListener("screenReaderChanged", (enabled) => {
      setScreenReader(String(enabled));
      console.log("TI4-55 screenReaderChanged:", enabled);
    });
    void AccessibilityInfo.isScreenReaderEnabled().then((enabled) => {
      setScreenReader(String(enabled));
      console.log("TI4-55 isScreenReaderEnabled:", enabled);
    });
    void Speech.getAvailableVoicesAsync()
      .then((voices) => {
        const vocesEnEspanol = voices
          .filter((voice) => /^es(?:[-_]|$)/i.test(voice.language))
          .map((voice) => `${voice.language} / ${voice.name}`);
        const preferredVoice =
          voices.find((voice) => /^es[-_]cl$/i.test(voice.language)) ??
          voices.find((voice) => /^es[-_]es$/i.test(voice.language)) ??
          voices.find((voice) => /^es(?:[-_]|$)/i.test(voice.language));
        setResult(
          preferredVoice
            ? `Voz elegida por el adaptador: ${preferredVoice.language} / ${preferredVoice.name}`
            : "Motor disponible, sin voces españolas instaladas",
        );
        console.log("TI4-55 voces en español:", vocesEnEspanol);
      })
      .catch((error: unknown) => {
        setResult(`Error al consultar voces: ${String(error)}`);
        console.log("TI4-55 voice query failed:", String(error));
      });
    return () => subscription.remove();
  }, []);

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.content}>
        <Text accessibilityRole="header" style={styles.heading}>
          Prueba de síntesis de voz
        </Text>
        <Text style={styles.sample}>{sampleText}</Text>
        <SpeechControls speechPort={speechPort} text={sampleText} />
        <Text style={styles.result}>API lector de pantalla: {screenReader}</Text>
        <Text accessibilityLiveRegion="polite" style={styles.result}>
          {result}
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#FFFFFF" },
  content: { flex: 1, justifyContent: "center", gap: 24, padding: 24 },
  heading: { color: "#18312E", fontSize: 28, fontWeight: "700" },
  sample: { color: "#18312E", fontSize: 24, lineHeight: 34 },
  result: { color: "#42565B", fontSize: 16 },
});
