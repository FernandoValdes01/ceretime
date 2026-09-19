import { StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { RoleGuard } from "@/presentation/navigation/role-guard";
import { StudentFonts, StudentText } from "@/presentation/estudiante/student-text";
import { ProfessionalHeader } from "./professional-header";

export function ProfessionalPlaceholderScreen({
  title,
  description,
}: {
  readonly title: string;
  readonly description: string;
}) {
  return (
    <RoleGuard requiredRole="profesional">
      <StudentFonts>
        <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
          <ProfessionalHeader />
          <View style={styles.content}>
            <StudentText accessibilityRole="header" weight="bold" style={styles.title}>
              {title}
            </StudentText>
            <StudentText style={styles.description}>{description}</StudentText>
          </View>
        </SafeAreaView>
      </StudentFonts>
    </RoleGuard>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#F7FAF9" },
  content: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 10 },
  title: { color: "#182C31", fontSize: 28, textAlign: "center" },
  description: {
    maxWidth: 300,
    color: "#5B6C6E",
    fontSize: 16,
    lineHeight: 24,
    textAlign: "center",
  },
});
