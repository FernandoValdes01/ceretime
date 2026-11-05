import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, StyleSheet, View } from "react-native";

import type { AuthCredentials } from "../../application/auth-models";
import { useAccessibilityColors } from "../accessibility/accessibility-preferences-provider";
import { Action, Screen } from "../components/screen";
import { StudentText } from "../estudiante/student-text";
import { roles } from "../navigation/roles";
import { useNavigationSession } from "../navigation/session";

export function LoginScreen({
  unassignedInternCredentials,
  onResetDemo,
}: {
  readonly unassignedInternCredentials: AuthCredentials;
  readonly onResetDemo?: () => void;
}) {
  const { signIn, selectRole, status, error } = useNavigationSession();
  const isLoading = status === "loading";
  const colors = useAccessibilityColors();
  const errorRef = useRef<View>(null);
  const [reset, setReset] = useState(false);

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
      description="Demostración local con datos ficticios. Selecciona un rol para continuar; los cambios se comparten en este dispositivo y no se envían a CERETI."
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
          onPress={() => void signIn(unassignedInternCredentials)}
        />
        {onResetDemo ? (
          <>
            <Action
              label="Reiniciar demostración"
              disabled={isLoading}
              onPress={() => {
                onResetDemo();
                setReset(true);
              }}
            />
            {reset ? (
              <StudentText accessibilityLiveRegion="polite" style={{ color: colors.text }}>
                Demostración reiniciada. Puedes comenzar de nuevo.
              </StudentText>
            ) : null}
          </>
        ) : null}
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
