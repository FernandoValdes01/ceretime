import { Stack } from "expo-router";

import { mobileDependencies } from "../../../../src/composition/mobile-dependencies";
import { StudentAreaProvider } from "../../../../src/presentation/estudiante/student-area-provider";
import { RoleGuard } from "../../../../src/presentation/navigation/role-guard";

export default function StudentRequestsLayout() {
  return (
    <RoleGuard requiredRole="estudiante">
      <StudentAreaProvider reader={mobileDependencies.studentAreaReader}>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="[requestId]" options={{ headerShown: false }} />
          <Stack.Screen name="[requestId]/acompanamiento" options={{ headerShown: false }} />
        </Stack>
      </StudentAreaProvider>
    </RoleGuard>
  );
}
