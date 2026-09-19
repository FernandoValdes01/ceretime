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
  const initial = session?.user.displayName.slice(0, 1).toUpperCase() ?? "C";
  const isSigningOut = status === "loading";

  return (
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
        <Pressable accessibilityLabel="Notificaciones" accessibilityRole="button" hitSlop={10}>
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
  );
}

const styles = StyleSheet.create({
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
});
