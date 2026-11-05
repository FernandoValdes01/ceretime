import path from "node:path";
import { act, fireEvent, renderRouter, screen, waitFor } from "expo-router/testing-library";
import {
  createDemoDataDependencies,
  mobileDependencies,
} from "../src/composition/mobile-dependencies";
import type { SubmitStudentRequestCommand } from "../src/application/student-area-models";
import { createDemoProfessionalAgenda } from "../src/infrastructure/demo-professional-agenda-data";
import { fillRequiredStudentRequestFields } from "./student-request-test-helpers";

const content = {
  needSummary:
    "Necesito materiales accesibles para participar en las evaluaciones y en las actividades de mi carrera.",
  expectedOutcome: "Aprender a usar un lector de pantalla.",
  accessNeeds: [{ id: "written", label: "Comunicación escrita" }],
  modalityPreference: "online",
  generalAvailability: { preferredWeekdays: [1] },
  preferredAccessibleInformationChannel: "Correo con texto accesible",
} satisfies SubmitStudentRequestCommand;

afterEach(() => {
  mobileDependencies.resetDemo();
  jest.useRealTimers();
});

test("la solicitud conserva su contenido entre roles y una aceptación abre el mismo acompañamiento", async () => {
  const demo = createDemoDataDependencies();
  const receipt = await demo.studentRequestSubmitter.submitStudentRequest(content);
  const submitted = (await demo.professionalReviewPort.readProfessionalRequests()).find(
    (request) => request.id === receipt.requestId,
  );
  expect(submitted).toMatchObject({
    ...content,
    accessNeeds: "Comunicación escrita",
    status: "received",
    studentName: "Valentina Rojas",
  });
  await demo.professionalReviewPort.performProfessionalRequestAction(
    receipt.requestId,
    "startReview",
  );
  expect(
    (await demo.studentAreaReader.readStudentArea()).requests.find(
      (request) => request.id === receipt.requestId,
    )?.status,
  ).toBe("underReview");
  await demo.professionalReviewPort.performProfessionalRequestAction(receipt.requestId, "accept", {
    objective: content.expectedOutcome,
  });
  const snapshot = await demo.studentAreaReader.readStudentArea();
  expect(snapshot.requests.find((request) => request.id === receipt.requestId)).toMatchObject({
    status: "accepted",
    needSummary: content.needSummary,
  });
  const accompaniment = snapshot.accompaniments.find(
    (item) => item.requestId === receipt.requestId,
  );
  expect(accompaniment).toMatchObject({
    status: "active",
    objective: content.expectedOutcome,
    accessNeeds: "Comunicación escrita",
  });
  expect(
    await demo.professionalAccompanimentReader.readAccompaniment(accompaniment!.id),
  ).toMatchObject({
    id: accompaniment!.id,
    objective: content.expectedOutcome,
    studentName: "Valentina Rojas",
  });
  expect(
    (await demo.professionalReviewPort.readProfessionalRequests()).find(
      (item) => item.id === receipt.requestId,
    )?.accompaniment?.id,
  ).toBe(accompaniment!.id);
  await expect(
    demo.professionalReviewPort.performProfessionalRequestAction(receipt.requestId, "accept", {
      objective: "Otro",
    }),
  ).rejects.toThrow("Esta acción todavía no está disponible en el contrato Mobile.");
  expect(
    (await demo.studentAreaReader.readStudentArea()).accompaniments.filter(
      (item) => item.requestId === receipt.requestId,
    ),
  ).toHaveLength(1);
});

test("reiniciar descarta cambios de todos los roles y una escritura tardía del escenario anterior", async () => {
  jest.useFakeTimers();
  const previous = mobileDependencies.studentRequestSubmitter;
  const pending = previous.submitStudentRequest(content);
  await mobileDependencies.administratorAccountsPort.enableInternAccount("intern-account-1");
  await mobileDependencies.professionalReviewPort.performProfessionalRequestAction(
    "SOL-PRO-001",
    "startReview",
  );
  mobileDependencies.resetDemo();
  await jest.runAllTimersAsync();
  const receipt = await pending;
  expect(
    (await mobileDependencies.studentAreaReader.readStudentArea()).requests.some(
      (item) => item.id === receipt.requestId,
    ),
  ).toBe(false);
  expect(
    (await mobileDependencies.administratorAccountsPort.readInternAccounts()).find(
      (item) => item.id === "intern-account-1",
    )?.status,
  ).toBe("pending");
  expect(
    (await mobileDependencies.professionalReviewPort.readProfessionalRequests()).find(
      (item) => item.id === "SOL-PRO-001",
    )?.status,
  ).toBe("received");
});

test("la agenda avanza fechas civiles entre meses y ofrece días vacíos sin duplicar actividades", () => {
  expect(createDemoProfessionalAgenda(0).dateLabel).toBe("Jueves, 5 de noviembre");
  expect(createDemoProfessionalAgenda(1).dateLabel).toBe("Viernes, 6 de noviembre");
  expect(createDemoProfessionalAgenda(26).dateLabel).toBe("Martes, 1 de diciembre");
  expect(createDemoProfessionalAgenda(-6).dateLabel).toBe("Viernes, 30 de octubre");
  expect(createDemoProfessionalAgenda(2).appointments).toEqual([]);
  expect(createDemoProfessionalAgenda(1).appointments).toHaveLength(1);
});

test("recorre la solicitud real de las pantallas entre Estudiante y Profesional y permite repetir la demostración", async () => {
  mobileDependencies.resetDemo();
  renderRouter(path.resolve(__dirname, "../app"));
  fireEvent.press(await screen.findByRole("button", { name: "Entrar como Estudiante" }));
  fireEvent.press(await screen.findByRole("button", { name: "Nueva solicitud" }));
  fillRequiredStudentRequestFields();
  fireEvent.press(screen.getByRole("button", { name: "Confirmar y enviar solicitud" }));
  expect(await screen.findByText(/SOL-DEMO-006/)).toBeOnTheScreen();
  fireEvent.press(screen.getByRole("button", { name: "Cerrar sesión" }));
  fireEvent.press(await screen.findByRole("button", { name: "Entrar como Profesional" }));
  fireEvent.press(await screen.findByLabelText("Acompañamientos, pestaña, 3 de 4"));
  expect(await screen.findByText("Camila Muñoz")).toBeOnTheScreen();
  fireEvent.press(await screen.findByLabelText("Solicitudes, pestaña, 2 de 4"));
  fireEvent.press(
    await screen.findByRole("button", { name: /Solicitud SOL-DEMO-006 de Valentina Rojas/ }),
  );
  fireEvent.press(await screen.findByRole("button", { name: "Poner en revisión" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Aceptar solicitud" })).toBeOnTheScreen(),
  );
  fireEvent.changeText(
    screen.getByLabelText("Objetivo del acompañamiento"),
    content.expectedOutcome,
  );
  fireEvent.press(screen.getByRole("button", { name: "Aceptar solicitud" }));
  expect(await screen.findByText("Acompañamiento abierto")).toBeOnTheScreen();
  fireEvent.press(screen.getByLabelText("Acompañamientos, pestaña, 3 de 4"));
  expect(await screen.findByText(content.expectedOutcome)).toBeOnTheScreen();
  fireEvent.press(screen.getByRole("button", { name: "Cerrar sesión" }));
  fireEvent.press(await screen.findByRole("button", { name: "Entrar como Estudiante" }));
  fireEvent.press(await screen.findByRole("button", { name: "Mis solicitudes" }));
  fireEvent.press(
    await screen.findByRole("button", { name: /Me cuesta leer los materiales del curso/ }),
  );
  expect(await screen.findByText("Aceptada")).toBeOnTheScreen();
  fireEvent.press(screen.getByRole("button", { name: "Ver acompañamiento" }));
  expect(await screen.findByText(content.expectedOutcome)).toBeOnTheScreen();
  fireEvent.press(screen.getByRole("button", { name: "Cerrar sesión" }));
  fireEvent.press(await screen.findByRole("button", { name: "Reiniciar demostración" }));
  expect(
    await screen.findByText("Demostración reiniciada. Puedes comenzar de nuevo."),
  ).toBeOnTheScreen();
  await act(async () =>
    expect(
      (await mobileDependencies.studentAreaReader.readStudentArea()).requests.some(
        (request) => request.id === "SOL-DEMO-006",
      ),
    ).toBe(false),
  );
});
