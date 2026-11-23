import { Stack } from "expo-router";
import { useMemo } from "react";

import {
  authMode,
  getMobileConvexClient,
  mobileDependencies,
} from "../../../../src/composition/mobile-dependencies";
import { createConvexStudentAreaReader } from "../../../../src/infrastructure/convex-student-area-reader";
import { createConvexStudentRequestSubmitter } from "../../../../src/infrastructure/convex-student-request-submitter";
import { StudentAreaProvider } from "../../../../src/presentation/estudiante/student-area-provider";
import { RoleGuard } from "../../../../src/presentation/navigation/role-guard";
import { useOptionalNavigationSession } from "../../../../src/presentation/navigation/session";

// Con ingreso institucional las solicitudes son las reales de Convex; sin él, la demostración local.
function useStudentAreaAdapters() {
  const user = useOptionalNavigationSession()?.session?.user;
  const userId = user?.id;
  const displayName = user?.displayName;
  const email = user?.email;
  return useMemo(() => {
    if (authMode !== "institutional" || userId === undefined) {
      return {
        reader: mobileDependencies.studentAreaReader,
        actions: mobileDependencies.studentRequestSubmitter.requestActions,
      };
    }
    const client = getMobileConvexClient();
    return {
      reader: createConvexStudentAreaReader({
        client,
        student: { id: userId, displayName: displayName ?? "", email: email ?? "" },
      }),
      actions: createConvexStudentRequestSubmitter({ client }).requestActions,
    };
  }, [userId, displayName, email]);
}

export default function StudentRequestsLayout() {
  const { reader, actions } = useStudentAreaAdapters();

  return (
    <RoleGuard requiredRole="estudiante">
      <StudentAreaProvider reader={reader} actions={actions}>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="[requestId]" options={{ headerShown: false }} />
          <Stack.Screen name="[requestId]/acompanamiento" options={{ headerShown: false }} />
        </Stack>
      </StudentAreaProvider>
    </RoleGuard>
  );
}
