import { router } from "expo-router";
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
  message: string;
  children?: React.ReactNode;
}) {
  return (
    <View
      className="gap-4 rounded-xl border border-student-border bg-student-surface p-5"
      style={{ borderCurve: "continuous" }}
    >
      <StudentText
        weight="semibold"
        accessibilityRole="header"
        className="text-student-text text-xl leading-[28px]"
        selectable
      >
        {title}
      </StudentText>
      <StudentText
        accessibilityLiveRegion="polite"
        className="text-student-secondary text-base leading-[26px]"
        selectable
      >
        {message}
      </StudentText>
      {children}
    </View>
  );
}

function RequestCard({ request }: { request: StudentRequest }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Abrir solicitud ${request.id}`}
      accessibilityHint="Muestra el detalle de esta solicitud"
      onPress={() =>
        router.push({
          pathname: "/estudiante/solicitudes/[requestId]",
          params: { requestId: request.id },
        })
      }
      className="gap-3 rounded-xl border border-student-border bg-student-surface p-5 active:opacity-75 focus:border-student-focus"
      style={{ borderCurve: "continuous" }}
    >
      <View className="flex-row items-center justify-between gap-3">
        <StudentText
          weight="semibold"
          className="text-student-primary text-lg leading-[25px]"
          selectable
        >
          {request.id}
        </StudentText>
        <StudentText className="text-student-secondary text-sm leading-[20px]" selectable>
          {formatRequestDate(request.createdAt)}
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
        Ver detalle de la solicitud
      </StudentText>
    </Pressable>
  );
}

export default function StudentRequestsScreen() {
  const { requests } = useStudentAreaContext();

  return (
    <StudentScreen
      title="Mis solicitudes"
      description="Revisa las solicitudes de acompañamiento que has enviado a CERETI."
    >
      {requests.status === "loading" ? (
        <StateMessage
          title="Cargando solicitudes"
          message="Estamos preparando tus solicitudes de prueba."
        >
          <ActivityIndicator accessibilityLabel="Cargando solicitudes" color="#00695b" />
        </StateMessage>
      ) : null}

      {requests.status === "error" ? (
        <StateMessage
          title="No pudimos cargar tus solicitudes"
          message="Ocurrió un problema al consultar tus solicitudes. Puedes intentarlo nuevamente."
        >
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
