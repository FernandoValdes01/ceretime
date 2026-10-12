import { useState } from "react";

import { Pressable, StyleSheet, View } from "react-native";

import { getAccessibilityColorPalette } from "../accessibility/accessibility-color-palette";
import { StudentText } from "../estudiante/student-text";
import { useOptionalAccessibilityPreferences } from "../accessibility/accessibility-preferences-provider";
import { useOptionalNavigationSession } from "../navigation/session";
import { AppIcon } from "./app-icon";

export function AppHeader({
  onBack,
  title = "CERETI",
}: {
  readonly onBack?: () => void;
  readonly title?: string;
}) {
  const [focusedControl, setFocusedControl] = useState<string | null>(null);
  const navigationSession = useOptionalNavigationSession();
  const session = navigationSession?.session ?? null;
  const status = navigationSession?.status ?? "unauthenticated";
  const sessionError = navigationSession?.error;
  const initial = session?.user.displayName.slice(0, 1).toUpperCase() ?? "C";
  const isSigningOut = status === "loading";
  const accessibilityPreferences = useOptionalAccessibilityPreferences();
  const textScale = accessibilityPreferences?.effective.textScale ?? 1;
  const isHighContrast = accessibilityPreferences?.effective.highContrast ?? false;
  const colors = getAccessibilityColorPalette(isHighContrast);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { backgroundColor: colors.background }]}>
        {onBack ? (
          <Pressable
            onFocus={() => setFocusedControl("Volver")}
            onBlur={() => setFocusedControl(null)}
            accessibilityLabel="Volver"
            accessibilityRole="button"
            onPress={onBack}
            style={[
              styles.backButton,
              focusedControl === "Volver" && [styles.focused, { outlineColor: colors.focus }],
            ]}
          >
            <AppIcon
              accessible={false}
              color={colors.secondary}
              name="chevronLeft"
              size={26}
              strokeWidth={2.2}
            />
          </Pressable>
        ) : null}
        <View style={styles.identity}>
          <View
            accessible
            accessibilityLabel={`Perfil de ${session?.user.displayName ?? "usuario"}`}
            style={[
              styles.avatar,
              isHighContrast && { backgroundColor: colors.muted, borderColor: colors.text },
              {
                width: 34 * textScale,
                height: 34 * textScale,
                borderRadius: 17 * textScale,
              },
            ]}
          >
            <StudentText
              weight="semibold"
              style={[styles.avatarText, isHighContrast && { color: colors.text }]}
            >
              {initial}
            </StudentText>
          </View>
          <StudentText weight="bold" style={[styles.brand, { color: colors.primary }]}>
            {title}
          </StudentText>
        </View>
        <View style={styles.actions}>
          <Pressable
            accessibilityHint="Las notificaciones estarán disponibles próximamente"
            accessibilityLabel="Notificaciones"
            accessibilityRole="button"
            accessibilityState={{ disabled: true }}
            disabled
            style={styles.logoutButton}
          >
            <AppIcon
              accessible={false}
              color={colors.primary}
              name="bell"
              size={22}
              strokeWidth={2.1}
            />
          </Pressable>
          <Pressable
            onFocus={() => setFocusedControl("logout")}
            onBlur={() => setFocusedControl(null)}
            accessibilityHint="Cierra tu sesión actual"
            accessibilityLabel={isSigningOut ? "Cerrando sesión…" : "Cerrar sesión"}
            accessibilityRole="button"
            accessibilityState={{ disabled: isSigningOut }}
            disabled={isSigningOut}
            onPress={() => void navigationSession?.signOut()}
            style={[
              styles.logoutButton,
              focusedControl === "logout" && [styles.focused, { outlineColor: colors.focus }],
            ]}
          >
            <AppIcon
              accessible={false}
              color={colors.secondary}
              name="logOut"
              size={21}
              strokeWidth={2.1}
            />
          </Pressable>
        </View>
      </View>
      {sessionError ? (
        <View
          accessibilityRole="alert"
          style={[styles.errorBanner, { backgroundColor: colors.errorSurface }]}
        >
          <AppIcon
            accessible={false}
            color={colors.error}
            name="alert"
            size={18}
            strokeWidth={2.2}
          />
          <StudentText style={[styles.errorText, { color: colors.error }]}>
            {sessionError}
          </StudentText>
          <Pressable
            onFocus={() => setFocusedControl("Cerrar aviso")}
            onBlur={() => setFocusedControl(null)}
            accessibilityLabel="Cerrar aviso"
            accessibilityRole="button"
            style={[
              styles.logoutButton,
              focusedControl === "Cerrar aviso" && [styles.focused, { outlineColor: colors.focus }],
            ]}
            onPress={navigationSession?.clearError}
          >
            <AppIcon accessible={false} color={colors.error} name="x" size={18} strokeWidth={2} />
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  focused: { outlineWidth: 3, outlineColor: "#2563EB", borderRadius: 8 },
  container: { backgroundColor: "#F7FAF9" },
  header: {
    minHeight: 68,
    paddingHorizontal: 18,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F7FAF9",
  },
  identity: { flex: 1, flexDirection: "row", alignItems: "center", gap: 9 },
  avatar: {
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 17,
    backgroundColor: "#E9BFA8",
    borderWidth: 2,
    borderColor: "#FFFFFF",
    boxShadow: "0 1px 3px rgba(24, 44, 49, 0.2)",
  },
  avatarText: { color: "#704336", fontSize: 15, lineHeight: 19 },
  brand: { color: "#087D70", flexShrink: 1, fontSize: 19, letterSpacing: 1.4 },
  backButton: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 4,
  },
  actions: { flexDirection: "row", alignItems: "center", gap: 8 },
  logoutButton: { width: 48, height: 48, alignItems: "center", justifyContent: "center" },
  errorBanner: {
    minHeight: 42,
    marginHorizontal: 14,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 10,
    backgroundColor: "#FFF3D8",
  },
  errorText: { flex: 1, color: "#704336", fontSize: 13, lineHeight: 18 },
});
