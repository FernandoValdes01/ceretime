import path from "node:path";
import { render } from "@testing-library/react-native";
import { RequestForm } from "../src/presentation/estudiante/request-form";
import { router } from "expo-router";
import { act, fireEvent, renderRouter, screen, waitFor } from "expo-router/testing-library";

const appDirectory = path.resolve(__dirname, "../app");

async function openForm() {
  const navigation = renderRouter(appDirectory);
  fireEvent.press(await screen.findByRole("button", { name: "Entrar como Estudiante" }));
  fireEvent.press(await screen.findByRole("button", { name: "Nueva solicitud" }));
  await screen.findByRole("header", { name: "Solicitud de acompañamiento" });
  return navigation;
}

function fillRequiredFields() {
  fireEvent.changeText(
    screen.getByLabelText("¿Qué necesidad quieres abordar? *"),
    "Me cuesta leer los materiales del curso.",
  );
  fireEvent.changeText(
    screen.getByLabelText("¿Qué esperas de CERETI? *"),
    "Aprender a usar un lector de pantalla.",
  );
  fireEvent.press(screen.getByRole("radio", { name: "En línea" }));
  fireEvent.press(screen.getByRole("checkbox", { name: "Lunes" }));
  fireEvent.changeText(
    screen.getByLabelText("¿Cómo prefieres recibir información? *"),
    "Correo con texto accesible",
  );
}

describe("Formulario de solicitud del estudiante", () => {
  test("solicita mostrar la selección pendiente al revisar modalidad o días", async () => {
    const revealGroup = jest.fn();
    render(<RequestForm onRevealGroup={revealGroup} />);
    fireEvent.changeText(
      screen.getByLabelText("¿Qué necesidad quieres abordar? *"),
      "Leer materiales.",
    );
    fireEvent.changeText(screen.getByLabelText("¿Qué esperas de CERETI? *"), "Usar un lector.");
    fireEvent.changeText(
      screen.getByLabelText("¿Cómo prefieres recibir información? *"),
      "Correo accesible.",
    );
    fireEvent.press(screen.getByRole("button", { name: "Revisar formulario" }));
    await waitFor(() => expect(revealGroup).toHaveBeenCalledTimes(1));
    expect(screen.getByText("Selecciona una modalidad.")).toBeOnTheScreen();
    fireEvent.press(screen.getByRole("radio", { name: "Presencial" }));
    fireEvent.press(screen.getByRole("button", { name: "Revisar formulario" }));
    await waitFor(() => expect(revealGroup).toHaveBeenCalledTimes(2));
    expect(screen.getByText("Selecciona al menos un día.")).toBeOnTheScreen();
    fireEvent.press(screen.getByRole("checkbox", { name: "Lunes" }));
    fireEvent.press(screen.getByRole("button", { name: "Revisar formulario" }));
    expect(
      screen.getByText("Campos revisados. La solicitud todavía no se ha enviado."),
    ).toBeOnTheScreen();
    expect(revealGroup).toHaveBeenCalledTimes(2);
  });
  test("recorre Inicio → Nueva solicitud → Inicio", async () => {
    const navigation = await openForm();
    expect(navigation.getPathname()).toBe("/estudiante/nueva-solicitud");
    await act(async () => router.back());
    expect(await screen.findByText("Inicio de Estudiante")).toBeOnTheScreen();
    expect(navigation.getPathname()).toBe("/estudiante");
  });

  test("muestra errores visibles y permite corregirlos sin perder valores", async () => {
    await openForm();
    fireEvent.changeText(screen.getByLabelText("¿Qué necesidad quieres abordar? *"), "   ");
    fireEvent.press(screen.getByRole("button", { name: "Revisar formulario" }));
    expect(screen.getByText("Describe la necesidad que quieres abordar.")).toBeOnTheScreen();
    expect(screen.getByText("Selecciona una modalidad.")).toBeOnTheScreen();
    expect(screen.getByText("Selecciona al menos un día.")).toBeOnTheScreen();
    fillRequiredFields();
    expect(screen.queryByText("Describe la necesidad que quieres abordar.")).not.toBeOnTheScreen();
    expect(screen.getByDisplayValue("Me cuesta leer los materiales del curso.")).toBeOnTheScreen();
    fireEvent.press(screen.getByRole("button", { name: "Revisar formulario" }));
    expect(
      screen.getByText("Campos revisados. La solicitud todavía no se ha enviado."),
    ).toBeOnTheScreen();
    fireEvent.changeText(screen.getByLabelText("¿Qué esperas de CERETI? *"), "");
    expect(
      screen.queryByText("Campos revisados. La solicitud todavía no se ha enviado."),
    ).not.toBeOnTheScreen();
    expect(screen.getByText("Indica qué esperas del acompañamiento.")).toBeOnTheScreen();
  });

  test("permite varios apoyos y texto libre, sin exigir necesidades de acceso", async () => {
    await openForm();
    fillRequiredFields();
    fireEvent.press(screen.getByRole("button", { name: "Revisar formulario" }));
    expect(
      screen.getByText("Campos revisados. La solicitud todavía no se ha enviado."),
    ).toBeOnTheScreen();
    for (const label of ["Comunicación escrita", "Persona de apoyo"]) {
      fireEvent.press(screen.getByRole("checkbox", { name: label }));
      expect(screen.getByRole("checkbox", { name: label })).toBeChecked();
    }
    fireEvent.press(screen.getByRole("checkbox", { name: "Comunicación escrita" }));
    expect(screen.getByRole("checkbox", { name: "Comunicación escrita" })).not.toBeChecked();
    fireEvent.changeText(
      screen.getByLabelText("Otra necesidad de acceso"),
      "Instrucciones por pasos.",
    );
    fireEvent.press(screen.getByRole("radio", { name: "Presencial" }));
    expect(screen.getByRole("radio", { name: "En línea" })).not.toBeChecked();
    expect(screen.getByDisplayValue("Instrucciones por pasos.")).toBeOnTheScreen();
  });

  test("valida una franja opcional incompleta, inválida o invertida", async () => {
    await openForm();
    fillRequiredFields();
    fireEvent.changeText(screen.getByLabelText("Desde"), "25:00");
    fireEvent.press(screen.getByRole("button", { name: "Revisar formulario" }));
    expect(
      screen.getByText("Escribe la hora inicial en formato HH:MM, por ejemplo 09:00."),
    ).toBeOnTheScreen();
    expect(
      screen.getByText("Escribe la hora final en formato HH:MM, por ejemplo 13:00."),
    ).toBeOnTheScreen();
    fireEvent.changeText(screen.getByLabelText("Desde"), "13:00");
    fireEvent.changeText(screen.getByLabelText("Hasta"), "09:00");
    expect(screen.getByText("La hora final debe ser posterior a la inicial.")).toBeOnTheScreen();
    fireEvent.changeText(screen.getByLabelText("Hasta"), "14:00");
    fireEvent.press(screen.getByRole("button", { name: "Revisar formulario" }));
    expect(
      screen.getByText("Campos revisados. La solicitud todavía no se ha enviado."),
    ).toBeOnTheScreen();
  });

  test("el formulario no conserva el borrador después de cerrar sesión", async () => {
    await openForm();
    fillRequiredFields();
    await act(async () => router.back());
    fireEvent.press(await screen.findByRole("button", { name: "Cambiar de rol" }));
    fireEvent.press(await screen.findByRole("button", { name: "Entrar como Estudiante" }));
    fireEvent.press(await screen.findByRole("button", { name: "Nueva solicitud" }));
    expect(await screen.findByLabelText("¿Qué necesidad quieres abordar? *")).toHaveProp(
      "value",
      "",
    );
  });

  test("un enlace directo sin sesión redirige al acceso", async () => {
    const navigation = renderRouter(appDirectory, {
      initialUrl: "/estudiante/nueva-solicitud",
    });
    expect(await screen.findByText("Explora la aplicación")).toBeOnTheScreen();
    expect(navigation.getPathname()).toBe("/login");
  });

  test.each(["Profesional", "Practicante", "Administrador"])(
    "%s no puede acceder al formulario",
    async (role) => {
      const navigation = renderRouter(appDirectory);
      fireEvent.press(await screen.findByRole("button", { name: `Entrar como ${role}` }));
      await screen.findByText(`Inicio de ${role}`);
      await act(async () => router.push("/estudiante/nueva-solicitud"));
      await waitFor(() => expect(navigation.getPathname()).toBe(`/${role.toLowerCase()}`));
      expect(screen.queryByLabelText("¿Qué necesidad quieres abordar? *")).not.toBeOnTheScreen();
    },
  );
});
