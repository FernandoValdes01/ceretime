import { Stack } from "expo-router";

import { createMockStudentAreaReader } from "../../../../src/infrastructure/mock-student-area-reader";
import { StudentAreaProvider } from "../../../../src/presentation/estudiante/student-area-provider";

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
      <Stack>
        <Stack.Screen name="index" options={{ title: "Mis solicitudes" }} />
        <Stack.Screen name="[requestId]" options={{ title: "Detalle de solicitud" }} />
      </Stack>
    </StudentAreaProvider>
  );
}
