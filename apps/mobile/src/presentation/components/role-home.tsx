import { View, StyleSheet } from "react-native";
import type { PropsWithChildren } from "react";

import type { NavigationRole } from "../navigation/roles";
import { useNavigationSession } from "../navigation/session";
import { getAccessibilityColorPalette } from "../accessibility/accessibility-color-palette";
import { useOptionalAccessibilityPreferences } from "../accessibility/accessibility-preferences-provider";
import { Action, Screen } from "./screen";
import { StudentText } from "../estudiante/student-text";

export function AccessDeniedNotice({
  role,
  onDismiss,
}: {
  readonly role: NavigationRole;
  readonly onDismiss: () => void;
}) {
  const accessibility = useOptionalAccessibilityPreferences();
  const colors = getAccessibilityColorPalette(accessibility?.effective.highContrast ?? false);

  return (
    <View
      style={[styles.denied, { backgroundColor: colors.errorSurface, borderColor: colors.error }]}
    >
      <StudentText accessibilityRole="alert" style={[styles.deniedTitle, { color: colors.error }]}>
        Acceso denegado
      </StudentText>
      <StudentText style={[styles.deniedDescription, { color: colors.secondary }]}>
        No puedes abrir la sección de {role} con tu sesión actual.
      </StudentText>
      <Action label="Entendido" onPress={onDismiss} />
    </View>
  );
}

export function RoleHome({
  title,
  description,
  children,
}: PropsWithChildren<{ title: string; description?: string }>) {
  const { accessDeniedRole, dismissAccessDenied, status, error } = useNavigationSession();
  const isSigningOut = status === "loading";
  const accessibility = useOptionalAccessibilityPreferences();
  const colors = getAccessibilityColorPalette(accessibility?.effective.highContrast ?? false);

  return (
    <Screen title={title} description={description} showAppHeader>
      {accessDeniedRole ? (
        <AccessDeniedNotice role={accessDeniedRole} onDismiss={dismissAccessDenied} />
      ) : null}
      {children}
      {isSigningOut ? (
        <StudentText
          accessibilityLabel="Cerrando sesión"
          accessibilityLiveRegion="polite"
          accessibilityRole="progressbar"
          style={[styles.status, { color: colors.primary }]}
        >
          Cerrando sesión…
        </StudentText>
      ) : null}
      {error ? (
        <StudentText accessibilityRole="alert" style={[styles.error, { color: colors.error }]}>
          {error}
        </StudentText>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  denied: {
    gap: 10,
    padding: 16,
    borderRadius: 12,
    backgroundColor: "#FCEBEC",
    borderWidth: 1,
    borderColor: "#B42318",
  },
  deniedTitle: { color: "#8A1C13", fontSize: 18, fontWeight: "700" },
  deniedDescription: { color: "#5D2520", fontSize: 16, lineHeight: 23 },
  status: { color: "#246259", fontSize: 16, textAlign: "center" },
  error: { color: "#8A1C13", fontSize: 16, lineHeight: 23, textAlign: "center" },
});
