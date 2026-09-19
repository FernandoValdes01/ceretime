import { router, useLocalSearchParams } from "expo-router";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import type {
  ProfessionalRequest,
  ProfessionalRequestAction,
} from "@/application/professional-review-models";
import type { GeneralAvailability } from "@/application/student-area-models";
import { AppIcon } from "@/presentation/components/app-icon";
import { StudentFonts, StudentText } from "@/presentation/estudiante/student-text";
import { formatRequestDate } from "@/presentation/estudiante/student-request-formatters";
import { getStudentRequestStatusPresentation } from "@/presentation/estudiante/student-request-status-indicator";
import { useProfessionalReviewContext } from "./professional-review-provider";
import { ProfessionalHeader } from "./professional-header";

const actionLabels: Record<ProfessionalRequestAction, string> = {
  startReview: "Poner en revisión",
  requestInformation: "Esperar información",
  accept: "Aceptar solicitud",
};

const actionHints: Record<ProfessionalRequestAction, string> = {
  startReview: "Marca esta solicitud como en revisión",
  requestInformation: "Indica que necesitas información para continuar",
  accept: "Acepta la solicitud y abre el acompañamiento",
};

export function ProfessionalRequestDetailScreen() {
  const { requestId } = useLocalSearchParams<{ requestId: string }>();
  const { status, requests, error, reload, performAction, getActionState } =
    useProfessionalReviewContext();
  const request = typeof requestId === "string" ? findRequest(requests, requestId) : undefined;

  return (
    <StudentFonts>
      <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
        <ProfessionalHeader onBack={() => router.back()} />
        <ScrollView contentContainerStyle={styles.content}>
          {status === "loading" ? (
            <View style={styles.stateCard}>
              <StudentText accessibilityRole="header" weight="semibold" style={styles.stateTitle}>
                Cargando solicitud…
              </StudentText>
              <ActivityIndicator accessible={false} color="#087D70" />
            </View>
          ) : null}

          {status === "error" ? (
            <View style={styles.stateCard}>
              <StudentText accessibilityRole="header" weight="semibold" style={styles.stateTitle}>
                No pudimos cargar la solicitud
              </StudentText>
              <StudentText style={styles.stateMessage}>
                {error instanceof Error ? error.message : "Intenta nuevamente."}
              </StudentText>
              <Pressable
                accessibilityLabel="Reintentar carga de solicitud"
                accessibilityRole="button"
                onPress={reload}
                style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed]}
              >
                <StudentText weight="semibold" style={styles.secondaryButtonText}>
                  Reintentar
                </StudentText>
              </Pressable>
            </View>
          ) : null}

          {status !== "loading" && status !== "error" && !request ? (
            <View style={styles.stateCard}>
              <StudentText accessibilityRole="header" weight="semibold" style={styles.stateTitle}>
                Solicitud no encontrada
              </StudentText>
              <StudentText style={styles.stateMessage}>
                No aparece en las solicitudes asignadas.
              </StudentText>
              <Pressable
                accessibilityRole="button"
                onPress={() => router.replace("/profesional/estudiantes")}
                style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed]}
              >
                <StudentText weight="semibold" style={styles.secondaryButtonText}>
                  Volver a solicitudes
                </StudentText>
              </Pressable>
            </View>
          ) : null}

          {request ? (
            <RequestDetail
              request={request}
              onAction={performAction}
              getActionState={getActionState}
            />
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </StudentFonts>
  );
}

function RequestDetail({
  request,
  onAction,
  getActionState,
}: {
  readonly request: ProfessionalRequest;
  readonly onAction: (requestId: string, action: ProfessionalRequestAction) => Promise<void>;
  readonly getActionState: (
    requestId: string,
    action: ProfessionalRequestAction,
  ) => { readonly status: string; readonly message: string | null; readonly error: unknown | null };
}) {
  const statusPresentation = getStudentRequestStatusPresentation(request.status);

  return (
    <View style={styles.detailStack}>
      <View style={styles.introduction}>
        <StudentText accessibilityRole="header" weight="bold" style={styles.title}>
          Detalle de solicitud
        </StudentText>
        <StudentText style={styles.description}>
          Revisa la necesidad y registra el siguiente paso del acompañamiento.
        </StudentText>
      </View>

      <View style={styles.detailCard}>
        <View style={styles.identityRow}>
          <View style={styles.studentAvatar}>
            <StudentText weight="semibold" style={styles.studentAvatarText}>
              {request.studentName.slice(0, 1)}
            </StudentText>
          </View>
          <View style={styles.identityCopy}>
            <StudentText weight="bold" style={styles.studentName}>
              {request.studentName}
            </StudentText>
            <StudentText style={styles.dateText}>
              Recibida el {formatRequestDate(request.createdAt)}
            </StudentText>
          </View>
        </View>

        <View style={styles.statusRow} accessibilityLabel={`Estado: ${statusPresentation.label}`}>
          <AppIcon
            accessible={false}
            color="#087D70"
            name={statusPresentation.icon}
            size={20}
            strokeWidth={2.2}
          />
          <StudentText weight="semibold" style={styles.statusText}>
            {statusPresentation.label}
          </StudentText>
        </View>

        <DetailRow label="Necesidad" value={request.needSummary} />
        <DetailRow label="Resultado esperado" value={request.expectedOutcome} />
        <DetailRow
          label="Necesidades de acceso"
          value={
            request.accessNeeds.length
              ? request.accessNeeds.map((need) => need.label).join(", ")
              : "No registró necesidades específicas."
          }
        />
        <DetailRow
          label="Disponibilidad general"
          value={formatAvailability(request.generalAvailability)}
        />
        <DetailRow
          label="Modalidad preferida"
          value={request.modalityPreference === "online" ? "En línea" : "Presencial"}
        />
        <DetailRow
          label="Medio accesible preferido"
          value={request.preferredAccessibleInformationChannel}
        />
      </View>

      {request.availableActions.length > 0 ? (
        <View style={styles.actionCard}>
          <StudentText accessibilityRole="header" weight="semibold" style={styles.sectionTitle}>
            Siguiente paso
          </StudentText>
          <StudentText style={styles.sectionDescription}>
            Registra una decisión para continuar con esta solicitud.
          </StudentText>
          {request.availableActions.map((action) => {
            const actionState = getActionState(request.id, action);
            const isLoading = actionState.status === "loading";
            return (
              <View key={action} style={styles.actionBlock}>
                <Pressable
                  accessibilityHint={actionHints[action]}
                  accessibilityRole="button"
                  accessibilityState={{ busy: isLoading, disabled: isLoading }}
                  disabled={isLoading}
                  onPress={() => void onAction(request.id, action)}
                  style={[styles.primaryButton, isLoading && styles.primaryButtonLoading]}
                >
                  {isLoading ? (
                    <ActivityIndicator accessible={false} color="#FFFFFF" size="small" />
                  ) : (
                    <StudentText weight="semibold" style={styles.primaryButtonText}>
                      {actionLabels[action]}
                    </StudentText>
                  )}
                </Pressable>
                {actionState.status === "error" ? (
                  <StudentText accessibilityRole="alert" style={styles.errorText}>
                    {actionState.error instanceof Error
                      ? actionState.error.message
                      : "No pudimos actualizar la solicitud."}
                  </StudentText>
                ) : null}
              </View>
            );
          })}
        </View>
      ) : null}

      {request.status === "accepted" && request.accompaniment ? (
        <AccompanimentCard request={request} />
      ) : null}
    </View>
  );
}

function AccompanimentCard({ request }: { readonly request: ProfessionalRequest }) {
  const accompaniment = request.accompaniment;
  if (!accompaniment) return null;

  return (
    <View
      testID="professional-accompaniment-card"
      accessibilityLiveRegion="polite"
      style={styles.accompanimentCard}
    >
      <View style={styles.accompanimentHeading}>
        <View style={styles.successIcon}>
          <AppIcon
            accessible={false}
            color="#087D70"
            name="circleCheck"
            size={22}
            strokeWidth={2.2}
          />
        </View>
        <View style={styles.identityCopy}>
          <StudentText accessibilityRole="header" weight="bold" style={styles.accompanimentTitle}>
            Acompañamiento abierto
          </StudentText>
          <StudentText style={styles.sectionDescription}>
            La solicitud fue aceptada y ya puedes continuar coordinando el apoyo.
          </StudentText>
        </View>
      </View>
      <DetailRow label="Estado" value="Activo" />
      <DetailRow label="Referencia" value={accompaniment.id} />
      <DetailRow label="Creado el" value={formatRequestDate(accompaniment.createdAt)} />
    </View>
  );
}

function DetailRow({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <View style={styles.detailRow}>
      <StudentText weight="semibold" style={styles.detailLabel}>
        {label}
      </StudentText>
      <StudentText selectable style={styles.detailValue}>
        {value}
      </StudentText>
    </View>
  );
}

function findRequest(requests: readonly ProfessionalRequest[], requestId: string) {
  return requests.find((candidate) => candidate.id === requestId);
}

export function formatAvailability({
  preferredWeekdays,
  preferredTimeRange,
}: GeneralAvailability): string {
  const weekdayLabels = [
    "",
    "Lunes",
    "Martes",
    "Miércoles",
    "Jueves",
    "Viernes",
    "Sábado",
    "Domingo",
  ];
  const days = preferredWeekdays
    .map((weekday) => weekdayLabels[weekday] ?? `Día ${weekday}`)
    .filter(Boolean)
    .join(", ");
  const daySummary = days || "Sin días preferidos registrados";

  if (!preferredTimeRange) return daySummary;
  return `${daySummary} · ${preferredTimeRange.from} a ${preferredTimeRange.to}`;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#F7FAF9" },
  content: { flexGrow: 1, paddingHorizontal: 16, paddingBottom: 32 },
  detailStack: { gap: 14 },
  introduction: { paddingTop: 20, paddingBottom: 4, paddingHorizontal: 4, gap: 8 },
  title: { color: "#182C31", fontSize: 30, lineHeight: 36 },
  description: { color: "#42565B", fontSize: 16, lineHeight: 24 },
  detailCard: {
    padding: 16,
    gap: 16,
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
  studentName: { color: "#182C31", fontSize: 19, lineHeight: 24 },
  dateText: { color: "#687A7D", fontSize: 13, lineHeight: 18 },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: "#E8F4F1",
  },
  statusText: { color: "#087D70", fontSize: 14, lineHeight: 19 },
  detailRow: { gap: 4 },
  detailLabel: { color: "#5B6C6E", fontSize: 13, lineHeight: 18 },
  detailValue: { color: "#182C31", fontSize: 16, lineHeight: 23 },
  actionCard: {
    padding: 16,
    gap: 8,
    borderRadius: 16,
    backgroundColor: "#E8F4F1",
  },
  sectionTitle: { color: "#182C31", fontSize: 19, lineHeight: 24 },
  sectionDescription: { color: "#42565B", fontSize: 14, lineHeight: 21 },
  actionBlock: { gap: 8, paddingTop: 4 },
  primaryButton: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: "#087D70",
  },
  primaryButtonLoading: { opacity: 0.8 },
  primaryButtonText: { color: "#FFFFFF", fontSize: 15, lineHeight: 20 },
  buttonPressed: { opacity: 0.78 },
  errorText: { color: "#A33A2B", fontSize: 13, lineHeight: 18 },
  accompanimentCard: {
    padding: 16,
    gap: 14,
    borderWidth: 1,
    borderColor: "#9CCEC4",
    borderRadius: 16,
    backgroundColor: "#FFFFFF",
  },
  accompanimentHeading: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  successIcon: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 19,
    backgroundColor: "#D9F0EB",
  },
  accompanimentTitle: { color: "#087D70", fontSize: 19, lineHeight: 24 },
  stateCard: {
    alignItems: "flex-start",
    gap: 10,
    padding: 18,
    borderWidth: 1,
    borderColor: "#C9D9D6",
    borderRadius: 16,
    backgroundColor: "#FFFFFF",
  },
  stateTitle: { color: "#182C31", fontSize: 19, lineHeight: 24 },
  stateMessage: { color: "#42565B", fontSize: 15, lineHeight: 22 },
  secondaryButton: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
    borderRadius: 10,
    backgroundColor: "#DDEBE8",
  },
  secondaryButtonText: { color: "#087D70", fontSize: 15, lineHeight: 20 },
});
