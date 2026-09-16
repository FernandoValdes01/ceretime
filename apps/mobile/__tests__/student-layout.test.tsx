import {
  studentLayoutScreenOptions,
  studentRequestScreenOptions,
} from "@/presentation/navigation/student-layout";

test("mantiene visible el header de las pantallas del estudiante", () => {
  expect(studentLayoutScreenOptions).toMatchObject({
    headerShown: true,
    headerTitle: "CERETIME",
    headerBackVisible: false,
  });
});

test("habilita el retorno nativo en nueva solicitud sin título duplicado", () => {
  expect(studentRequestScreenOptions).toMatchObject({
    headerShown: true,
    headerTitle: "CERETIME",
    headerBackTitle: "Volver",
    headerBackButtonDisplayMode: "minimal",
    headerBackVisible: true,
  });
});
