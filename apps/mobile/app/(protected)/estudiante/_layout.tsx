import { Stack } from "expo-router";

import RoleLayout from "../../../src/presentation/navigation/role-layout";

export default function StudentLayout() {
  return (
    <RoleLayout>
      <Stack.Screen name="solicitudes" options={{ headerShown: false }} />
    </RoleLayout>
  );
}
