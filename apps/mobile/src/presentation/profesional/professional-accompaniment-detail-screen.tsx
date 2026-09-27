import { router, useLocalSearchParams } from "expo-router";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import type { ProfessionalAccompaniment } from "@/application/professional-accompaniment-models";
import { mobileDependencies } from "@/composition/mobile-dependencies";
import { StudentFonts, StudentText } from "@/presentation/estudiante/student-text";
import { RoleGuard } from "@/presentation/navigation/role-guard";
import { useProfessionalAccompaniment } from "@/presentation/hooks/use-professional-accompaniment";
import { ProfessionalAccompanimentStatusBadge } from "./professional-accompaniment-status-badge";
import { ProfessionalHeader } from "./professional-header";

function StateMessage({
  title,
  message,
  children,
}: {
  readonly title: string;
  readonly message?: string;
  readonly children?: React.ReactNode;
}) {
  return (
    <View style={styles.stateCard}>
      <StudentText accessibilityRole="header" weight="semibold" style={styles.stateTitle}>
        {title}
      </StudentText>
      {message ? <StudentText style={styles.stateMessage}>{message}</StudentText> : null}
      {children}
    </View>
  );
}

function DetailCard({ accompaniment }: { readonly accompaniment: ProfessionalAccompaniment }) {
  const initial = accompaniment.studentName.slice(0, 1).toUpperCase();

  return (
    <View style={styles.detailCard}>
      <View style={styles.identityRow}>
        <View style={styles.studentAvatar}>
          <StudentText weight="semibold" style={styles.studentAvatarText}>
            {initial}
          </StudentText>
        </View>
        <View style={styles.identityCopy}>
          <StudentText weight="bold" style={styles.studentName}>
            {accompaniment.studentName}
          </StudentText>
        </View>
        <ProfessionalAccompanimentStatusBadge status={accompaniment.status} />
      </View>

      <View style={styles.divider} />

      <View style={styles.objectiveSection}>
        <StudentText weight="semibold" style={styles.fieldLabel}>
          Objetivo
        </StudentText>
        <StudentText selectable weight="semibold" style={styles.objective}>
          {accompaniment.objective}
        </StudentText>
      </View>
    </View>
  );
}

export function ProfessionalAccompanimentDetailContent({
  status,
  data,
  error,
  reload,
  onBack,
}: ReturnType<typeof useProfessionalAccompaniment> & { readonly onBack: () => void }) {
  if (status === "loading") {
    return (
      <StateMessage title="Cargando acompañamiento…">
        <ActivityIndicator accessible={false} color="#087D70" />
      </StateMessage>
    );
  }

  if (status === "error") {
    return (
      <StateMessage
        title="No pudimos cargar el acompañamiento"
        message={error instanceof Error ? error.message : "Intenta nuevamente."}
      >
        <Pressable
          accessibilityLabel="Reintentar carga del acompañamiento"
          accessibilityRole="button"
          onPress={reload}
          style={({ pressed }) => [styles.retryButton, pressed && styles.buttonPressed]}
        >
          <StudentText weight="semibold" style={styles.retryText}>
            Reintentar
          </StudentText>
        </Pressable>
      </StateMessage>
    );
  }

  if (status === "access-denied") {
    return (
      <StateMessage title="Acceso denegado" message="No puedes acceder a este acompañamiento.">
        <Pressable
          accessibilityRole="button"
          onPress={onBack}
          style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed]}
        >
          <StudentText weight="semibold" style={styles.secondaryButtonText}>
            Volver a acompañamientos
          </StudentText>
        </Pressable>
      </StateMessage>
    );
  }

  return data ? <DetailCard accompaniment={data} /> : null;
}

function ProfessionalAccompanimentDetailRouteContent() {
  const params = useLocalSearchParams<{ accompanimentId?: string | string[] }>();
  const rawAccompanimentId = params.accompanimentId;
  const accompanimentId = Array.isArray(rawAccompanimentId)
    ? (rawAccompanimentId[0] ?? null)
    : (rawAccompanimentId ?? null);
  const state = useProfessionalAccompaniment(
    mobileDependencies.professionalAccompanimentReader,
    accompanimentId,
  );
  const onBack = () => router.back();

  return (
    <StudentFonts>
      <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
        <ProfessionalHeader onBack={onBack} />
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.introduction}>
            <StudentText accessibilityRole="header" weight="bold" style={styles.title}>
              Detalle del acompañamiento
            </StudentText>
          </View>
          <ProfessionalAccompanimentDetailContent {...state} onBack={onBack} />
        </ScrollView>
      </SafeAreaView>
    </StudentFonts>
  );
}

export function ProfessionalAccompanimentDetailScreen() {
  return (
    <RoleGuard requiredRole="profesional">
      <ProfessionalAccompanimentDetailRouteContent />
    </RoleGuard>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#F7FAF9" },
  content: { flexGrow: 1, paddingHorizontal: 16, paddingBottom: 96 },
  introduction: { paddingTop: 20, paddingBottom: 18, paddingHorizontal: 4 },
  title: { color: "#182C31", fontSize: 30, lineHeight: 36 },
  detailCard: {
    gap: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: "#C9D9D6",
    borderRadius: 16,
    backgroundColor: "#FFFFFF",
    boxShadow: "0 2px 5px rgba(24, 44, 49, 0.08)",
  },
  identityRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  studentAvatar: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 22,
    backgroundColor: "#E9BFA8",
  },
  studentAvatarText: { color: "#704336", fontSize: 18 },
  identityCopy: { flex: 1, gap: 2 },
  studentName: { color: "#182C31", fontSize: 18, lineHeight: 23 },
  divider: { height: 1, backgroundColor: "#E2E9E7" },
  objectiveSection: { gap: 8 },
  fieldLabel: { color: "#5B6C6E", fontSize: 14, lineHeight: 20 },
  objective: { color: "#182C31", fontSize: 20, lineHeight: 28 },
  stateCard: {
    alignItems: "flex-start",
    gap: 10,
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
  secondaryButton: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: "#087D70",
    borderRadius: 11,
  },
  secondaryButtonText: { color: "#087D70", fontSize: 15, lineHeight: 20 },
  buttonPressed: { opacity: 0.78 },
});
