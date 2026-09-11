import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";

import type { StudentAreaSnapshot } from "../../application/student-area-models";
import type { StudentAreaReader } from "../../application/student-area-port";

interface StudentAreaExampleProps {
  readonly studentArea: StudentAreaSnapshot;
}

/** Isolated presentational example; it receives a projection, not storage data. */
export function StudentAreaExample({ studentArea }: StudentAreaExampleProps) {
  const request = studentArea.requests[0];
  const accompaniment = studentArea.accompaniments.find((item) => item.requestId === request?.id);

  return (
    <View style={styles.content}>
      <Text style={styles.title}>Hola, {studentArea.student.displayName}</Text>
      <Text style={styles.caption}>Rol provisional: {studentArea.student.role}</Text>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Solicitud de acompañamiento</Text>
        <Text>{request?.needSummary ?? "Sin solicitudes registradas."}</Text>
        <Text style={styles.muted}>Estado: {request?.status ?? "no disponible"}</Text>
      </View>
      {accompaniment ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Acompañamiento</Text>
          <Text style={styles.muted}>Estado: {accompaniment.status}</Text>
        </View>
      ) : null}
    </View>
  );
}

/**
 * Isolated composition example: Presentation consumes the Application port,
 * then passes only the projection to the visual component. It is deliberately
 * not connected to App.tsx; a caller can inject either the mock or a future
 * TI2-backed adapter without changing StudentAreaExample.
 */
export async function renderStudentAreaExample(reader: StudentAreaReader): Promise<ReactElement> {
  const studentArea = await reader.readStudentArea();
  return <StudentAreaExample studentArea={studentArea} />;
}

const styles = StyleSheet.create({
  content: { gap: 12, padding: 24 },
  title: { color: "#102a43", fontSize: 26, fontWeight: "700" },
  caption: { color: "#52606d" },
  card: { backgroundColor: "#f0f4f8", borderRadius: 12, gap: 6, padding: 16 },
  cardTitle: { color: "#102a43", fontSize: 17, fontWeight: "700" },
  muted: { color: "#52606d", fontSize: 13 },
});
