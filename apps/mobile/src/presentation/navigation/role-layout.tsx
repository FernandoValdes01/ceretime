import { Stack } from "expo-router";
import { appHeaderOptions } from "./app-header-options";

export default function RoleLayout() {
  return <Stack screenOptions={appHeaderOptions} />;
}
