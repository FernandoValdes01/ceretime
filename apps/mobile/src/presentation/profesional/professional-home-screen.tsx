import { router } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { RoleGuard } from "@/presentation/navigation/role-guard";
import { StudentFonts, StudentText } from "@/presentation/estudiante/student-text";
import { ProfessionalHeader } from "./professional-header";

export function ProfessionalHomeScreen() {
  return (
    <RoleGuard requiredRole="profesional">
      <StudentFonts>
        <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
          <ProfessionalHeader />
          <View style={styles.content}>
            <StudentText accessibilityRole="header" weight="bold" style={styles.title}>
              Inicio
            </StudentText>
            <StudentText style={styles.description}>
              Revisa tu agenda y mantén tus acompañamientos organizados.
            </StudentText>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Abrir agenda"
              onPress={() => router.replace("/profesional")}
              style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}
            >
              <StudentText weight="semibold" style={styles.actionText}>
                Ver agenda
              </StudentText>
            </Pressable>
          </View>
        </SafeAreaView>
      </StudentFonts>
    </RoleGuard>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#F7FAF9" },
  content: { flex: 1, justifyContent: "center", padding: 24, gap: 12 },
  title: { color: "#182C31", fontSize: 30 },
  description: { color: "#5B6C6E", fontSize: 17, lineHeight: 25 },
  action: {
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
    borderRadius: 12,
    backgroundColor: "#078B7B",
  },
  actionPressed: { backgroundColor: "#056B60" },
  actionText: { color: "#FFFFFF", fontSize: 17 },
});
