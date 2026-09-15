import type { NativeStackNavigationOptions } from "expo-router";

export const appHeaderOptions = {
  headerShown: true,
  headerTitle: "CERETIME",
  headerBackTitle: "Volver",
  headerBackButtonDisplayMode: "minimal",
  headerBackVisible: false,
  headerTintColor: "#246259",
  headerStyle: { backgroundColor: "#F5F7F8" },
  headerShadowVisible: false,
} satisfies NativeStackNavigationOptions;
