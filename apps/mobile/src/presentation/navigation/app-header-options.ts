// Cabecera nativa común de las pilas de pantallas; cada pila decide si muestra el botón de volver.
import type { NativeStackNavigationOptions } from "expo-router";

export const appHeaderOptions = {
  headerShown: true,
  headerTitle: "CERETI",
  headerBackTitle: "Volver",
  headerBackButtonDisplayMode: "minimal",
  headerBackVisible: false,
  headerTintColor: "#246259",
  headerStyle: { backgroundColor: "#F5F7F8" },
  headerShadowVisible: false,
} satisfies NativeStackNavigationOptions;
