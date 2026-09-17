import { router, useLocalSearchParams } from "expo-router";
import { View } from "react-native";

import { StudentAction, StudentScreen } from "./student-screen";
import { StudentText } from "./student-text";
import { formatRequestDate } from "./student-request-formatters";
import { StudentRequestStatusIndicator } from "./student-request-status-indicator";
import { useStudentAreaContext } from "./student-area-provider";

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <View className="gap-1 border-b border-student-border pb-4">
      <StudentText
        weight="semibold"
        className="text-student-secondary text-sm leading-[20px]"
        selectable
      >
        {label}
      </StudentText>
      <StudentText className="text-student-text text-base leading-[26px]" selectable>
        {value}
      </StudentText>
    </View>
  );
}

export default function StudentRequestDetailScreen() {
  const { requestId } = useLocalSearchParams<{ requestId: string }>();
  const { requests } = useStudentAreaContext();
  const request = requests.data.find((item) => item.id === requestId);

  return (
    <StudentScreen showIntroduction={false}>
      {requests.status === "loading" ? (
        <View
          className="gap-4 rounded-xl border border-student-border bg-student-surface p-4"
          style={{ borderCurve: "continuous" }}
        >
          <StudentText
            weight="semibold"
            accessibilityRole="header"
            accessibilityLiveRegion="polite"
            className="text-student-text text-xl leading-[28px]"
            selectable
          >
            Cargando solicitud…
          </StudentText>
        </View>
      ) : null}

      {requests.status === "error" ? (
        <View
          className="gap-4 rounded-xl border border-student-border bg-student-surface p-4"
          style={{ borderCurve: "continuous" }}
        >
          <StudentText
            weight="semibold"
            accessibilityRole="header"
            accessibilityLiveRegion="polite"
            className="text-student-text text-xl leading-[28px]"
            selectable
          >
            No pudimos cargar la solicitud
          </StudentText>
          <StudentAction label="Reintentar" onPress={requests.reload} />
        </View>
      ) : null}

      {requests.status !== "loading" && requests.status !== "error" && !request ? (
        <View
          className="gap-4 rounded-xl border border-student-border bg-student-surface p-4"
          style={{ borderCurve: "continuous" }}
        >
          <StudentText
            weight="semibold"
            accessibilityRole="header"
            className="text-student-text text-xl leading-[28px]"
            selectable
          >
            Solicitud no encontrada
          </StudentText>
          <StudentText className="text-student-secondary text-base leading-[26px]" selectable>
            No aparece en tu listado.
          </StudentText>
          <StudentAction
            label="Volver a mis solicitudes"
            secondary
            onPress={() => router.replace("/estudiante/solicitudes")}
          />
        </View>
      ) : null}

      {request ? (
        <View
          className="gap-4 rounded-xl border border-student-border bg-student-surface p-4"
          style={{ borderCurve: "continuous" }}
        >
          <DetailField label="Referencia" value={request.id} />
          <StudentRequestStatusIndicator status={request.status} />
          <DetailField label="Fecha de envío" value={formatRequestDate(request.createdAt)} />
          <DetailField label="Última actualización" value={formatRequestDate(request.updatedAt)} />
          <DetailField label="Necesidad" value={request.needSummary} />
          <DetailField label="Resultado esperado" value={request.expectedOutcome} />
          <DetailField
            label="Necesidades de acceso"
            value={
              request.accessNeeds.length
                ? request.accessNeeds.map((need) => need.label).join(", ")
                : "No registraste necesidades específicas."
            }
          />
          <DetailField
            label="Modalidad preferida"
            value={request.modalityPreference === "online" ? "En línea" : "Presencial"}
          />
          <DetailField
            label="Medio preferido para recibir información"
            value={request.preferredAccessibleInformationChannel}
          />
        </View>
      ) : null}
    </StudentScreen>
  );
}
