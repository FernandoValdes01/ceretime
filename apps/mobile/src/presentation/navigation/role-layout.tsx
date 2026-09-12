import { Stack } from "expo-router";
import type { PropsWithChildren } from "react";

export default function RoleLayout({ children }: PropsWithChildren) {
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: "Inicio", headerBackVisible: false }} />
      {children}
    </Stack>
  );
}
