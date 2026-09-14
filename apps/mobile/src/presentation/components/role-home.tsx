import { View, StyleSheet, Text } from "react-native";
import type { PropsWithChildren } from "react";

import type { NavigationRole } from "../navigation/roles";
import { useNavigationSession } from "../navigation/session";
import { Action, Screen } from "./screen";

export function AccessDeniedNotice({
  role,
  onDismiss,
}: {
  readonly role: NavigationRole;
  readonly onDismiss: () => void;
}) {
  return (
    <View style={styles.denied}>
      <Text accessibilityRole="alert" style={styles.deniedTitle}>
        Acceso denegado
      </Text>
      <Text style={styles.deniedDescription}>
        No puedes abrir la sección de {role} con tu sesión actual.
      </Text>
      <Action label="Entendido" onPress={onDismiss} />
    </View>
  );
}

export function RoleHome({
  title,
  description,
  children,
}: PropsWithChildren<{ title: string; description: string }>) {
  const { signOut, accessDeniedRole, dismissAccessDenied, status, error } = useNavigationSession();
  const isSigningOut = status === "loading";

  return (
    <Screen title={title} description={description}>
      {accessDeniedRole ? (
        <AccessDeniedNotice role={accessDeniedRole} onDismiss={dismissAccessDenied} />
      ) : null}
      {children}
      {isSigningOut ? (
        <Text
          accessibilityLabel="Cerrando sesión"
          accessibilityLiveRegion="polite"
          accessibilityRole="progressbar"
          style={styles.status}
        >
          Cerrando sesión…
        </Text>
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
      <Action
        disabled={isSigningOut}
        label={
          isSigningOut
            ? "Cerrando sesión…"
            : error
              ? "Reintentar cierre de sesión"
              : "Cambiar de rol"
        }
        onPress={() => void signOut()}
      />
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
