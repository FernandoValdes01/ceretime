import { fireEvent, screen } from "expo-router/testing-library";

export function fillRequiredStudentRequestFields() {
  fireEvent.changeText(
    screen.getByLabelText("¿Qué necesidad quieres abordar? *", { exact: false }),
    "Me cuesta leer los materiales del curso.",
  );
  fireEvent.changeText(
    screen.getByLabelText("¿Qué esperas de CERETI? *", { exact: false }),
    "Aprender a usar un lector de pantalla.",
  );
  fireEvent.press(screen.getByRole("checkbox", { name: /Comunicación escrita/ }));
  fireEvent.press(screen.getByRole("radio", { name: /En línea/ }));
  fireEvent.press(screen.getByRole("checkbox", { name: /Lunes/ }));
  fireEvent.changeText(
    screen.getByLabelText("¿Cómo prefieres recibir información? *", { exact: false }),
    "Correo con texto accesible",
  );
}
