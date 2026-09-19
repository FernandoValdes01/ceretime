import { StyleSheet, Text, View } from "react-native";

import type { AuthCredentials } from "../../application/auth-models";
import { Action, Screen } from "../components/screen";
import { roles } from "../navigation/roles";
import { useNavigationSession } from "../navigation/session";

export function LoginScreen({
  unassignedPractitionerCredentials,
}: {
  readonly unassignedPractitionerCredentials: AuthCredentials;
}) {
  const { signIn, selectRole, status, error } = useNavigationSession();
  const isLoading = status === "loading";

  return (
    <Screen
      title="Explora la aplicación"
      description="Selecciona un rol para explorar CERETI. El acceso institucional se integrará más adelante."
    >
      <View style={styles.selector}>
        <Text accessibilityRole="header" style={styles.selectorTitle}>
          Elige un rol
        </Text>
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
          <Text accessibilityRole="progressbar" style={styles.status}>
            Preparando la experiencia…
          </Text>
        ) : null}
        {error ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
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
