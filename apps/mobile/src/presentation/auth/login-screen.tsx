import { StyleSheet, View } from "react-native";

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
          <StudentText accessibilityRole="alert" style={[styles.error, { color: colors.error }]}>
            {error}
          </StudentText>
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  selector: { gap: 14 },
  selectorTitle: { color: "#182C31", fontSize: 22, fontWeight: "700" },
  status: { color: "#246259", fontSize: 16, textAlign: "center" },
  error: {
    color: "#8A1C13",
    fontSize: 16,
    lineHeight: 23,
    textAlign: "center",
  },
});
