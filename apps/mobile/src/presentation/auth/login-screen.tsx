import { useEffect, useRef } from "react";
import { AccessibilityInfo, StyleSheet, View } from "react-native";

import type { AuthCredentials } from "../../application/auth-models";
import { getAccessibilityColorPalette } from "../accessibility/accessibility-color-palette";
import { useOptionalAccessibilityPreferences } from "../accessibility/accessibility-preferences-provider";
import { Action, Screen } from "../components/screen";
import { StudentText } from "../estudiante/student-text";
import { roles } from "../navigation/roles";
import { useNavigationSession } from "../navigation/session";

export function LoginScreen({
  unassignedPractitionerCredentials,
}: {
  readonly unassignedPractitionerCredentials: AuthCredentials;
}) {
  const { signIn, selectRole, status, error } = useNavigationSession();
  const isLoading = status === "loading";
  const accessibility = useOptionalAccessibilityPreferences();
  const colors = getAccessibilityColorPalette(accessibility?.effective.highContrast ?? false);
  const errorRef = useRef<View>(null);

  useEffect(() => {
    if (isLoading) {
      AccessibilityInfo.announceForAccessibility("Preparando la experiencia…");
    } else if (status === "error" && error && errorRef.current) {
      AccessibilityInfo.sendAccessibilityEvent(errorRef.current, "focus");
    }
  }, [error, isLoading, status]);

  return (
    <Screen
      title="Explora la aplicación"
      description="Selecciona un rol para explorar CERETI. El acceso institucional se integrará más adelante."
    >
      <View style={styles.selector}>
        <StudentText
          accessibilityRole="header"
          style={[styles.selectorTitle, { color: colors.text }]}
        >
          Elige un rol
        </StudentText>
        {roles.map(({ id, label }) => (
          <Action
            key={id}
            disabled={isLoading}
            label={`Entrar como ${label}`}
            onPress={() => void selectRole(id)}
          />
        ))}
        <Action
          disabled={isLoading}
          label="Entrar como Practicante sin asignación"
          onPress={() => void signIn(unassignedPractitionerCredentials)}
        />
        {isLoading ? (
          <StudentText
            accessibilityRole="progressbar"
            style={[styles.status, { color: colors.primary }]}
          >
            Preparando la experiencia…
          </StudentText>
        ) : null}
        {error ? (
          <View
            ref={errorRef}
            accessible
            accessibilityLabel={error}
            accessibilityRole="alert"
            style={styles.errorContainer}
          >
            <StudentText accessible={false} style={[styles.error, { color: colors.error }]}>
              {error}
            </StudentText>
          </View>
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  selector: { gap: 14 },
  selectorTitle: { color: "#182C31", fontSize: 22, fontWeight: "700" },
  status: { color: "#246259", fontSize: 16, textAlign: "center" },
  errorContainer: { alignSelf: "stretch" },
  error: {
    color: "#8A1C13",
    fontSize: 16,
    lineHeight: 23,
    textAlign: "center",
  },
});
