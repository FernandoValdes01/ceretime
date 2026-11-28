import { View } from "react-native";

import { OperationAnnouncement } from "../accessibility/operation-announcement";
import { useStudentAreaContext } from "./student-area-provider";
import { StudentAction } from "./student-screen";
import { StudentText } from "./student-text";

const message = "No pudimos actualizar. Ves los últimos datos cargados.";

/** Avisa que lo visible puede no estar vigente, sin retirar la pantalla ni lo que se escribe. */
export function StudentRefreshNotice() {
  const { refreshError, retryingRefresh, refresh } = useStudentAreaContext();
  const failed = refreshError !== null;

  return (
    <>
      <OperationAnnouncement message={failed ? message : null} />
      {failed ? (
        <View className="w-full max-w-[600px] self-center gap-2 bg-student-muted px-6 py-3">
          <StudentText className="text-student-text text-base leading-[26px]">
            {message}
          </StudentText>
          <StudentAction
            label={retryingRefresh ? "Actualizando…" : "Reintentar actualización"}
            secondary
            disabled={retryingRefresh}
            onPress={refresh}
          />
        </View>
      ) : null}
    </>
  );
}
