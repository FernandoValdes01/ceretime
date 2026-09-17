import { appHeaderOptions } from "@/presentation/navigation/app-header-options";

test("expone un header nativo común para todas las vistas", () => {
  expect(appHeaderOptions).toMatchObject({
    headerShown: true,
    headerTitle: "CERETIME",
    headerBackTitle: "Volver",
    headerBackButtonDisplayMode: "minimal",
    headerBackVisible: false,
    headerTintColor: "#246259",
    headerShadowVisible: false,
  });
});
