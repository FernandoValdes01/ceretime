import { router } from "expo-router";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import type { ProfessionalRequest } from "@/application/professional-review-models";
import type { StudentRequestStatus } from "@/application/student-area-models";
import { AppIcon } from "@/presentation/components/app-icon";
import { StudentFonts, StudentText } from "@/presentation/estudiante/student-text";
import { formatRequestDate } from "@/presentation/estudiante/student-request-formatters";
import { getStudentRequestStatusPresentation } from "@/presentation/estudiante/student-request-status-indicator";
import { RoleGuard } from "@/presentation/navigation/role-guard";
import { useProfessionalReviewContext } from "./professional-review-provider";
import { ProfessionalHeader } from "./professional-header";

const noActionMessages = {
  received: "No hay acciones disponibles para esta solicitud.",
  underReview: "No hay acciones disponibles para esta solicitud.",
  awaitingInformationOrAcceptance: "Esperando información o aceptación del estudiante.",
  accepted: "Solicitud aceptada; el acompañamiento puede continuar.",
  referred: "Solicitud derivada; queda pendiente del contacto y aceptación del estudiante.",
  closedWithoutAccompaniment: "Solicitud cerrada sin acompañamiento.",
  cancelled: "Solicitud cancelada.",
} satisfies Record<StudentRequestStatus, string>;

export function getNoActionMessage(status: StudentRequestStatus): string {
  return noActionMessages[status];
}

function ReviewState({
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
        <Pressable
          accessibilityRole="button"
          onPress={action.onPress}
          style={({ pressed }) => [styles.retryButton, pressed && styles.buttonPressed]}
        >
          <StudentText weight="semibold" style={styles.retryText}>
            {action.label}
          </StudentText>
        </Pressable>
      ) : null}
    </View>
  );
}

function StatusBadge({ status }: Pick<ProfessionalRequest, "status">) {
  const presentation = getStudentRequestStatusPresentation(status);

  return (
    <View
      style={styles.statusBadge}
      accessible
      accessibilityLabel={`Estado: ${presentation.label}`}
    >
      <AppIcon
        accessible={false}
        color="#087D70"
        name={presentation.icon}
        size={16}
        strokeWidth={2.2}
      />
      <StudentText weight="semibold" style={styles.statusText}>
        {presentation.label}
      </StudentText>
    </View>
  );
}

function RequestCard({
  request,
  onOpen,
}: {
  readonly request: ProfessionalRequest;
  readonly onOpen: () => void;
}) {
  return (
    <View style={styles.requestCard}>
      <View style={styles.cardTopRow}>
        <View style={styles.cardIdentity}>
          <View style={styles.studentAvatar}>
            <StudentText weight="semibold" style={styles.studentAvatarText}>
              {request.studentName.slice(0, 1)}
            </StudentText>
          </View>
          <View style={styles.cardIdentityCopy}>
            <StudentText weight="semibold" style={styles.studentName}>
              {request.studentName}
            </StudentText>
            <StudentText style={styles.dateText}>
              Recibida el {formatRequestDate(request.createdAt)}
            </StudentText>
          </View>
        </View>
        <StatusBadge status={request.status} />
      </View>

      <View style={styles.divider} />
      <StudentText weight="semibold" style={styles.requestTitle}>
        {request.needSummary}
      </StudentText>
      <StudentText style={styles.requestDescription}>{request.expectedOutcome}</StudentText>
      <Pressable
        accessibilityHint="Abre el detalle de la solicitud"
        accessibilityLabel={`Solicitud de ${request.studentName}: ${request.needSummary}`}
        accessibilityRole="button"
        onPress={onOpen}
        style={styles.cardInteraction}
      />
    </View>
  );
}

export function ProfessionalRequestsScreen() {
  const { status, requests, error, reload } = useProfessionalReviewContext();

  return (
    <RoleGuard requiredRole="profesional">
      <StudentFonts>
        <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
          <ProfessionalHeader />
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.content}
            contentInsetAdjustmentBehavior="automatic"
          >
            <View style={styles.introduction}>
              <StudentText accessibilityRole="header" weight="bold" style={styles.title}>
                Solicitudes
              </StudentText>
              <StudentText style={styles.description}>
                Revisa las solicitudes asignadas y registra el siguiente paso.
              </StudentText>
            </View>

            {status === "loading" ? (
              <ReviewState title="Cargando solicitudes…">
                <ActivityIndicator accessible={false} color="#087D70" />
              </ReviewState>
            ) : null}
            {status === "error" ? (
              <ReviewState
                title="No pudimos cargar las solicitudes"
                message={error instanceof Error ? error.message : "Intenta nuevamente."}
                action={{ label: "Reintentar", onPress: reload }}
              />
            ) : null}
            {status === "empty" ? (
              <ReviewState
                title="No tienes solicitudes pendientes"
                message="Cuando CERETI te asigne una solicitud, aparecerá aquí."
              />
            ) : null}
            {status === "success" ? (
              <View style={styles.requestList}>
                <StudentText weight="semibold" style={styles.sectionTitle}>
                  Solicitudes asignadas
                </StudentText>
                {requests.map((request) => (
                  <RequestCard
                    key={request.id}
                    request={request}
                    onOpen={() =>
                      router.push({
                        pathname: "/profesional/estudiantes/[requestId]",
                        params: { requestId: request.id },
                      })
                    }
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
  scroll: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: 16, paddingBottom: 96 },
  introduction: { paddingTop: 20, paddingBottom: 18, paddingHorizontal: 4, gap: 8 },
  title: { color: "#182C31", fontSize: 30, lineHeight: 36 },
  description: { color: "#42565B", fontSize: 16, lineHeight: 24 },
  requestList: { gap: 12 },
  sectionTitle: { color: "#182C31", fontSize: 18, lineHeight: 24, marginBottom: 2 },
  requestCard: {
    position: "relative",
    padding: 16,
    gap: 10,
    borderWidth: 1,
    borderColor: "#C9D9D6",
    borderRadius: 16,
    backgroundColor: "#FFFFFF",
    boxShadow: "0 2px 5px rgba(24, 44, 49, 0.08)",
  },
  cardTopRow: {
    flexDirection: "column",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 10,
  },
  cardIdentity: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10 },
  studentAvatar: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 19,
    backgroundColor: "#E9BFA8",
  },
  studentAvatarText: { color: "#704336", fontSize: 16 },
  cardIdentityCopy: { flex: 1, gap: 2 },
  studentName: { color: "#182C31", fontSize: 16, lineHeight: 21 },
  dateText: { color: "#687A7D", fontSize: 12, lineHeight: 17 },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 10,
    backgroundColor: "#E8F4F1",
  },
  statusText: { color: "#087D70", fontSize: 12, lineHeight: 16 },
  divider: { height: 1, backgroundColor: "#E2E9E7" },
  requestTitle: { color: "#182C31", fontSize: 17, lineHeight: 23 },
  requestDescription: { color: "#42565B", fontSize: 14, lineHeight: 21 },
  cardInteraction: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderRadius: 16,
  },
  buttonPressed: { opacity: 0.78 },
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
});
