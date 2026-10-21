import { useState } from "react";
import { useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { mobileDependencies } from "@/composition/mobile-dependencies";
import { SpeechCommandControls } from "@/presentation/accessibility/speech-controls";

export default function TI461NativeProbe() {
  const router = useRouter();
  const [controlsVisible, setControlsVisible] = useState(true);

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text accessibilityRole="header" style={styles.heading}>
          Prueba local de comandos de voz
        </Text>
        <Text style={styles.body}>
          Prueba con frases ficticias: «abrir solicitudes», «volver» o «cancelar». También puedes
          usar los tres botones en cualquier estado. No uses información personal.
        </Text>
        {controlsVisible ? (
          <SpeechCommandControls
            speechPort={mobileDependencies.speechRecognitionPort}
            onOpenRequests={() => router.push("/estudiante/solicitudes")}
            onBack={() => router.back()}
            onCancel={() => setControlsVisible(false)}
          />
        ) : (
          <View style={styles.closed}>
            <Text style={styles.body}>
              Controles locales cerrados; no se canceló ninguna solicitud.
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Volver a mostrar controles de voz"
              onPress={() => setControlsVisible(true)}
              style={styles.reopenButton}
            >
              <Text style={styles.reopenLabel}>Mostrar controles</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#FFFFFF" },
  content: { flexGrow: 1, gap: 24, padding: 24 },
  heading: { color: "#18312E", fontSize: 28, fontWeight: "700" },
  body: { color: "#18312E", fontSize: 18, lineHeight: 27 },
  closed: { gap: 16 },
  reopenButton: {
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: "#246259",
  },
  reopenLabel: { color: "#FFFFFF", fontSize: 17, fontWeight: "600" },
});
