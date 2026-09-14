import {
  studentLayoutScreenOptions,
  studentRequestScreenOptions,
} from "@/presentation/navigation/student-layout";

test("mantiene ocultos los headers del área de estudiante por defecto", () => {
  expect(studentLayoutScreenOptions).toMatchObject({ headerShown: false });
});

test("muestra sólo el header nativo de nueva solicitud con retorno y sin título duplicado", () => {
  expect(studentRequestScreenOptions).toMatchObject({
    headerShown: true,
    headerTitle: "",
    headerBackTitle: "Volver",
    headerBackButtonDisplayMode: "minimal",
    headerBackVisible: true,
  });
});
