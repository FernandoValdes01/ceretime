import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import type { InternAccompaniment } from "../../application/intern-accompaniment-models";
import { mobileDependencies } from "../../composition/mobile-dependencies";
import { AppHeader } from "../components/app-header";
import { StudentText } from "../estudiante/student-text";
import { useInternAccompaniment } from "../hooks/use-intern-accompaniment";
import { InternAssignmentGuard } from "../navigation/intern-assignment-guard";
import { useNavigationSession } from "../navigation/session";
import { InternAccessDeniedNotice } from "./intern-access-denied-notice";
import { InternAccompanimentStatusBadge } from "./intern-accompaniment-status-badge";
import { firstRouteParam } from "@/presentation/navigation/route-params";

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

function DetailCard({ accompaniment }: { readonly accompaniment: InternAccompaniment }) {
  return (
    <View style={styles.detailCard}>
      <View style={styles.detailHeader}>
        <StudentText style={styles.fieldLabel}>Objetivo</StudentText>
        <InternAccompanimentStatusBadge status={accompaniment.status} />
      </View>
      <StudentText selectable style={styles.objective}>
        {accompaniment.objective}
      </StudentText>
    </View>
  );
}

export function InternAccompanimentDetailContent({
  status,
  data,
  error,
  reload,
  onBack,
}: ReturnType<typeof useInternAccompaniment> & { readonly onBack: () => void }) {
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
      <InternAccessDeniedNotice
        message="No puedes acceder a este acompañamiento."
        onBack={onBack}
      />
    );
  }

  return data ? <DetailCard accompaniment={data} /> : null;
}

function AssignedInternAccompanimentDetail() {
  const { session } = useNavigationSession();
  const params = useLocalSearchParams<{ accompanimentId?: string | string[] }>();
  const accompanimentId = firstRouteParam(params.accompanimentId);
  const state = useInternAccompaniment(
    mobileDependencies.internAccompanimentReader,
    session?.user.id ?? null,
    accompanimentId,
  );
  const detailHeadingRef = useRef<View>(null);
  const onBack = () => router.replace("/practicante/asignaciones");

  useEffect(() => {
    if (detailHeadingRef.current) {
      AccessibilityInfo.sendAccessibilityEvent(detailHeadingRef.current, "focus");
    }
  }, []);

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "left", "right", "bottom"]}>
      <AppHeader onBack={onBack} />
      <ScrollView contentContainerStyle={styles.content}>
        <View
          ref={detailHeadingRef}
          accessible
          accessibilityLabel="Detalle del acompañamiento"
          accessibilityRole="header"
        >
          <StudentText accessible={false} style={styles.title}>
            Detalle del acompañamiento
          </StudentText>
        </View>
        <InternAccompanimentDetailContent {...state} onBack={onBack} />
      </ScrollView>
    </SafeAreaView>
  );
}

export default function InternAccompanimentDetailScreen() {
  return (
    <InternAssignmentGuard state="assigned">
      <AssignedInternAccompanimentDetail />
    </InternAssignmentGuard>
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
