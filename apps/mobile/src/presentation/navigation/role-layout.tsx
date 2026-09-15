import { Stack } from "expo-router";
import type { PropsWithChildren } from "react";
import { appHeaderOptions } from "./app-header-options";

export default function RoleLayout({ children }: PropsWithChildren) {
  return (
    <Stack screenOptions={appHeaderOptions}>
      <Stack.Screen name="index" />
      {children}
    </Stack>
  );
}
