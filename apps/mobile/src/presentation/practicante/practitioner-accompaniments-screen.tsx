import { router } from "expo-router";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import type { ReactNode } from "react";

import type { PractitionerAccompaniment } from "../../application/practitioner-accompaniment-models";
import { mobileDependencies } from "../../composition/mobile-dependencies";
import { AppIcon } from "../components/app-icon";
import { RoleHome } from "../components/role-home";
import { StudentText } from "../estudiante/student-text";
import { usePractitionerAccompaniments } from "../hooks/use-practitioner-accompaniments";
import { PractitionerAssignmentGuard } from "../navigation/practitioner-assignment-guard";
import { useNavigationSession } from "../navigation/session";
import { PractitionerAccompanimentStatusBadge } from "./practitioner-accompaniment-status-badge";

function StateMessage({
  title,
  message,
  children,
}: {
  readonly title: string;
  readonly message?: string;
  readonly children?: ReactNode;
}) {
  return (
    <View style={[styles.surface, styles.stateCard]}>
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

function AccompanimentCard({
  accompaniment,
}: {
  readonly accompaniment: PractitionerAccompaniment;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Acompañamiento: ${accompaniment.objective}`}
      accessibilityHint="Abre el detalle del acompañamiento"
      onPress={() =>
        router.push({
          pathname: "/practicante/asignaciones/[accompanimentId]",
          params: { accompanimentId: accompaniment.id },
        })
      }
      style={({ pressed }) => [styles.cardPressable, pressed && styles.cardPressed]}
    >
      <View style={styles.card}>
        <StudentText accessibilityRole="header" style={styles.cardTitle}>
          {accompaniment.objective}
        </StudentText>
        <View style={styles.cardFooter}>
          <PractitionerAccompanimentStatusBadge status={accompaniment.status} />
          <AppIcon
            accessible={false}
            color="#5B6C6E"
            name="chevronRight"
            size={19}
            strokeWidth={2}
          />
        </View>
      </View>
    </Pressable>
  );
}

export function PractitionerAccompanimentsContent({
  status,
  data,
  error,
  reload,
}: ReturnType<typeof usePractitionerAccompaniments>) {
  if (status === "loading") {
    return (
      <StateMessage title="Cargando acompañamientos asignados">
        <ActivityIndicator accessible={false} color="#00695B" />
      </StateMessage>
    );
  }

  if (status === "error") {
    return (
      <StateMessage
        title="No pudimos cargar tus acompañamientos asignados"
        message={error instanceof Error ? error.message : "Intenta nuevamente."}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Reintentar"
          onPress={reload}
          style={styles.retry}
        >
          <StudentText style={styles.retryText}>Reintentar</StudentText>
        </Pressable>
      </StateMessage>
    );
  }

  if (status === "empty") {
    return (
      <StateMessage
        title="No tienes acompañamientos asignados"
        message="Cuando un profesional te asigne un acompañamiento, aparecerá aquí."
      />
    );
  }

  return (
    <View style={styles.list}>
      {data.map((accompaniment) => (
        <AccompanimentCard key={accompaniment.id} accompaniment={accompaniment} />
      ))}
    </View>
  );
}

function AssignedPractitionerAccompaniments() {
  const { session } = useNavigationSession();
  const state = usePractitionerAccompaniments(
    mobileDependencies.practitionerAccompanimentReader,
    session?.user.id ?? null,
  );

  return (
    <RoleHome title="Acompañamientos asignados">
      <PractitionerAccompanimentsContent {...state} />
    </RoleHome>
  );
}

export default function PractitionerAccompanimentsScreen() {
  return (
    <PractitionerAssignmentGuard state="assigned">
      <AssignedPractitionerAccompaniments />
    </PractitionerAssignmentGuard>
  );
}

const styles = StyleSheet.create({
  list: { gap: 12 },
  surface: {
    padding: 18,
    borderRadius: 14,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#D7E1DF",
  },
  card: {
    gap: 18,
    padding: 18,
    borderRadius: 16,
    backgroundColor: "#FFF8F4",
    borderColor: "#DFC9BE",
    boxShadow: "0 2px 5px rgba(24, 44, 49, 0.07)",
  },
  cardPressable: { borderRadius: 16 },
  cardPressed: { opacity: 0.75 },
  cardTitle: { color: "#182C31", fontSize: 18, lineHeight: 25, fontWeight: "700" },
  cardFooter: {
    minHeight: 24,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: 1,
  },
  stateCard: {
    gap: 12,
  },
  stateTitle: { color: "#182C31", fontSize: 19, lineHeight: 26, fontWeight: "700" },
  stateMessage: { color: "#42565B", fontSize: 16, lineHeight: 24 },
  retry: {
    alignSelf: "flex-start",
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  retryText: {
    color: "#00695B",
    fontSize: 17,
    fontWeight: "700",
    textDecorationLine: "underline",
  },
});
