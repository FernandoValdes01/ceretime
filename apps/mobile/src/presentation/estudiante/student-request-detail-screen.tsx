import { router, useLocalSearchParams } from "expo-router";
import { View } from "react-native";

import { StudentAction, StudentScreen } from "./student-screen";
import { StudentText } from "./student-text";
import { formatRequestDate } from "./student-request-formatters";
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
  const title =
    requests.status === "loading"
      ? "Cargando solicitud"
      : requests.status === "error"
        ? "No pudimos cargar el detalle"
        : request
          ? "Detalle de solicitud"
          : "Solicitud no encontrada";
  const description =
    requests.status === "loading"
      ? "Estamos preparando la información de tu solicitud."
      : requests.status === "error"
        ? "Ocurrió un problema al consultar esta solicitud. Puedes intentarlo nuevamente."
        : request
          ? "Esta es la información que registraste en tu solicitud."
          : "La solicitud solicitada no está disponible dentro de tus solicitudes.";

  return (
    <StudentScreen title={title} description={description}>
      {requests.status === "loading" ? (
        <View
          className="gap-4 rounded-xl border border-student-border bg-student-surface p-5"
          style={{ borderCurve: "continuous" }}
        >
          <StudentText
            accessibilityLiveRegion="polite"
            className="text-student-secondary text-base leading-[26px]"
            selectable
          >
            Cargando el detalle de tu solicitud.
          </StudentText>
        </View>
      ) : null}

      {requests.status === "error" ? (
        <View
          className="gap-4 rounded-xl border border-student-border bg-student-surface p-5"
          style={{ borderCurve: "continuous" }}
        >
          <StudentText
            accessibilityLiveRegion="polite"
            className="text-student-secondary text-base leading-[26px]"
            selectable
          >
            No pudimos cargar el detalle de tu solicitud.
          </StudentText>
          <StudentAction label="Reintentar" onPress={requests.reload} />
        </View>
      ) : null}

      {requests.status !== "loading" && requests.status !== "error" && !request ? (
        <StudentAction
          label="Volver a mis solicitudes"
          secondary
          onPress={() => router.replace("/estudiante/solicitudes")}
        />
      ) : null}

      {request ? (
        <View
          className="gap-4 rounded-xl border border-student-border bg-student-surface p-5"
          style={{ borderCurve: "continuous" }}
        >
          <DetailField label="Referencia" value={request.id} />
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
            label="Canal accesible preferido"
            value={request.preferredAccessibleInformationChannel}
          />
        </View>
      ) : null}
    </StudentScreen>
  );
}
