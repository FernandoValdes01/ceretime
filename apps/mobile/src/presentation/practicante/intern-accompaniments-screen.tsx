import { router } from "expo-router";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import type { ReactNode } from "react";

import type { InternAccompaniment } from "../../application/intern-accompaniment-models";
import { mobileDependencies } from "../../composition/mobile-dependencies";
import { AppIcon } from "../components/app-icon";
import { RoleHome } from "../components/role-home";
import { StudentText } from "../estudiante/student-text";
import { useInternAccompaniments } from "../hooks/use-intern-accompaniments";
import { InternAssignmentGuard } from "../navigation/intern-assignment-guard";
import { useNavigationSession } from "../navigation/session";
import { InternAccompanimentStatusBadge } from "./intern-accompaniment-status-badge";
import { internAccompanimentStatusLabels } from "./intern-accompaniment-formatters";

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

// El practicante abre el detalle desde su objetivo y consulta el estado en el pie de la tarjeta.
function AccompanimentCard({ accompaniment }: { readonly accompaniment: InternAccompaniment }) {
  const objective = accompaniment.objective.replace(/[.!?]+$/u, "");

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Acompañamiento: ${objective}. Estado: ${internAccompanimentStatusLabels[accompaniment.status]}.`}
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
          <InternAccompanimentStatusBadge accessible={false} status={accompaniment.status} />
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

export function InternAccompanimentsContent({
  status,
  data,
  error,
  reload,
}: ReturnType<typeof useInternAccompaniments>) {
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

function AssignedInternAccompaniments() {
  const { session } = useNavigationSession();
  const state = useInternAccompaniments(
    mobileDependencies.internAccompanimentReader,
    session?.user.id ?? null,
  );

  return (
    <RoleHome title="Acompañamientos asignados">
      <InternAccompanimentsContent {...state} />
    </RoleHome>
  );
}

export default function InternAccompanimentsScreen() {
  return (
    <InternAssignmentGuard state="assigned">
      <AssignedInternAccompaniments />
    </InternAssignmentGuard>
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
