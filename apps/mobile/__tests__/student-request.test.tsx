import path from "node:path";
import { AccessibilityInfo, Keyboard } from "react-native";
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
import {
  chooseStudentRequestAccess,
  chooseStudentRequestAvailability,
  fillRequiredStudentRequestFields,
  fillStudentRequestInformationChannel,
  fillStudentRequestNeed,
} from "./student-request-test-helpers";

const appDirectory = path.resolve(__dirname, "../app");

afterEach(() => {
  jest.clearAllMocks();
  jest.restoreAllMocks();
});

const testReceipt: StudentRequestSubmissionReceipt = {
  requestId: "SOL-DEMO-TEST",
  receivedAt: "2026-09-10T12:00:00.000Z",
};

const successfulSubmitter: StudentRequestSubmitter = {
  submitStudentRequest: async () => testReceipt,
};

async function openForm() {
  const navigation = renderRouter(appDirectory);
  const loginButton = await screen.findByRole("button", { name: "Entrar como Estudiante" });
  await act(async () => {
    fireEvent.press(loginButton);
    await Promise.resolve();
  });
  await waitFor(() => expect(screen.getByText("Inicio de Estudiante")).toBeOnTheScreen());
  await act(async () => {
    fireEvent.press(screen.getByRole("button", { name: "Nueva solicitud" }));
    await Promise.resolve();
  });
  await waitFor(() =>
    expect(screen.getByRole("header", { name: "Solicitud de acompañamiento" })).toBeOnTheScreen(),
  );
  return navigation;
}

describe("Formulario de solicitud del estudiante", () => {
  test("inicia otra solicitud vacía después de volver al inicio desde el comprobante", async () => {
    await openForm();
    fillRequiredStudentRequestFields();
    fireEvent.press(screen.getByRole("button", { name: "Confirmar y enviar solicitud" }));
    await screen.findByText("Solicitud enviada");
    await act(async () => router.navigate("/estudiante"));
    fireEvent.press(await screen.findByRole("button", { name: "Nueva solicitud" }));
    await waitFor(() =>
      expect(screen.getByLabelText("¿Qué necesidad quieres abordar? *")).toHaveDisplayValue(""),
    );
    expect(screen.getByLabelText("¿Qué esperas de CERETI? *")).toHaveDisplayValue("");
    expect(screen.queryByText("Solicitud enviada")).toBeNull();
  });

  test("conserva el borrador al volver al inicio antes de enviar", async () => {
    await openForm();
    fillStudentRequestNeed();
    await act(async () => router.navigate("/estudiante"));
    fireEvent.press(await screen.findByRole("button", { name: "Nueva solicitud" }));
    await waitFor(() =>
      expect(
        screen.getByDisplayValue("Me cuesta leer los materiales del curso."),
      ).toBeOnTheScreen(),
    );
  });

  test("conserva el comprobante mientras se consultan las preferencias", async () => {
    await openForm();
    fillRequiredStudentRequestFields();
    fireEvent.press(screen.getByRole("button", { name: "Confirmar y enviar solicitud" }));
    await screen.findByText("Solicitud enviada");
    await act(async () => router.push("/preferencias"));
    await screen.findByText("Preferencias de accesibilidad");
    await act(async () => router.back());
    expect(await screen.findByText("Solicitud enviada")).toBeOnTheScreen();
  });

  test.each([
    ["Desde", "Formato HH:MM, por ejemplo 09:00."],
    ["Hasta", "Formato HH:MM, por ejemplo 13:00."],
    [
      "¿Cómo prefieres recibir información? *",
      "Por ejemplo, correo con texto accesible. Describe el medio, sin ingresar tu dirección ni teléfono.",
    ],
  ])("agrupa la etiqueta y ayuda de %s en el campo editable", (label, hint) => {
    render(<RequestForm submitter={successfulSubmitter} onRevealGroup={() => undefined} />);
    fillStudentRequestNeed();
    fireEvent.press(screen.getByRole("button", { name: "Continuar" }));
    chooseStudentRequestAccess();
    fireEvent.press(screen.getByRole("button", { name: "Continuar" }));
    if (label === "¿Cómo prefieres recibir información? *") {
      chooseStudentRequestAvailability();
      fireEvent.press(screen.getByRole("button", { name: "Continuar" }));
    }
    expect(screen.queryByText(label)).toBeNull();
    expect(screen.queryByText(hint)).toBeNull();
    expect(screen.getByText(label, { includeHiddenElements: true })).toBeOnTheScreen();
    expect(screen.getByText(hint, { includeHiddenElements: true })).toBeOnTheScreen();
    const input = screen.getByLabelText(label);
    expect(input).toHaveProp("accessibilityHint", hint);
    const value = label === "¿Cómo prefieres recibir información? *" ? "Correo de prueba" : "09:00";
    fireEvent.changeText(input, value);
    expect(screen.getByDisplayValue(value)).toBeOnTheScreen();
  });
  test("publica el error antes de pedir foco de accesibilidad al primer campo", async () => {
    const namesAtFocus: string[] = [];
    const focusEvent = jest
      .spyOn(AccessibilityInfo, "sendAccessibilityEvent")
      .mockImplementation(() => {
        namesAtFocus.push(
          screen.getByLabelText("¿Qué necesidad quieres abordar? *", { exact: false }).props
            .accessibilityLabel,
        );
      });
    try {
      render(<RequestForm submitter={successfulSubmitter} onRevealGroup={() => undefined} />);
      fireEvent.press(screen.getByRole("button", { name: "Continuar" }));
      await waitFor(() =>
        expect(namesAtFocus).toEqual([
          "¿Qué necesidad quieres abordar? *. Error: Describe la necesidad que quieres abordar.",
        ]),
      );
      expect(focusEvent).toHaveBeenCalledWith(expect.anything(), "focus");
    } finally {
      focusEvent.mockRestore();
    }
  });
  test("expone el error al volver al campo y revela los apoyos pendientes", async () => {
    const revealGroup = jest.fn();
    render(<RequestForm submitter={successfulSubmitter} onRevealGroup={revealGroup} />);
    fireEvent.press(screen.getByRole("button", { name: "Continuar" }));
    expect(
      screen.getByLabelText(
        "¿Qué necesidad quieres abordar? *. Error: Describe la necesidad que quieres abordar.",
      ),
    ).toBeOnTheScreen();
    fireEvent.changeText(
      screen.getByLabelText("¿Qué necesidad quieres abordar? *", { exact: false }),
      "Leer materiales.",
    );
    expect(screen.getByLabelText("¿Qué necesidad quieres abordar? *")).toBeOnTheScreen();
    fireEvent.changeText(
      screen.getByLabelText("¿Qué esperas de CERETI? *", { exact: false }),
      "Usar un lector.",
    );
    fireEvent.press(screen.getByRole("button", { name: "Continuar" }));
    fireEvent.press(screen.getByRole("button", { name: "Continuar" }));
    await waitFor(() => expect(revealGroup).toHaveBeenCalledTimes(1));
    expect(
      screen.getByRole("checkbox", {
        name: "Comunicación escrita. Error: Selecciona o describe una necesidad de acceso.",
      }),
    ).toBeOnTheScreen();
    fireEvent.press(screen.getByRole("checkbox", { name: /Comunicación escrita/ }));
    expect(screen.getByRole("checkbox", { name: "Comunicación escrita" })).toBeChecked();
  });
  test("guía hacia las necesidades y opciones pendientes antes del resumen", async () => {
    const revealGroup = jest.fn();
    render(<RequestForm submitter={successfulSubmitter} onRevealGroup={revealGroup} />);
    fillStudentRequestNeed();
    fireEvent.press(screen.getByRole("button", { name: "Continuar" }));
    fireEvent.press(screen.getByRole("button", { name: "Continuar" }));
    await waitFor(() => expect(revealGroup).toHaveBeenCalledTimes(1));
    expect(screen.getByText("Selecciona o describe una necesidad de acceso.")).toBeOnTheScreen();
    chooseStudentRequestAccess();
    fireEvent.press(screen.getByRole("button", { name: "Continuar" }));
    fireEvent.press(screen.getByRole("button", { name: "Continuar" }));
    await waitFor(() => expect(revealGroup).toHaveBeenCalledTimes(2));
    expect(screen.getByText("Selecciona una modalidad.")).toBeOnTheScreen();
    fireEvent.press(screen.getByRole("radio", { name: /Presencial/ }));
    fireEvent.press(screen.getByRole("button", { name: "Continuar" }));
    await waitFor(() => expect(revealGroup).toHaveBeenCalledTimes(3));
    expect(screen.getByText("Selecciona al menos un día.")).toBeOnTheScreen();
    fireEvent.press(screen.getByRole("checkbox", { name: /Lunes/ }));
    fireEvent.press(screen.getByRole("button", { name: "Continuar" }));
    fillStudentRequestInformationChannel();
    fireEvent.press(screen.getByRole("button", { name: "Continuar" }));
    expect(screen.getByText("Revisa tu solicitud")).toBeOnTheScreen();
    expect(revealGroup).toHaveBeenCalledTimes(3);
  });
  test("el stack conserva el retorno desde Nueva solicitud", async () => {
    const navigation = await openForm();
    const dismissKeyboard = jest.spyOn(Keyboard, "dismiss").mockImplementation(() => {
      expect(navigation.getPathname()).toBe("/estudiante/nueva-solicitud");
    });
    try {
      await act(async () => fireEvent.press(screen.getByRole("button", { name: "Volver" })));
      expect(dismissKeyboard).toHaveBeenCalledTimes(1);
      expect(await screen.findByText("Inicio de Estudiante")).toBeOnTheScreen();
      expect(navigation.getPathname()).toBe("/estudiante");
    } finally {
      dismissKeyboard.mockRestore();
    }
  });

  test("muestra errores visibles y permite corregirlos sin perder valores", async () => {
    await openForm();
    fireEvent.changeText(
      screen.getByLabelText("¿Qué necesidad quieres abordar? *", { exact: false }),
      "   ",
    );
    fireEvent.press(screen.getByRole("button", { name: "Continuar" }));
    expect(screen.getByText("Describe la necesidad que quieres abordar.")).toBeOnTheScreen();
    expect(screen.queryByText("Selecciona una modalidad.")).toBeNull();
    fillRequiredStudentRequestFields();
    expect(screen.queryByText("Describe la necesidad que quieres abordar.")).not.toBeOnTheScreen();
    expect(screen.getByText("Me cuesta leer los materiales del curso.")).toBeOnTheScreen();
    for (let index = 0; index < 4; index += 1) {
      fireEvent.press(screen.getByRole("button", { name: "Volver al paso anterior" }));
    }
    expect(screen.getByDisplayValue("Me cuesta leer los materiales del curso.")).toBeOnTheScreen();
    fireEvent.changeText(screen.getByLabelText("¿Qué esperas de CERETI? *", { exact: false }), "");
    expect(screen.getByText("Indica qué esperas del acompañamiento.")).toBeOnTheScreen();
  });

  test("permite varios apoyos y texto libre para las necesidades de acceso", async () => {
    await openForm();
    fillRequiredStudentRequestFields();
    for (let index = 0; index < 3; index += 1) {
      fireEvent.press(screen.getByRole("button", { name: "Volver al paso anterior" }));
    }
    expect(screen.getByRole("checkbox", { name: /Comunicación escrita/ })).toBeChecked();
    fireEvent.press(screen.getByRole("checkbox", { name: "Persona de apoyo" }));
    expect(screen.getByRole("checkbox", { name: "Persona de apoyo" })).toBeChecked();
    fireEvent.press(screen.getByRole("checkbox", { name: /Comunicación escrita/ }));
    expect(screen.getByRole("checkbox", { name: /Comunicación escrita/ })).not.toBeChecked();
    fireEvent.changeText(
      screen.getByLabelText("Otra necesidad de acceso", { exact: false }),
      "Instrucciones por pasos.",
    );
    expect(screen.getByDisplayValue("Instrucciones por pasos.")).toBeOnTheScreen();
    fireEvent.press(screen.getByRole("button", { name: "Continuar" }));
    fireEvent.press(screen.getByRole("radio", { name: /Presencial/ }));
    expect(screen.getByRole("radio", { name: "En línea" })).not.toBeChecked();
  });

  test("valida una franja opcional incompleta, inválida o invertida", async () => {
    await openForm();
    fillRequiredStudentRequestFields();
    fireEvent.press(screen.getByRole("button", { name: "Volver al paso anterior" }));
    fireEvent.press(screen.getByRole("button", { name: "Volver al paso anterior" }));
    fireEvent.changeText(screen.getByLabelText("Desde", { exact: false }), "25:00");
    fireEvent.press(screen.getByRole("button", { name: "Continuar" }));
    expect(
      screen.getByText("Escribe la hora inicial en formato HH:MM, por ejemplo 09:00."),
    ).toBeOnTheScreen();
    expect(
      screen.getByText("Escribe la hora final en formato HH:MM, por ejemplo 13:00."),
    ).toBeOnTheScreen();
    fireEvent.changeText(screen.getByLabelText("Desde", { exact: false }), "13:00");
    fireEvent.changeText(screen.getByLabelText("Hasta", { exact: false }), "09:00");
    expect(screen.getByText("La hora final debe ser posterior a la inicial.")).toBeOnTheScreen();
    fireEvent.changeText(screen.getByLabelText("Hasta", { exact: false }), "14:00");
    expect(
      screen.queryByText("La hora final debe ser posterior a la inicial."),
    ).not.toBeOnTheScreen();
  });

  test("envía la solicitud ficticia y muestra su comprobante", async () => {
    await openForm();
    fillRequiredStudentRequestFields();

    fireEvent.press(screen.getByRole("button", { name: "Confirmar y enviar solicitud" }));

    expect(screen.getByRole("button", { name: "Enviando solicitud…" })).toBeDisabled();
    expect(await screen.findByText("Solicitud enviada")).toBeOnTheScreen();
    expect(screen.getByText(/^Referencia: SOL-DEMO-/)).toBeOnTheScreen();
    expect(screen.getByTestId("request-confirmation")).toHaveProp("entering");
    expect(screen.getByTestId("request-confirmation-card")).toHaveStyle({
      borderCurve: "continuous",
    });
  });

  test("resume lo que se envía, respeta el orden elegido y conserva la nota de la cuenta", async () => {
    const commands: SubmitStudentRequestCommand[] = [];
    const submitter: StudentRequestSubmitter = {
      async submitStudentRequest(command) {
        commands.push(command);
        return testReceipt;
      },
    };
    render(<RequestForm submitter={submitter} onRevealGroup={() => undefined} />);
    fillStudentRequestNeed();
    fireEvent.press(screen.getByRole("button", { name: "Continuar" }));
    chooseStudentRequestAccess();
    fireEvent.press(screen.getByRole("checkbox", { name: "Persona de apoyo" }));
    fireEvent.changeText(
      screen.getByLabelText("Otra necesidad de acceso", { exact: false }),
      "Instrucciones por pasos.",
    );
    fireEvent.press(screen.getByRole("button", { name: "Continuar" }));
    fireEvent.press(screen.getByRole("radio", { name: /En línea/ }));
    fireEvent.press(screen.getByRole("checkbox", { name: /Domingo/ }));
    fireEvent.press(screen.getByRole("checkbox", { name: /Lunes/ }));
    fireEvent.changeText(screen.getByLabelText("Desde", { exact: false }), "09:00");
    fireEvent.changeText(screen.getByLabelText("Hasta", { exact: false }), "13:00");
    fireEvent.press(screen.getByRole("button", { name: "Continuar" }));
    fillStudentRequestInformationChannel();
    fireEvent.press(screen.getByRole("button", { name: "Continuar" }));

    expect(screen.getByText("Me cuesta leer los materiales del curso.")).toBeOnTheScreen();
    expect(screen.getByText("Aprender a usar un lector de pantalla.")).toBeOnTheScreen();
    expect(
      screen.getByText("Comunicación escrita, Persona de apoyo, Instrucciones por pasos."),
    ).toBeOnTheScreen();
    expect(screen.getByText("En línea")).toBeOnTheScreen();
    expect(screen.getByText("Domingo, Lunes")).toBeOnTheScreen();
    expect(screen.getByText("09:00 a 13:00")).toBeOnTheScreen();
    expect(screen.getByText("Correo con texto accesible")).toBeOnTheScreen();
    expect(
      screen.getByText(
        "El nombre y correo se obtendrán de la cuenta institucional cuando esté disponible el inicio de sesión.",
      ),
    ).toBeOnTheScreen();

    fireEvent.press(screen.getByRole("button", { name: "Confirmar y enviar solicitud" }));

    expect(await screen.findByText("Solicitud enviada")).toBeOnTheScreen();
    expect(commands).toEqual([
      {
        needSummary: "Me cuesta leer los materiales del curso.",
        expectedOutcome: "Aprender a usar un lector de pantalla.",
        accessNeeds: [
          { id: "written-communication", label: "Comunicación escrita" },
          { id: "support-person", label: "Persona de apoyo" },
        ],
        otherAccessNeed: "Instrucciones por pasos.",
        generalAvailability: {
          preferredWeekdays: [0, 1],
          preferredTimeRange: { from: "09:00", to: "13:00" },
        },
        modalityPreference: "online",
        preferredAccessibleInformationChannel: "Correo con texto accesible",
      },
    ]);
  });

  test("conserva los datos después de un error y vuelve a enviar los valores visibles", async () => {
    const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility");
    const focus = jest.spyOn(AccessibilityInfo, "sendAccessibilityEvent");
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
    const revealGroup = jest.fn();
    const view = render(<RequestForm submitter={submitter} onRevealGroup={revealGroup} />);
    fillRequiredStudentRequestFields();
    focus.mockClear();
    fireEvent.press(screen.getByRole("button", { name: "Confirmar y enviar solicitud" }));

    expect(await screen.findByText("No pudimos enviar la solicitud ficticia.")).toBeOnTheScreen();
    expect(screen.getByTestId("submission-error")).toHaveProp("entering");
    expect(screen.getByTestId("submission-error")).toHaveProp("accessibilityLiveRegion", "none");
    await waitFor(() => expect(revealGroup).toHaveBeenCalledTimes(1));
    expect(focus).toHaveBeenCalled();
    expect(
      screen.getByLabelText(
        "No pudimos enviar la solicitud ficticia. Tus datos siguen en el formulario. Puedes reintentar.",
      ),
    ).toBeOnTheScreen();
    expect(screen.getByTestId("submission-error")).toHaveStyle({ borderCurve: "continuous" });
    for (let index = 0; index < 4; index += 1) {
      fireEvent.press(screen.getByRole("button", { name: "Volver al paso anterior" }));
    }
    expect(screen.getByDisplayValue("Me cuesta leer los materiales del curso.")).toBeOnTheScreen();
    fireEvent.changeText(
      screen.getByLabelText("¿Qué necesidad quieres abordar? *", { exact: false }),
      "Necesito acceder a las lecturas actualizadas.",
    );
    fireEvent.press(screen.getByRole("button", { name: "Continuar" }));
    fireEvent.press(screen.getByRole("checkbox", { name: "Persona de apoyo" }));
    const focusCallsBeforeRerender = focus.mock.calls.length;
    view.rerender(<RequestForm submitter={submitter} onRevealGroup={() => undefined} />);
    expect(focus).toHaveBeenCalledTimes(focusCallsBeforeRerender);
    expect(announce.mock.calls.map(([message]) => message)).toEqual([
      "Enviando solicitud ficticia.",
    ]);
    for (let index = 0; index < 3; index += 1) {
      fireEvent.press(screen.getByRole("button", { name: "Continuar" }));
    }
    fireEvent.press(screen.getByRole("button", { name: "Reintentar envío" }));

    expect(await screen.findByText("Solicitud enviada")).toBeOnTheScreen();
    expect(commands).toHaveLength(2);
    expect(commands[0]).toMatchObject({
      needSummary: "Me cuesta leer los materiales del curso.",
      expectedOutcome: "Aprender a usar un lector de pantalla.",
      modalityPreference: "online",
      accessNeeds: [{ id: "written-communication", label: "Comunicación escrita" }],
      generalAvailability: { preferredWeekdays: [1] },
      preferredAccessibleInformationChannel: "Correo con texto accesible",
    });
    expect(commands[1]).toMatchObject({
      needSummary: "Necesito acceder a las lecturas actualizadas.",
      accessNeeds: [
        { id: "written-communication", label: "Comunicación escrita" },
        { id: "support-person", label: "Persona de apoyo" },
      ],
    });
    view.rerender(<RequestForm submitter={submitter} onRevealGroup={() => undefined} />);
    expect(announce.mock.calls.map(([message]) => message)).toEqual([
      "Enviando solicitud ficticia.",
      "Enviando solicitud ficticia.",
      "Solicitud ficticia enviada.",
    ]);
    expect(screen.getByTestId("request-confirmation")).toHaveProp(
      "accessibilityLiveRegion",
      "none",
    );
  });

  test("impide iniciar dos envíos mientras el primero sigue pendiente", async () => {
    const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility");
    let resolveSubmission!: (receipt: StudentRequestSubmissionReceipt) => void;
    const pending = new Promise<StudentRequestSubmissionReceipt>((resolve) => {
      resolveSubmission = resolve;
    });
    const submitStudentRequest = jest.fn(() => pending);
    render(<RequestForm submitter={{ submitStudentRequest }} onRevealGroup={() => undefined} />);
    fillRequiredStudentRequestFields();
    const action = screen.getByRole("button", { name: "Confirmar y enviar solicitud" });

    act(() => {
      fireEvent.press(action);
      fireEvent.press(action);
    });

    expect(submitStudentRequest).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenLastCalledWith("Enviando solicitud ficticia.");
    expect(screen.getByRole("button", { name: "Enviando solicitud…" })).toBeDisabled();
    await act(async () => resolveSubmission(testReceipt));
    expect(await screen.findByText("Solicitud enviada")).toBeOnTheScreen();
    expect(announce).toHaveBeenCalledTimes(2);
    expect(announce).toHaveBeenLastCalledWith("Solicitud ficticia enviada.");
  });

  test("el formulario no conserva el borrador después de cerrar sesión", async () => {
    await openForm();
    fillRequiredStudentRequestFields();
    await act(async () => router.back());
    await act(async () => {
      fireEvent.press(screen.getByRole("button", { name: "Cerrar sesión" }));
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByText("Explora la aplicación")).toBeOnTheScreen());
    const loginButton = await screen.findByRole("button", { name: "Entrar como Estudiante" });
    await act(async () => {
      fireEvent.press(loginButton);
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByText("Inicio de Estudiante")).toBeOnTheScreen());
    await act(async () => {
      fireEvent.press(screen.getByRole("button", { name: "Nueva solicitud" }));
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(
        screen.getByLabelText("¿Qué necesidad quieres abordar? *", { exact: false }),
      ).toHaveProp("value", ""),
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
      const roleHomeTitle =
        role === "Practicante"
          ? "Acompañamientos asignados"
          : role === "Profesional"
            ? "Jueves, 24 de Octubre"
            : `Inicio de ${role}`;
      const roleHomePath =
        role === "Practicante" ? "/practicante/asignaciones" : `/${role.toLowerCase()}`;
      const navigation = renderRouter(appDirectory);
      const loginButton = await screen.findByRole("button", { name: `Entrar como ${role}` });
      await act(async () => {
        fireEvent.press(loginButton);
        await Promise.resolve();
      });
      await waitFor(() => expect(screen.getByText(roleHomeTitle)).toBeOnTheScreen());
      await act(async () => {
        router.push("/estudiante/nueva-solicitud");
        await Promise.resolve();
      });
      await waitFor(() => expect(navigation.getPathname()).toBe(roleHomePath));
      expect(screen.queryByLabelText("¿Qué necesidad quieres abordar? *")).not.toBeOnTheScreen();
    },
  );
});

describe("Adaptador mock de envío", () => {
  test("no confirma una solicitud sin necesidades de acceso ni consume su referencia", async () => {
    const submitter = createMockStudentRequestSubmitter({
      delayMs: 0,
      now: () => new Date("2026-09-10T12:00:00.000Z"),
    });
    const command: SubmitStudentRequestCommand = {
      needSummary: "Acceder al material del curso.",
      expectedOutcome: "Leer el contenido.",
      accessNeeds: [],
      generalAvailability: { preferredWeekdays: [1] },
      modalityPreference: "online",
      preferredAccessibleInformationChannel: "Correo accesible",
    };

    await expect(submitter.submitStudentRequest(command)).rejects.toThrow(
      "Se requiere describir la necesidad de acceso",
    );
    await expect(
      submitter.submitStudentRequest({
        ...command,
        accessNeeds: [{ id: "written", label: "Comunicación escrita" }],
      }),
    ).resolves.toMatchObject({ requestId: "SOL-DEMO-001" });
  });

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
