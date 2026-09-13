import { router } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";

import type { StudentRequest } from "@/application/student-area-models";
import { StudentAction, StudentScreen } from "./student-screen";
import { StudentText } from "./student-text";
import { useStudentAreaContext } from "./student-area-provider";
import { formatRequestDate } from "./student-request-formatters";

function StateMessage({
  title,
  message,
  children,
}: {
  title: string;
  message?: string;
  children?: React.ReactNode;
}) {
  return (
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
        {title}
      </StudentText>
      {message ? (
        <StudentText className="text-student-secondary text-base leading-[26px]" selectable>
          {message}
        </StudentText>
      ) : null}
      {children}
    </View>
  );
}

function RequestCard({ request }: { request: StudentRequest }) {
  const createdAt = formatRequestDate(request.createdAt);
  const [isFocused, setIsFocused] = useState(false);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Solicitud enviada el ${createdAt}. ${request.needSummary}`}
      accessibilityHint="Abre el detalle"
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
      onPress={() =>
        router.push({
          pathname: "/estudiante/solicitudes/[requestId]",
          params: { requestId: request.id },
        })
      }
      className="gap-3 rounded-xl border border-student-border bg-student-surface p-4 active:opacity-75"
      style={[
        { borderCurve: "continuous" },
        isFocused ? { outlineColor: "#2563eb", outlineStyle: "solid", outlineWidth: 3 } : undefined,
      ]}
    >
      <View className="gap-1">
        <StudentText className="text-student-secondary text-sm leading-[20px]" selectable>
          Enviada el {createdAt}
        </StudentText>
      </View>
      <StudentText
        weight="semibold"
        className="text-student-text text-xl leading-[28px]"
        selectable
      >
        {request.needSummary}
      </StudentText>
      <StudentText className="text-student-secondary text-base leading-[26px]" selectable>
        Ver detalle
      </StudentText>
    </Pressable>
  );
}

export default function StudentRequestsScreen() {
  const { requests } = useStudentAreaContext();

  return (
    <StudentScreen showIntroduction={false}>
      {requests.status === "loading" ? (
        <StateMessage title="Cargando solicitudes…">
          <ActivityIndicator accessible={false} color="#00695b" />
        </StateMessage>
      ) : null}

      {requests.status === "error" ? (
        <StateMessage title="No pudimos cargar tus solicitudes">
          <StudentAction label="Reintentar" onPress={requests.reload} />
        </StateMessage>
      ) : null}

      {requests.status === "empty" ? (
        <StateMessage
          title="Aún no tienes solicitudes"
          message="Cuando envíes una solicitud de acompañamiento, aparecerá aquí."
        >
          <StudentAction
            label="Crear nueva solicitud"
            onPress={() => router.push("/estudiante/nueva-solicitud")}
          />
        </StateMessage>
      ) : null}

      {requests.status === "success" ? (
        <View className="gap-4">
          {requests.data.map((request) => (
            <RequestCard key={request.id} request={request} />
          ))}
        </View>
      ) : null}
    </StudentScreen>
  );
}
