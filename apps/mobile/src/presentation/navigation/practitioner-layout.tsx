import { Stack } from "expo-router";
import { appHeaderOptions } from "./app-header-options";

export default function PractitionerLayout() {
  return <Stack screenOptions={appHeaderOptions} />;
}
