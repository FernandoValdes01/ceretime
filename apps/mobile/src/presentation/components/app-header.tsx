import { Pressable, StyleSheet, View } from "react-native";

import { StudentText } from "../estudiante/student-text";
import { useOptionalNavigationSession } from "../navigation/session";
import { AppIcon } from "./app-icon";

export function AppHeader({
  onBack,
  title = "CERETI",
}: {
  readonly onBack?: () => void;
  readonly title?: string;
}) {
  const navigationSession = useOptionalNavigationSession();
  const session = navigationSession?.session ?? null;
  const status = navigationSession?.status ?? "unauthenticated";
  const sessionError = navigationSession?.error;
  const initial = session?.user.displayName.slice(0, 1).toUpperCase() ?? "C";
  const isSigningOut = status === "loading";

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        {onBack ? (
          <Pressable
            accessibilityLabel="Volver"
            accessibilityRole="button"
            hitSlop={10}
            onPress={onBack}
            style={styles.backButton}
          >
            <AppIcon
              accessible={false}
              color="#42565B"
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
            style={styles.avatar}
          >
            <StudentText weight="semibold" style={styles.avatarText}>
              {initial}
            </StudentText>
          </View>
          <StudentText weight="bold" style={styles.brand}>
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
            hitSlop={10}
          >
            <AppIcon accessible={false} color="#087D70" name="bell" size={22} strokeWidth={2.1} />
          </Pressable>
          <Pressable
            accessibilityHint="Cierra tu sesión actual"
            accessibilityLabel={isSigningOut ? "Cerrando sesión…" : "Cerrar sesión"}
            accessibilityRole="button"
            accessibilityState={{ disabled: isSigningOut }}
            disabled={isSigningOut}
            hitSlop={10}
            onPress={() => void navigationSession?.signOut()}
            style={styles.logoutButton}
          >
            <AppIcon accessible={false} color="#42565B" name="logOut" size={21} strokeWidth={2.1} />
          </Pressable>
        </View>
      </View>
      {sessionError ? (
        <View accessibilityRole="alert" style={styles.errorBanner}>
          <AppIcon accessible={false} color="#9B5C00" name="alert" size={18} strokeWidth={2.2} />
          <StudentText style={styles.errorText}>{sessionError}</StudentText>
          <Pressable
            accessibilityLabel="Cerrar aviso"
            accessibilityRole="button"
            hitSlop={8}
            onPress={navigationSession?.clearError}
          >
            <AppIcon accessible={false} color="#704336" name="x" size={18} strokeWidth={2} />
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
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
  avatarText: { color: "#704336", fontSize: 15 },
  brand: { color: "#087D70", fontSize: 19, letterSpacing: 1.4 },
  backButton: { width: 32, marginRight: 4 },
  actions: { flexDirection: "row", alignItems: "center", gap: 18 },
  logoutButton: { alignItems: "center", justifyContent: "center" },
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
