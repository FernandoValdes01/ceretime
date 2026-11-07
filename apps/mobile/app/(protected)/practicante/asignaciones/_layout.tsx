import { Stack } from "expo-router";

export default function InternAssignmentsLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="[accompanimentId]" options={{ headerShown: false }} />
    </Stack>
  );
}
