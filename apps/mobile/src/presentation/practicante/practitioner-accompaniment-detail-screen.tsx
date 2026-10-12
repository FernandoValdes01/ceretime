import { router, useLocalSearchParams } from "expo-router";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import type { PractitionerAccompaniment } from "../../application/practitioner-accompaniment-models";
import { mobileDependencies } from "../../composition/mobile-dependencies";
import { AppHeader } from "../components/app-header";
import { StudentText } from "../estudiante/student-text";
import { usePractitionerAccompaniment } from "../hooks/use-practitioner-accompaniment";
import { PractitionerAssignmentGuard } from "../navigation/practitioner-assignment-guard";
import { useNavigationSession } from "../navigation/session";
import { PractitionerAccessDeniedNotice } from "./practitioner-access-denied-notice";
import { PractitionerAccompanimentStatusBadge } from "./practitioner-accompaniment-status-badge";

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
      <StudentText
        accessibilityRole="header"
        accessibilityLiveRegion="polite"
        style={styles.stateTitle}
      >
        {title}
      </StudentText>
      {message ? <StudentText style={styles.stateMessage}>{message}</StudentText> : null}
      {children}
    </View>
  );
}

function DetailCard({ accompaniment }: { readonly accompaniment: PractitionerAccompaniment }) {
  return (
    <View style={styles.detailCard}>
      <View style={styles.detailHeader}>
        <StudentText style={styles.fieldLabel}>Objetivo</StudentText>
        <PractitionerAccompanimentStatusBadge status={accompaniment.status} />
      </View>
      <StudentText selectable style={styles.objective}>
        {accompaniment.objective}
      </StudentText>
    </View>
  );
}

export function PractitionerAccompanimentDetailContent({
  status,
  data,
  error,
  reload,
  onBack,
}: ReturnType<typeof usePractitionerAccompaniment> & { readonly onBack: () => void }) {
  if (status === "loading") {
    return (
      <StateMessage title="Cargando acompañamiento">
        <ActivityIndicator accessible={false} color="#00695B" />
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
          accessibilityRole="button"
          accessibilityLabel="Reintentar carga del acompañamiento"
          onPress={reload}
          style={({ pressed }) => [styles.retry, pressed && styles.pressed]}
        >
          <StudentText style={styles.retryText}>Reintentar</StudentText>
        </Pressable>
      </StateMessage>
    );
  }

  if (status === "access-denied") {
    return (
      <PractitionerAccessDeniedNotice
        message="No puedes acceder a este acompañamiento."
        onBack={onBack}
      />
    );
  }

  return data ? <DetailCard accompaniment={data} /> : null;
}

function AssignedPractitionerAccompanimentDetail() {
  const { session } = useNavigationSession();
  const params = useLocalSearchParams<{ accompanimentId?: string | string[] }>();
  const rawAccompanimentId = params.accompanimentId;
  const accompanimentId = Array.isArray(rawAccompanimentId)
    ? (rawAccompanimentId[0] ?? null)
    : (rawAccompanimentId ?? null);
  const state = usePractitionerAccompaniment(
    mobileDependencies.practitionerAccompanimentReader,
    session?.user.id ?? null,
    accompanimentId,
  );
  const onBack = () => router.replace("/practicante/asignaciones");

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "left", "right", "bottom"]}>
      <AppHeader onBack={onBack} />
      <ScrollView contentContainerStyle={styles.content}>
        <StudentText accessibilityRole="header" style={styles.title}>
          Detalle del acompañamiento
        </StudentText>
        <PractitionerAccompanimentDetailContent {...state} onBack={onBack} />
      </ScrollView>
    </SafeAreaView>
  );
}

export default function PractitionerAccompanimentDetailScreen() {
  return (
    <PractitionerAssignmentGuard state="assigned">
      <AssignedPractitionerAccompanimentDetail />
    </PractitionerAssignmentGuard>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#F7FAF9" },
  content: {
    flexGrow: 1,
    width: "100%",
    maxWidth: 600,
    alignSelf: "center",
    padding: 24,
    gap: 16,
  },
  title: { color: "#182C31", fontSize: 30, fontWeight: "700" },
  stateCard: {
    gap: 12,
    padding: 18,
    borderRadius: 14,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#D7E1DF",
  },
  stateTitle: { color: "#182C31", fontSize: 19, lineHeight: 26, fontWeight: "700" },
  stateMessage: { color: "#42565B", fontSize: 16, lineHeight: 24 },
  detailCard: {
    gap: 16,
    padding: 20,
    borderRadius: 16,
    backgroundColor: "#FFFCFA",
    borderWidth: 1,
    borderColor: "#E7D9D1",
    boxShadow: "0 2px 5px rgba(24, 44, 49, 0.07)",
  },
  detailHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  fieldLabel: { color: "#42565B", fontSize: 14, lineHeight: 20, fontWeight: "700" },
  objective: { color: "#182C31", fontSize: 22, lineHeight: 30, fontWeight: "700" },
  retry: {
    alignSelf: "flex-start",
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  pressed: { opacity: 0.75 },
  retryText: {
    color: "#00695B",
    fontSize: 17,
    fontWeight: "700",
    textDecorationLine: "underline",
  },
});
