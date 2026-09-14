import { Stack } from "expo-router";

import { createMockStudentAreaReader } from "../../../../src/infrastructure/mock-student-area-reader";
import { StudentAreaProvider } from "../../../../src/presentation/estudiante/student-area-provider";
import { appHeaderOptions } from "../../../../src/presentation/navigation/app-header-options";

const demoMode = process.env.EXPO_PUBLIC_STUDENT_AREA_DEMO_MODE;
const parsedDelay = Number.parseInt(process.env.EXPO_PUBLIC_STUDENT_AREA_DELAY_MS ?? "0", 10);
const demoDelay = Number.isFinite(parsedDelay) && parsedDelay > 0 ? parsedDelay : 0;
const defaultReader = createMockStudentAreaReader({
  delayMs: demoDelay,
  mode: demoMode === "empty" || demoMode === "error" ? demoMode : "success",
});

export default function StudentRequestsLayout() {
  return (
    <StudentAreaProvider reader={defaultReader}>
      <Stack screenOptions={appHeaderOptions}>
        <Stack.Screen
          name="index"
          options={{ ...appHeaderOptions, headerTitle: "Mis solicitudes", headerBackVisible: true }}
        />
        <Stack.Screen
          name="[requestId]"
          options={{
            ...appHeaderOptions,
            headerTitle: "Detalle de solicitud",
            headerBackVisible: true,
          }}
        />
      </Stack>
    </StudentAreaProvider>
  );
}
