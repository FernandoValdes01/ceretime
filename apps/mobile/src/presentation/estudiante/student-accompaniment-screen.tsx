import { router, useLocalSearchParams } from "expo-router";
import { View } from "react-native";

import { StudentAction, StudentScreen } from "./student-screen";
import { StudentText } from "./student-text";
import { formatRequestDate } from "./student-request-formatters";
import { useStudentAreaContext } from "./student-area-provider";

const accompanimentStatusLabel = {
  active: "Activo",
  paused: "Pausado",
  closed: "Cerrado",
} as const;

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <View className="gap-1 border-b border-student-border pb-4">
      <StudentText weight="semibold" className="text-student-secondary text-sm leading-[20px]">
        {label}
      </StudentText>
      <StudentText className="text-student-text text-base leading-[26px]" selectable>
        {value}
      </StudentText>
    </View>
  );
}

export default function StudentAccompanimentScreen() {
  const { requestId } = useLocalSearchParams<{ requestId: string }>();
  const { requests, accompaniments } = useStudentAreaContext();
  const request = requests.data.find((item) => item.id === requestId);
  const accompaniment =
    request?.status === "accepted"
      ? accompaniments.data.find((item) => item.requestId === request.id)
      : undefined;

  return (
    <StudentScreen onBack={router.back} showIntroduction={false}>
      {accompaniments.status === "loading" ? (
        <StudentText
          weight="semibold"
          accessibilityRole="header"
          accessibilityLiveRegion="polite"
          className="text-student-text text-xl leading-[28px]"
          selectable
        >
          Cargando acompañamiento…
        </StudentText>
      ) : null}

      {accompaniments.status === "error" ? (
        <View className="gap-4 rounded-xl border border-student-border bg-student-surface p-4">
          <StudentText
            weight="semibold"
            accessibilityRole="header"
            accessibilityLiveRegion="polite"
            className="text-student-text text-xl leading-[28px]"
            selectable
          >
            No pudimos cargar el acompañamiento
          </StudentText>
          <StudentAction label="Reintentar" onPress={accompaniments.reload} />
        </View>
      ) : null}

      {accompaniments.status !== "loading" &&
      accompaniments.status !== "error" &&
      !accompaniment ? (
        <View className="gap-4 rounded-xl border border-student-border bg-student-surface p-4">
          <StudentText
            weight="semibold"
            accessibilityRole="header"
            className="text-student-text text-xl leading-[28px]"
            selectable
          >
            Acompañamiento no disponible
          </StudentText>
          <StudentText className="text-student-secondary text-base leading-[26px]" selectable>
            No hay un acompañamiento para esta solicitud en tu listado.
          </StudentText>
          <StudentAction
            label="Volver a mis solicitudes"
            secondary
            onPress={() => router.replace("/estudiante/solicitudes")}
          />
        </View>
      ) : null}

      {accompaniment ? (
        <View className="gap-4 rounded-xl border border-student-border bg-student-surface p-4">
          <StudentText
            weight="semibold"
            accessibilityRole="header"
            className="text-student-text text-xl leading-[28px]"
            selectable
          >
            Mi acompañamiento
          </StudentText>
          <DetailField label="Referencia" value={accompaniment.id} />
          {accompaniment.requestId ? (
            <DetailField label="Solicitud de origen" value={accompaniment.requestId} />
          ) : null}
          <DetailField label="Estado" value={accompanimentStatusLabel[accompaniment.status]} />
          {accompaniment.createdAt ? (
            <DetailField
              label="Fecha de apertura"
              value={formatRequestDate(accompaniment.createdAt)}
            />
          ) : null}
          <StudentAction label="Volver a la solicitud" secondary onPress={() => router.back()} />
        </View>
      ) : null}
    </StudentScreen>
  );
}
