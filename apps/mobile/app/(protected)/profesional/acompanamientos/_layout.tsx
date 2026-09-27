import { Stack } from "expo-router";

export default function ProfessionalAccompanimentsLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="[accompanimentId]" />
    </Stack>
  );
}
