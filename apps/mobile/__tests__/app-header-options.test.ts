import { appHeaderOptions } from "@/presentation/navigation/app-header-options";

test("usa un header nativo común para las vistas mobile", () => {
  expect(appHeaderOptions).toMatchObject({
    headerShown: true,
    headerTitle: "CERETIME",
    headerBackTitle: "Volver",
    headerBackVisible: false,
    headerTintColor: "#246259",
    headerShadowVisible: false,
  });
});
