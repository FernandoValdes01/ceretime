import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import type { ReactNode } from "react";

import type {
  PractitionerAccompaniment,
  PractitionerAccompanimentStatus,
} from "../../application/practitioner-accompaniment-models";
import { mobileDependencies } from "../../composition/mobile-dependencies";
import { RoleHome } from "../components/role-home";
import { usePractitionerAccompaniments } from "../hooks/use-practitioner-accompaniments";
import { PractitionerAssignmentGuard } from "../navigation/practitioner-assignment-guard";
import { useNavigationSession } from "../navigation/session";

const statusLabels: Record<PractitionerAccompanimentStatus, string> = {
  active: "Activo",
  paused: "En pausa",
  closed: "Cerrado",
};

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
      <Text accessibilityRole="header" accessibilityLiveRegion="polite" style={styles.stateTitle}>
        {title}
      </Text>
      {message ? <Text style={styles.stateMessage}>{message}</Text> : null}
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
    <View
      accessible
      accessibilityLabel={`Acompañamiento: ${accompaniment.objective}`}
      style={[styles.surface, styles.card]}
    >
      <Text accessibilityRole="header" style={styles.cardTitle}>
        {accompaniment.objective}
      </Text>
      <View style={styles.statusRow}>
        <Text style={styles.statusLabel}>Estado</Text>
        <Text style={styles.statusValue}>{statusLabels[accompaniment.status]}</Text>
      </View>
    </View>
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
          <Text style={styles.retryText}>Reintentar</Text>
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
    <RoleHome
      title="Acompañamientos asignados"
      description="Consulta sólo los acompañamientos que un profesional te asignó. Esta sección es de sólo lectura."
    >
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
  list: { gap: 16 },
  surface: {
    padding: 18,
    borderRadius: 14,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#D7E1DF",
  },
  card: {
    gap: 14,
  },
  cardTitle: { color: "#182C31", fontSize: 19, lineHeight: 26, fontWeight: "700" },
  statusRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  statusLabel: { color: "#42565B", fontSize: 16 },
  statusValue: { color: "#246259", fontSize: 16, fontWeight: "700" },
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
