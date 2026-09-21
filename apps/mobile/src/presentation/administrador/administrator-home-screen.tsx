import { router } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppHeader } from "@/presentation/components/app-header";
import { AccessDeniedNotice } from "@/presentation/components/role-home";
import { StudentFonts, StudentText } from "@/presentation/estudiante/student-text";
import { RoleGuard } from "@/presentation/navigation/role-guard";
import { useNavigationSession } from "@/presentation/navigation/session";

export function AdministratorHomeScreen() {
  const { accessDeniedRole, dismissAccessDenied } = useNavigationSession();

  return (
    <RoleGuard requiredRole="administrador">
      <StudentFonts>
        <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
          <AppHeader />
          <View style={styles.content}>
            {accessDeniedRole ? (
              <AccessDeniedNotice role={accessDeniedRole} onDismiss={dismissAccessDenied} />
            ) : null}
            <StudentText accessibilityRole="header" weight="bold" style={styles.title}>
              Inicio de Administrador
            </StudentText>
            <StudentText style={styles.description}>
              Gestiona la habilitación institucional de cuentas de Practicantes.
            </StudentText>
            <Pressable
              cssInterop={false}
              accessibilityHint="Abre la lista de cuentas institucionales"
              accessibilityRole="button"
              accessibilityLabel="Abrir habilitación de cuentas"
              onPress={() => router.push("/administrador/usuarios")}
              style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}
            >
              <StudentText weight="semibold" style={styles.actionText}>
                Habilitar cuentas
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
  title: { color: "#182C31", fontSize: 30, lineHeight: 36 },
  description: { color: "#42565B", fontSize: 17, lineHeight: 25 },
  action: {
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
    borderRadius: 12,
    backgroundColor: "#078B7B",
  },
  actionPressed: { backgroundColor: "#056B60" },
  actionText: { color: "#FFFFFF", fontSize: 17, lineHeight: 23 },
});
