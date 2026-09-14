import { Stack } from "expo-router";
import { appHeaderOptions } from "../../src/presentation/navigation/app-header-options";

export default function PublicLayout() {
  return <Stack screenOptions={appHeaderOptions} />;
}
