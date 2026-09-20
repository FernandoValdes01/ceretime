import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import type { PractitionerAccount } from "@/application/administrator-account-models";
import { AppHeader } from "@/presentation/components/app-header";
import { AppIcon } from "@/presentation/components/app-icon";
import { StudentFonts, StudentText } from "@/presentation/estudiante/student-text";
import type { AccountEnablementState } from "@/presentation/hooks/use-administrator-accounts";
import { RoleGuard } from "@/presentation/navigation/role-guard";
import { useAdministratorAccountsContext } from "./administrator-accounts-provider";

function messageFrom(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function AccountCard({
  account,
  enablement,
  onEnable,
}: {
  readonly account: PractitionerAccount;
  readonly enablement: AccountEnablementState;
  readonly onEnable: () => void;
}) {
  const isEnabled = account.status === "enabled";
  const isLoading = enablement.status === "loading";

  return (
    <View style={styles.accountCard}>
      <View style={styles.accountHeading}>
        <View style={styles.avatar}>
          <StudentText weight="semibold" style={styles.avatarText}>
            {account.displayName.slice(0, 1)}
          </StudentText>
        </View>
        <View style={styles.accountIdentity}>
          <StudentText weight="semibold" style={styles.accountName}>
            {account.displayName}
          </StudentText>
          <StudentText style={styles.accountEmail}>{account.email}</StudentText>
        </View>
      </View>

      <View
        accessibilityLabel={isEnabled ? "Estado: Cuenta habilitada" : "Estado: Pendiente"}
        style={[styles.statusBadge, isEnabled && styles.enabledBadge]}
      >
        <AppIcon
          accessible={false}
          color={isEnabled ? "#087D70" : "#704336"}
          name={isEnabled ? "circleCheck" : "clock"}
          size={17}
        />
        <StudentText
          weight="semibold"
          style={[styles.statusText, isEnabled && styles.enabledStatusText]}
        >
          {isEnabled ? "Cuenta habilitada" : "Pendiente"}
        </StudentText>
      </View>

      {enablement.status === "success" && enablement.message ? (
        <View accessibilityLiveRegion="polite" style={styles.successMessage}>
          <StudentText style={styles.successText}>{enablement.message}</StudentText>
        </View>
      ) : null}
      {enablement.status === "error" ? (
        <View
          accessible
          accessibilityLiveRegion="assertive"
          accessibilityRole="alert"
          style={styles.errorMessage}
        >
          <StudentText style={styles.errorText}>
            {messageFrom(enablement.error, "No pudimos habilitar la cuenta.")}
          </StudentText>
        </View>
      ) : null}

      {!isEnabled ? (
        <Pressable
          accessibilityHint="Habilita el acceso institucional, sin asignar acompañamientos"
          accessibilityLabel={`Habilitar cuenta de ${account.displayName}`}
          accessibilityRole="button"
          accessibilityState={{ disabled: isLoading }}
          disabled={isLoading}
          onPress={onEnable}
          style={({ pressed }) => [
            styles.enableButton,
            pressed && styles.buttonPressed,
            isLoading && styles.buttonDisabled,
          ]}
        >
          {isLoading ? <ActivityIndicator accessible={false} color="#FFFFFF" /> : null}
          <StudentText weight="semibold" style={styles.enableButtonText}>
            {isLoading ? "Habilitando…" : "Habilitar cuenta"}
          </StudentText>
        </Pressable>
      ) : null}
    </View>
  );
}

export function AdministratorUsersScreen() {
  const { status, accounts, error, reload, enableAccount, getEnablementState } =
    useAdministratorAccountsContext();

  return (
    <RoleGuard requiredRole="administrador">
      <StudentFonts>
        <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
          <AppHeader />
          <ScrollView contentContainerStyle={styles.content}>
            <View style={styles.introduction}>
              <StudentText accessibilityRole="header" weight="bold" style={styles.title}>
                Habilitación de cuentas
              </StudentText>
              <StudentText style={styles.description}>
                Revisa las cuentas institucionales de Practicantes antes de habilitarlas.
              </StudentText>
            </View>

            <View style={styles.permissionNotice}>
              <AppIcon accessible={false} color="#704336" name="info" size={20} />
              <StudentText style={styles.permissionText}>
                Habilitar una cuenta permite entrar al área de gestión. No concede acceso a
                acompañamientos.
              </StudentText>
            </View>

            {status === "loading" ? (
              <View style={styles.stateCard}>
                <ActivityIndicator accessible={false} color="#087D70" />
                <StudentText weight="semibold" style={styles.stateTitle}>
                  Cargando cuentas…
                </StudentText>
              </View>
            ) : null}
            {status === "error" ? (
              <View style={styles.stateCard}>
                <StudentText accessibilityRole="header" weight="semibold" style={styles.stateTitle}>
                  No pudimos cargar las cuentas
                </StudentText>
                <StudentText style={styles.stateMessage}>
                  {messageFrom(error, "Intenta nuevamente.")}
                </StudentText>
                <Pressable
                  accessibilityRole="button"
                  onPress={reload}
                  style={({ pressed }) => [styles.retryButton, pressed && styles.buttonPressed]}
                >
                  <StudentText weight="semibold" style={styles.retryText}>
                    Reintentar
                  </StudentText>
                </Pressable>
              </View>
            ) : null}
            {status === "empty" ? (
              <View style={styles.stateCard}>
                <StudentText accessibilityRole="header" weight="semibold" style={styles.stateTitle}>
                  No hay cuentas pendientes
                </StudentText>
                <StudentText style={styles.stateMessage}>
                  Las nuevas cuentas institucionales aparecerán aquí.
                </StudentText>
              </View>
            ) : null}
            {status === "success" ? (
              <View style={styles.accountList}>
                <StudentText weight="semibold" style={styles.sectionTitle}>
                  Cuentas de Practicantes
                </StudentText>
                {accounts.map((account) => (
                  <AccountCard
                    key={account.id}
                    account={account}
                    enablement={getEnablementState(account.id)}
                    onEnable={() => void enableAccount(account.id)}
                  />
                ))}
              </View>
            ) : null}
          </ScrollView>
        </SafeAreaView>
      </StudentFonts>
    </RoleGuard>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#F7FAF9" },
  content: { flexGrow: 1, paddingHorizontal: 16, paddingBottom: 96 },
  introduction: { paddingTop: 20, paddingBottom: 18, paddingHorizontal: 4, gap: 8 },
  title: { color: "#182C31", fontSize: 30, lineHeight: 36 },
  description: { color: "#42565B", fontSize: 16, lineHeight: 24 },
  permissionNotice: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    padding: 16,
    borderWidth: 1,
    borderColor: "#E9BFA8",
    borderRadius: 14,
    backgroundColor: "#FFF3D8",
  },
  permissionText: { flex: 1, color: "#704336", fontSize: 14, lineHeight: 21 },
  accountList: { gap: 12, marginTop: 18 },
  sectionTitle: { color: "#182C31", fontSize: 18, lineHeight: 24, marginHorizontal: 4 },
  accountCard: {
    gap: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: "#C9D9D6",
    borderRadius: 16,
    backgroundColor: "#FFFFFF",
    boxShadow: "0 2px 5px rgba(24, 44, 49, 0.08)",
  },
  accountHeading: { flexDirection: "row", alignItems: "center", gap: 10 },
  avatar: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 20,
    backgroundColor: "#E9BFA8",
  },
  avatarText: { color: "#704336", fontSize: 17 },
  accountIdentity: { flex: 1, gap: 2 },
  accountName: { color: "#182C31", fontSize: 17, lineHeight: 22 },
  accountEmail: { color: "#687A7D", fontSize: 13, lineHeight: 18 },
  statusBadge: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: "#FFF3D8",
  },
  enabledBadge: { backgroundColor: "#E8F4F1" },
  statusText: { color: "#704336", fontSize: 13, lineHeight: 17 },
  enabledStatusText: { color: "#087D70" },
  enableButton: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 12,
    backgroundColor: "#087D70",
  },
  enableButtonText: { color: "#FFFFFF", fontSize: 16, lineHeight: 21 },
  buttonPressed: { opacity: 0.78 },
  buttonDisabled: { opacity: 0.62 },
  successMessage: { padding: 11, borderRadius: 10, backgroundColor: "#E8F4F1" },
  successText: { color: "#087D70", fontSize: 14, lineHeight: 20 },
  errorMessage: { padding: 11, borderRadius: 10, backgroundColor: "#FFF3D8" },
  errorText: { color: "#704336", fontSize: 14, lineHeight: 20 },
  stateCard: {
    alignItems: "flex-start",
    gap: 10,
    marginTop: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: "#C9D9D6",
    borderRadius: 16,
    backgroundColor: "#FFFFFF",
  },
  stateTitle: { color: "#182C31", fontSize: 18, lineHeight: 24 },
  stateMessage: { color: "#42565B", fontSize: 15, lineHeight: 22 },
  retryButton: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    borderRadius: 11,
    backgroundColor: "#087D70",
  },
  retryText: { color: "#FFFFFF", fontSize: 15, lineHeight: 20 },
});
