import { Stack } from "expo-router";

import RoleLayout from "../../../src/presentation/navigation/role-layout";
import { appHeaderOptions } from "../../../src/presentation/navigation/app-header-options";

export default function StudentLayout() {
  return (
    <RoleLayout>
      <Stack.Screen
        name="nueva-solicitud"
        options={{ ...appHeaderOptions, headerBackVisible: true }}
      />
      <Stack.Screen name="solicitudes" options={{ headerShown: false }} />
    </RoleLayout>
  );
}
