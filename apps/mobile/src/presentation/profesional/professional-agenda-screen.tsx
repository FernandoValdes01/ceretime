import { router } from "expo-router";
import { useMemo } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import type {
  ProfessionalAgendaEvent,
  ProfessionalAgendaEventColor,
} from "@/application/professional-agenda-models";
import { AppIcon } from "@/presentation/components/app-icon";
import { AccessDeniedNotice } from "@/presentation/components/role-home";
import { StudentFonts, StudentText } from "@/presentation/estudiante/student-text";
import { useNavigationSession } from "@/presentation/navigation/session";
import { useProfessionalAgendaContext } from "./professional-agenda-provider";
import { ProfessionalHeader } from "./professional-header";

const eventColors: Record<ProfessionalAgendaEventColor, string> = {
  teal: "#078B7B",
  ochre: "#A88A00",
  green: "#61BE43",
};

function AgendaState({
  title,
  message,
  action,
  children,
}: {
  readonly title: string;
  readonly message?: string;
  readonly action?: { readonly label: string; readonly onPress: () => void };
  readonly children?: React.ReactNode;
}) {
  return (
    <View style={styles.stateCard}>
      <StudentText accessibilityRole="header" weight="semibold" style={styles.stateTitle}>
        {title}
      </StudentText>
      {message ? <StudentText style={styles.stateMessage}>{message}</StudentText> : null}
      {children}
      {action ? (
        <Pressable accessibilityRole="button" onPress={action.onPress} style={styles.retryButton}>
          <StudentText weight="semibold" style={styles.retryText}>
            {action.label}
          </StudentText>
        </Pressable>
      ) : null}
    </View>
  );
}

function EventCard({ event }: { readonly event: ProfessionalAgendaEvent }) {
  return (
    <Pressable
      accessibilityHint="Abre el detalle de la actividad"
      accessibilityLabel={`${event.studentName}, ${event.title}, ${event.startTime}`}
      accessibilityRole="button"
      onPress={() =>
        router.push({ pathname: "/profesional/[eventId]", params: { eventId: event.id } })
      }
      style={({ pressed }) => [styles.eventCardHitArea, pressed && styles.eventCardPressed]}
    >
      <View style={[styles.eventCard, { borderLeftColor: eventColors[event.color] }]}>
        <View style={styles.cardHeading}>
          <StudentText weight="semibold" style={styles.studentName}>
            {event.studentName}
          </StudentText>
        </View>
        <View style={styles.eventMetaRow}>
          <AppIcon
            accessible={false}
            color="#42565B"
            name="clipboardList"
            size={16}
            strokeWidth={2}
          />
          <StudentText weight="semibold" style={styles.eventMeta}>
            {event.title}
          </StudentText>
        </View>
        <View style={styles.eventMetaRow}>
          <AppIcon
            accessible={false}
            color="#42565B"
            name={event.modality === "online" ? "video" : "mapPin"}
            size={16}
            strokeWidth={2}
          />
          <StudentText style={styles.eventMeta}>{event.location}</StudentText>
        </View>
      </View>
    </Pressable>
  );
}

function Timeline({ events }: { readonly events: readonly ProfessionalAgendaEvent[] }) {
  const orderedEvents = useMemo(
    () => [...events].sort((left, right) => left.startTime.localeCompare(right.startTime)),
    [events],
  );

  return (
    <View style={styles.timeline}>
      <View pointerEvents="none" style={styles.timelineLine} />
      {orderedEvents.map((event, index) => (
        <View key={event.id}>
          <View style={styles.timelineRow}>
            <View style={styles.timeColumn}>
              <StudentText weight="semibold" style={styles.timeText}>
                {event.startTime}
              </StudentText>
              <StudentText style={styles.amText}>AM</StudentText>
            </View>
            <View style={styles.markerColumn}>
              <View style={[styles.marker, { backgroundColor: eventColors[event.color] }]} />
            </View>
            <View style={styles.cardColumn}>
              <EventCard event={event} />
            </View>
          </View>
          {index === 1 ? (
            <View style={styles.lunchRow}>
              <View style={styles.timeColumn}>
                <StudentText style={styles.lunchTime}>13:00</StudentText>
              </View>
              <View style={styles.markerColumn} />
              <View style={styles.cardColumn}>
                <StudentText style={styles.lunchLabel}>Almuerzo</StudentText>
              </View>
            </View>
          ) : null}
        </View>
      ))}
    </View>
  );
}

export function ProfessionalAgendaScreen() {
  const { status, data, events, error, reload } = useProfessionalAgendaContext();
  const { accessDeniedRole, dismissAccessDenied } = useNavigationSession();

  return (
    <StudentFonts>
      <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
        <ProfessionalHeader />
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          contentInsetAdjustmentBehavior="automatic"
          keyboardShouldPersistTaps="handled"
        >
          {accessDeniedRole ? (
            <AccessDeniedNotice role={accessDeniedRole} onDismiss={dismissAccessDenied} />
          ) : null}
          {status === "loading" ? (
            <AgendaState title="Cargando agenda…">
              <ActivityIndicator accessible={false} color="#078B7B" />
            </AgendaState>
          ) : null}
          {status === "error" ? (
            <AgendaState
              title="No pudimos cargar la agenda"
              message={error instanceof Error ? error.message : "Intenta nuevamente."}
              action={{ label: "Reintentar", onPress: reload }}
            />
          ) : null}
          {status === "empty" ? (
            <AgendaState
              title="No tienes actividades hoy"
              message="Cuando exista una actividad programada, aparecerá aquí."
            />
          ) : null}
          {status === "success" ? <Timeline events={events} /> : null}
        </ScrollView>
        <View style={styles.daySelector}>
          <Pressable
            accessibilityLabel="Día anterior"
            accessibilityRole="button"
            hitSlop={10}
            style={styles.dayArrow}
          >
            <AppIcon
              accessible={false}
              color="#42565B"
              name="chevronLeft"
              size={24}
              strokeWidth={2.2}
            />
          </Pressable>
          <View style={styles.dayCopy}>
            <StudentText accessibilityRole="header" weight="bold" style={styles.dayTitle}>
              {data?.weekdayLabel ?? "Hoy"}
            </StudentText>
            <StudentText style={styles.dateLabel}>
              {data?.dateLabel ?? "Jueves, 24 de Octubre"}
            </StudentText>
          </View>
          <Pressable
            accessibilityLabel="Día siguiente"
            accessibilityRole="button"
            hitSlop={10}
            style={styles.dayArrow}
          >
            <AppIcon
              accessible={false}
              color="#42565B"
              name="chevronRight"
              size={24}
              strokeWidth={2.2}
            />
          </Pressable>
        </View>
      </SafeAreaView>
    </StudentFonts>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#F7FAF9" },
  scroll: { flex: 1 },
  content: { flexGrow: 1, paddingBottom: 96 },
  daySelector: {
    minHeight: 78,
    paddingHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: "#E2E9E7",
    backgroundColor: "#F7FAF9",
  },
  dayArrow: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  dayCopy: { alignItems: "center", gap: 2 },
  dayTitle: { color: "#182C31", fontSize: 23, lineHeight: 28 },
  dateLabel: { color: "#42565B", fontSize: 15, lineHeight: 21 },
  timeline: { paddingTop: 20, paddingHorizontal: 16, paddingBottom: 14 },
  timelineLine: {
    position: "absolute",
    top: 34,
    bottom: 116,
    left: 88.5,
    width: 1,
    backgroundColor: "#D5E0DE",
  },
  timelineRow: { minHeight: 116, flexDirection: "row" },
  timeColumn: { width: 54, paddingTop: 4, alignItems: "flex-end" },
  timeText: { color: "#182C31", fontSize: 15, lineHeight: 20, fontVariant: ["tabular-nums"] },
  amText: { color: "#7B8A8A", fontSize: 11, lineHeight: 15 },
  markerColumn: { width: 37, alignItems: "center", paddingTop: 8 },
  marker: { width: 11, height: 11, borderRadius: 6, borderWidth: 2, borderColor: "#FFFFFF" },
  cardColumn: { flex: 1, paddingLeft: 8 },
  eventCardHitArea: { alignSelf: "stretch" },
  eventCard: {
    minHeight: 102,
    paddingHorizontal: 14,
    paddingVertical: 13,
    gap: 6,
    borderLeftWidth: 4,
    borderWidth: 1,
    borderColor: "#C9D9D6",
    borderRadius: 16,
    backgroundColor: "#FFFFFF",
    elevation: 2,
    boxShadow: "0 2px 5px rgba(24, 44, 49, 0.1)",
  },
  eventCardPressed: { opacity: 0.78 },
  cardHeading: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  studentName: { color: "#182C31", fontSize: 18, lineHeight: 23 },
  eventMetaRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  eventMeta: { flex: 1, color: "#42565B", fontSize: 15, lineHeight: 21 },
  lunchRow: { minHeight: 59, flexDirection: "row", alignItems: "center" },
  lunchTime: { color: "#7B8A8A", fontSize: 11, textAlign: "right" },
  lunchLabel: { color: "#8EA19E", fontSize: 13, textAlign: "center" },
  stateCard: {
    marginHorizontal: 16,
    padding: 20,
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderColor: "#D5E0DE",
    borderRadius: 14,
    backgroundColor: "#FFFFFF",
  },
  stateTitle: { color: "#182C31", fontSize: 19, textAlign: "center" },
  stateMessage: { color: "#5B6C6E", fontSize: 15, lineHeight: 22, textAlign: "center" },
  retryButton: {
    minHeight: 44,
    paddingHorizontal: 18,
    justifyContent: "center",
    borderRadius: 10,
    backgroundColor: "#078B7B",
  },
  retryText: { color: "#FFFFFF", fontSize: 15 },
});
