import path from "node:path";
import { router } from "expo-router";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { renderRouter } from "expo-router/testing-library";

import type { PractitionerAccompaniment } from "../src/application/practitioner-accompaniment-models";
import { mobileDependencies } from "../src/composition/mobile-dependencies";
import { createMockPractitionerAccompanimentReader } from "../src/infrastructure/mock-practitioner-accompaniment-reader";
import { PractitionerAccompanimentsContent } from "../src/presentation/practicante/practitioner-accompaniments-screen";
import { practitionerRoutes } from "../src/presentation/navigation/practitioner-routes";

const appDirectory = path.resolve(__dirname, "../app");

const accompaniment: PractitionerAccompaniment = {
  id: "assigned-1",
  objective: "Organizar apoyos para participar en actividades académicas.",
  status: "active",
  view: "minimized",
};

describe("lector de acompañamientos del Practicante", () => {
  test("devuelve sólo los acompañamientos asignados a la identidad consultada", async () => {
    const reader = createMockPractitionerAccompanimentReader();

    await expect(
      reader.readAssignedAccompaniments("mock-practitioner-assigned-1"),
    ).resolves.toEqual([
      expect.objectContaining({ id: "mock-accompaniment-1", view: "minimized" }),
    ]);
    await expect(reader.readAssignedAccompaniments("another-practitioner")).resolves.toEqual([]);
  });

  test("expone escenarios vacío y error controlado", async () => {
    await expect(
      createMockPractitionerAccompanimentReader({ mode: "empty" }).readAssignedAccompaniments(
        "mock-practitioner-assigned-1",
      ),
    ).resolves.toEqual([]);
    await expect(
      createMockPractitionerAccompanimentReader({ mode: "error" }).readAssignedAccompaniments(
        "mock-practitioner-assigned-1",
      ),
    ).rejects.toThrow("No pudimos cargar tus acompañamientos asignados.");
  });
});

describe("pantalla de acompañamientos del Practicante", () => {
  test("muestra el listado minimizado sin acciones de modificación", () => {
    render(
      <PractitionerAccompanimentsContent
        status="success"
        data={[accompaniment]}
        error={null}
        reload={jest.fn()}
      />,
    );

    expect(screen.getByText(accompaniment.objective)).toBeOnTheScreen();
    expect(screen.getByText("Activo")).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: /Acompañamiento/ })).not.toBeOnTheScreen();
    expect(screen.queryByText("studentId")).not.toBeOnTheScreen();
  });

  test("muestra carga, error con reintento y vacío", () => {
    const reload = jest.fn();
    const { rerender } = render(
      <PractitionerAccompanimentsContent status="loading" data={[]} error={null} reload={reload} />,
    );
    expect(screen.getByText("Cargando acompañamientos asignados")).toBeOnTheScreen();

    rerender(
      <PractitionerAccompanimentsContent
        status="error"
        data={[]}
        error={new Error("Falla de prueba")}
        reload={reload}
      />,
    );
    expect(screen.getByText("Falla de prueba")).toBeOnTheScreen();
    fireEvent.press(screen.getByRole("button", { name: "Reintentar" }));
    expect(reload).toHaveBeenCalledTimes(1);

    rerender(
      <PractitionerAccompanimentsContent status="empty" data={[]} error={null} reload={reload} />,
    );
    expect(screen.getByText("No tienes acompañamientos asignados")).toBeOnTheScreen();
  });

  test("el Practicante asignado entra al listado", async () => {
    const navigation = renderRouter(appDirectory);
    await act(async () => {
      fireEvent.press(screen.getByRole("button", { name: "Entrar como Practicante" }));
      await Promise.resolve();
    });

    expect(await screen.findByText(accompaniment.objective)).toBeOnTheScreen();
    expect(navigation.getPathname()).toBe("/practicante/asignaciones");
  });

  test("el Practicante sin asignación recibe acceso denegado", async () => {
    const navigation = renderRouter(appDirectory);
    await act(async () => {
      fireEvent.press(
        screen.getByRole("button", { name: "Entrar como Practicante sin asignación" }),
      );
      await Promise.resolve();
    });

    await waitFor(() => expect(screen.getByText("Acceso denegado")).toBeOnTheScreen());
    expect(navigation.getPathname()).toBe("/practicante/sin-asignacion");
    expect(screen.queryByText(accompaniment.objective)).not.toBeOnTheScreen();
  });

  test("no consulta acompañamientos al abrir directamente la ruta sin asignación", async () => {
    const readAssignedAccompaniments = jest.spyOn(
      mobileDependencies.practitionerAccompanimentReader,
      "readAssignedAccompaniments",
    );
    const navigation = renderRouter(appDirectory);

    try {
      await act(async () => {
        fireEvent.press(
          screen.getByRole("button", { name: "Entrar como Practicante sin asignación" }),
        );
        await Promise.resolve();
      });
      await waitFor(() => expect(navigation.getPathname()).toBe(practitionerRoutes.unassigned));
      readAssignedAccompaniments.mockClear();

      await act(async () => {
        router.push(practitionerRoutes.assigned);
        await Promise.resolve();
      });

      await waitFor(() => expect(navigation.getPathname()).toBe(practitionerRoutes.unassigned));
      expect(readAssignedAccompaniments).not.toHaveBeenCalled();
    } finally {
      readAssignedAccompaniments.mockRestore();
    }
  });
});
