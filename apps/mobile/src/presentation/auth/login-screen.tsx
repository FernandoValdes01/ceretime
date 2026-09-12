import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { unassignedPractitionerCredentials } from "../../infrastructure/mock-authentication";
import { Action, Screen } from "../components/screen";
import { roles } from "../navigation/roles";
import { useNavigationSession } from "../navigation/session";

export function LoginScreen() {
  const { signIn, selectRole, status, error, clearError } = useNavigationSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const isLoading = status === "loading";

  const submit = () => {
    if (isLoading) return;
    void signIn({ email, password });
  };

  return (
    <Screen
      title="Explora la aplicación"
      description="Inicia sesión con una cuenta ficticia para explorar CERETI. Esta autenticación es local y no conecta con ningún servicio externo."
    >
      <View style={styles.form}>
        <Text accessibilityRole="header" style={styles.formTitle}>
          Inicia sesión
        </Text>
        <View style={styles.field}>
          <Text style={styles.label}>Correo electrónico</Text>
          <TextInput
            accessibilityLabel="Correo electrónico"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!isLoading}
            keyboardType="email-address"
            onChangeText={(value) => {
              if (isLoading) return;
              setEmail(value);
              clearError();
            }}
            placeholder="tu-correo@cereti.test"
            style={styles.input}
            value={email}
          />
        </View>
        <View style={styles.field}>
          <Text style={styles.label}>Contraseña</Text>
          <TextInput
            accessibilityLabel="Contraseña"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!isLoading}
            onChangeText={(value) => {
              if (isLoading) return;
              setPassword(value);
              clearError();
            }}
            onSubmitEditing={isLoading ? undefined : submit}
            placeholder="Contraseña ficticia"
            secureTextEntry
            style={styles.input}
            value={password}
          />
        </View>
        <Action
          disabled={isLoading}
          label={isLoading ? "Iniciando sesión…" : "Iniciar sesión"}
          onPress={submit}
        />
        {isLoading ? (
          <Text accessibilityRole="progressbar" style={styles.status}>
            Validando acceso…
          </Text>
        ) : null}
        {error ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        ) : null}
      </View>

      <View style={styles.demoSection}>
        <Text style={styles.demoTitle}>Accesos de demostración</Text>
        <Text style={styles.demoDescription}>
          También puedes entrar directamente con una de estas cuentas ficticias.
        </Text>
        {roles.map(({ id, label }) => (
          <Action
            key={id}
            disabled={isLoading}
            label={`Entrar como ${label}`}
            onPress={() => void selectRole(id)}
          />
        ))}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Entrar como Practicante sin asignación"
          disabled={isLoading}
          onPress={() => void signIn(unassignedPractitionerCredentials)}
          style={styles.unassignedLink}
        >
          <Text style={styles.unassignedText}>Probar practicante sin asignación</Text>
        </Pressable>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  form: { gap: 14 },
  formTitle: { color: "#182C31", fontSize: 22, fontWeight: "700" },
  field: { gap: 7 },
  label: { color: "#182C31", fontSize: 16, fontWeight: "600" },
  input: {
    minHeight: 52,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: "#9AA9AC",
    borderRadius: 10,
    backgroundColor: "#FFFFFF",
    color: "#182C31",
    fontSize: 16,
  },
  status: { color: "#246259", fontSize: 16, textAlign: "center" },
  error: {
    color: "#8A1C13",
    fontSize: 16,
    lineHeight: 23,
    textAlign: "center",
  },
  demoSection: { gap: 12, marginTop: 8 },
  demoTitle: { color: "#182C31", fontSize: 20, fontWeight: "700" },
  demoDescription: { color: "#42565B", fontSize: 16, lineHeight: 23 },
  unassignedLink: { alignItems: "center", padding: 8 },
  unassignedText: { color: "#246259", fontSize: 16, textDecorationLine: "underline" },
});
