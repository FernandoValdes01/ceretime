import path from "node:path";
import { render } from "@testing-library/react-native";
import type {
  StudentRequestSubmissionReceipt,
  SubmitStudentRequestCommand,
} from "@/application/student-area-models";
import type { StudentRequestSubmitter } from "@/application/student-area-port";
import { createMockStudentRequestSubmitter } from "@/infrastructure/mock-student-request-submitter";
import { RequestForm } from "@/presentation/estudiante/request-form";
import { router } from "expo-router";
import { act, fireEvent, renderRouter, screen, waitFor } from "expo-router/testing-library";
import { fillRequiredStudentRequestFields } from "./student-request-test-helpers";

const appDirectory = path.resolve(__dirname, "../app");

const testReceipt: StudentRequestSubmissionReceipt = {
  requestId: "SOL-DEMO-TEST",
  receivedAt: "2026-09-10T12:00:00.000Z",
};

const successfulSubmitter: StudentRequestSubmitter = {
  submitStudentRequest: async () => testReceipt,
};

async function openForm() {
  const navigation = renderRouter(appDirectory);
  fireEvent.press(await screen.findByRole("button", { name: "Entrar como Estudiante" }));
  fireEvent.press(await screen.findByRole("button", { name: "Nueva solicitud" }));
  await screen.findByRole("header", { name: "Solicitud de acompañamiento" });
  return navigation;
}

describe("Formulario de solicitud del estudiante", () => {
  test("solicita mostrar la selección pendiente al revisar modalidad o días", async () => {
    const revealGroup = jest.fn();
    render(<RequestForm submitter={successfulSubmitter} onRevealGroup={revealGroup} />);
    fireEvent.changeText(
      screen.getByLabelText("¿Qué necesidad quieres abordar? *"),
      "Leer materiales.",
    );
    fireEvent.changeText(screen.getByLabelText("¿Qué esperas de CERETI? *"), "Usar un lector.");
    fireEvent.changeText(
      screen.getByLabelText("¿Cómo prefieres recibir información? *"),
      "Correo accesible.",
    );
    fireEvent.press(screen.getByRole("button", { name: "Enviar solicitud" }));
    await waitFor(() => expect(revealGroup).toHaveBeenCalledTimes(1));
    expect(screen.getByText("Selecciona una modalidad.")).toBeOnTheScreen();
    fireEvent.press(screen.getByRole("radio", { name: "Presencial" }));
    fireEvent.press(screen.getByRole("button", { name: "Enviar solicitud" }));
    await waitFor(() => expect(revealGroup).toHaveBeenCalledTimes(2));
    expect(screen.getByText("Selecciona al menos un día.")).toBeOnTheScreen();
    expect(
      screen.getByText("Hay campos por revisar. Corrige los mensajes indicados arriba."),
    ).toHaveProp("selectable", true);
    fireEvent.press(screen.getByRole("checkbox", { name: "Lunes" }));
    fireEvent.press(screen.getByRole("button", { name: "Enviar solicitud" }));
    expect(await screen.findByText("Solicitud enviada")).toBeOnTheScreen();
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
    fireEvent.press(screen.getByRole("button", { name: "Enviar solicitud" }));
    expect(screen.getByText("Describe la necesidad que quieres abordar.")).toBeOnTheScreen();
    expect(screen.getByText("Selecciona una modalidad.")).toBeOnTheScreen();
    expect(screen.getByText("Selecciona al menos un día.")).toBeOnTheScreen();
    fillRequiredStudentRequestFields();
    expect(screen.queryByText("Describe la necesidad que quieres abordar.")).not.toBeOnTheScreen();
    expect(screen.getByDisplayValue("Me cuesta leer los materiales del curso.")).toBeOnTheScreen();
    fireEvent.changeText(screen.getByLabelText("¿Qué esperas de CERETI? *"), "");
    expect(screen.getByText("Indica qué esperas del acompañamiento.")).toBeOnTheScreen();
  });

  test("permite varios apoyos y texto libre, sin exigir necesidades de acceso", async () => {
    await openForm();
    fillRequiredStudentRequestFields();
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
    fillRequiredStudentRequestFields();
    fireEvent.changeText(screen.getByLabelText("Desde"), "25:00");
    fireEvent.press(screen.getByRole("button", { name: "Enviar solicitud" }));
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
    expect(
      screen.queryByText("La hora final debe ser posterior a la inicial."),
    ).not.toBeOnTheScreen();
  });

  test("envía la solicitud ficticia y muestra su comprobante", async () => {
    await openForm();
    fillRequiredStudentRequestFields();

    fireEvent.press(screen.getByRole("button", { name: "Enviar solicitud" }));

    expect(screen.getByRole("button", { name: "Enviando solicitud…" })).toBeDisabled();
    expect(await screen.findByText("Solicitud enviada")).toBeOnTheScreen();
    expect(screen.getByText(/^Referencia: SOL-DEMO-/)).toBeOnTheScreen();
    expect(screen.getByTestId("request-confirmation")).toHaveProp("entering");
    expect(screen.getByTestId("request-confirmation-card")).toHaveStyle({
      borderCurve: "continuous",
    });
  });

  test("conserva los datos después de un error y vuelve a enviar el mismo comando", async () => {
    const commands: SubmitStudentRequestCommand[] = [];
    let attempts = 0;
    const submitter: StudentRequestSubmitter = {
      async submitStudentRequest(command) {
        commands.push(command);
        attempts += 1;
        if (attempts === 1) throw new Error("Falla controlada");
        return testReceipt;
      },
    };
    render(<RequestForm submitter={submitter} onRevealGroup={() => undefined} />);
    fillRequiredStudentRequestFields();
    fireEvent.press(screen.getByRole("checkbox", { name: "Persona de apoyo" }));

    fireEvent.press(screen.getByRole("button", { name: "Enviar solicitud" }));

    expect(await screen.findByText("No pudimos enviar la solicitud ficticia.")).toBeOnTheScreen();
    expect(screen.getByTestId("submission-error")).toHaveProp("entering");
    expect(screen.getByTestId("submission-error")).toHaveStyle({ borderCurve: "continuous" });
    expect(screen.getByDisplayValue("Me cuesta leer los materiales del curso.")).toBeOnTheScreen();
    fireEvent.press(screen.getByRole("button", { name: "Reintentar envío" }));

    expect(await screen.findByText("Solicitud enviada")).toBeOnTheScreen();
    expect(commands).toHaveLength(2);
    expect(commands[1]).toEqual(commands[0]);
    expect(commands[0]).toMatchObject({
      needSummary: "Me cuesta leer los materiales del curso.",
      expectedOutcome: "Aprender a usar un lector de pantalla.",
      modalityPreference: "online",
      accessNeeds: [{ id: "support-person", label: "Persona de apoyo" }],
      generalAvailability: { preferredWeekdays: [1] },
      preferredAccessibleInformationChannel: "Correo con texto accesible",
    });
  });

  test("impide iniciar dos envíos mientras el primero sigue pendiente", async () => {
    let resolveSubmission!: (receipt: StudentRequestSubmissionReceipt) => void;
    const pending = new Promise<StudentRequestSubmissionReceipt>((resolve) => {
      resolveSubmission = resolve;
    });
    const submitStudentRequest = jest.fn(() => pending);
    render(<RequestForm submitter={{ submitStudentRequest }} onRevealGroup={() => undefined} />);
    fillRequiredStudentRequestFields();
    const action = screen.getByRole("button", { name: "Enviar solicitud" });

    fireEvent.press(action);
    fireEvent.press(action);

    expect(submitStudentRequest).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Enviando solicitud…" })).toBeDisabled();
    await act(async () => resolveSubmission(testReceipt));
    expect(await screen.findByText("Solicitud enviada")).toBeOnTheScreen();
  });

  test("el formulario no conserva el borrador después de cerrar sesión", async () => {
    await openForm();
    fillRequiredStudentRequestFields();
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

describe("Adaptador mock de envío", () => {
  test("falla una vez y confirma el reintento cuando se configura fail-once", async () => {
    const submitter = createMockStudentRequestSubmitter({
      delayMs: 0,
      failureMode: "once",
      now: () => new Date("2026-09-10T12:00:00.000Z"),
    });
    const command: SubmitStudentRequestCommand = {
      needSummary: "Acceder al material del curso.",
      expectedOutcome: "Leer el contenido con tecnología de apoyo.",
      accessNeeds: [{ id: "written-communication", label: "Comunicación escrita" }],
      generalAvailability: { preferredWeekdays: [1] },
      modalityPreference: "online",
      preferredAccessibleInformationChannel: "Correo con texto accesible",
    };

    await expect(submitter.submitStudentRequest(command)).rejects.toThrow(
      "Falla simulada del envío",
    );
    await expect(submitter.submitStudentRequest(command)).resolves.toEqual({
      requestId: "SOL-DEMO-001",
      receivedAt: "2026-09-10T12:00:00.000Z",
    });
  });
});
