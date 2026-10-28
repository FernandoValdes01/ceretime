import { fireEvent, screen } from "expo-router/testing-library";

export function fillRequiredStudentRequestFields() {
  fillStudentRequestNeed();
  fireEvent.press(screen.getByRole("button", { name: "Continuar" }));
  chooseStudentRequestAccess();
  fireEvent.press(screen.getByRole("button", { name: "Continuar" }));
  chooseStudentRequestAvailability();
  fireEvent.press(screen.getByRole("button", { name: "Continuar" }));
  fillStudentRequestInformationChannel();
  fireEvent.press(screen.getByRole("button", { name: "Continuar" }));
}

export function fillStudentRequestNeed() {
  fireEvent.changeText(
    screen.getByLabelText("¿Qué necesidad quieres abordar? *", { exact: false }),
    "Me cuesta leer los materiales del curso.",
  );
  fireEvent.changeText(
    screen.getByLabelText("¿Qué esperas de CERETI? *", { exact: false }),
    "Aprender a usar un lector de pantalla.",
  );
}

export function chooseStudentRequestAccess() {
  fireEvent.press(screen.getByRole("checkbox", { name: /Comunicación escrita/ }));
}

export function chooseStudentRequestAvailability() {
  fireEvent.press(screen.getByRole("radio", { name: /En línea/ }));
  fireEvent.press(screen.getByRole("checkbox", { name: /Lunes/ }));
}

export function fillStudentRequestInformationChannel() {
  fireEvent.changeText(
    screen.getByLabelText("¿Cómo prefieres recibir información? *", { exact: false }),
    "Correo con texto accesible",
  );
}
