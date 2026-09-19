import { router, useLocalSearchParams } from "expo-router";
import { StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { StudentFonts, StudentText } from "@/presentation/estudiante/student-text";
import { useProfessionalAgendaContext } from "./professional-agenda-provider";
import { ProfessionalHeader } from "./professional-header";

export function ProfessionalAgendaDetailScreen() {
  const { eventId } = useLocalSearchParams<{ eventId: string }>();
  const { status, findEvent } = useProfessionalAgendaContext();
  const event = typeof eventId === "string" ? findEvent(eventId) : null;

  return (
    <StudentFonts>
      <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
        <ProfessionalHeader onBack={() => router.back()} />
        <View style={styles.content}>
          {status === "loading" ? (
            <StudentText style={styles.message}>Cargando actividad…</StudentText>
          ) : event ? (
            <View style={styles.detailCard}>
              <StudentText weight="bold" style={styles.name}>
                {event.studentName}
              </StudentText>
              <StudentText accessibilityRole="header" weight="semibold" style={styles.title}>
                {event.title}
              </StudentText>
              <View style={styles.divider} />
              <DetailRow label="Horario" value={`${event.startTime} - ${event.endTime}`} />
              <DetailRow
                label="Modalidad"
                value={event.modality === "online" ? "En línea" : "Presencial"}
              />
              <DetailRow label="Lugar" value={event.location} />
              <StudentText style={styles.summary}>{event.summary}</StudentText>
            </View>
          ) : (
            <StudentText style={styles.message}>No encontramos esta actividad.</StudentText>
          )}
        </View>
      </SafeAreaView>
    </StudentFonts>
  );
}

function DetailRow({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <View style={styles.detailRow}>
      <StudentText style={styles.label}>{label}</StudentText>
      <StudentText selectable style={styles.value}>
        {value}
      </StudentText>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#F7FAF9" },
  content: { flex: 1, padding: 20 },
  detailCard: {
    padding: 20,
    gap: 12,
    borderRadius: 16,
    backgroundColor: "#FFFFFF",
    boxShadow: "0 2px 5px rgba(24, 44, 49, 0.12)",
  },
  name: { color: "#182C31", fontSize: 24 },
  title: { color: "#087D70", fontSize: 18 },
  divider: { height: 1, backgroundColor: "#D7E1DF" },
  detailRow: { gap: 3 },
  label: { color: "#7B8A8A", fontSize: 13 },
  value: { color: "#182C31", fontSize: 16 },
  summary: { color: "#42565B", fontSize: 16, lineHeight: 24 },
  message: { color: "#5B6C6E", fontSize: 17, textAlign: "center" },
});
