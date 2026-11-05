import path from "node:path";
import { router } from "expo-router";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { renderRouter } from "expo-router/testing-library";
import { AccessibilityInfo } from "react-native";

import type { InternAccompaniment } from "../src/domain/intern-accompaniment-models";
import { AccompanimentAccessDeniedError } from "../src/domain/accompaniment-access-denied-error";
import { mobileDependencies } from "../src/composition/mobile-dependencies";
import { createDemoInternAccompanimentReader } from "../src/infrastructure/demo-intern-accompaniment-reader";
import { InternAccompanimentsContent } from "../src/presentation/practicante/intern-accompaniments-screen";
import { InternAccompanimentDetailContent } from "../src/presentation/practicante/intern-accompaniment-detail-screen";
import { internRoutes } from "../src/presentation/navigation/intern-routes";

const appDirectory = path.resolve(__dirname, "../app");

const accompaniment: InternAccompaniment = {
  id: "assigned-1",
  objective: "Organizar apoyos para participar en actividades académicas.",
  status: "active",
  view: "minimized",
};

describe("lector de acompañamientos del Practicante", () => {
  test("devuelve sólo los acompañamientos asignados a la identidad consultada", async () => {
    const reader = createDemoInternAccompanimentReader();

    const assigned = await reader.readAssignedAccompaniments("demo-intern-assigned-1");
    expect(assigned).toHaveLength(5);
    expect(assigned).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "demo-accompaniment-1", view: "minimized" }),
        expect.objectContaining({ id: "demo-accompaniment-2", status: "paused" }),
        expect.objectContaining({ id: "demo-accompaniment-4", status: "closed" }),
      ]),
    );
    expect(assigned.map(({ id }) => id)).not.toContain("demo-accompaniment-foreign-1");
    await expect(
      reader.readAssignedAccompaniment("demo-intern-assigned-1", "demo-accompaniment-1"),
    ).resolves.toEqual(expect.objectContaining({ id: "demo-accompaniment-1", view: "minimized" }));
    await expect(reader.readAssignedAccompaniments("another-intern")).resolves.toEqual([]);
    await expect(
      reader.readAssignedAccompaniment("demo-intern-assigned-1", "not-assigned"),
    ).rejects.toBeInstanceOf(AccompanimentAccessDeniedError);
    await expect(
      reader.readAssignedAccompaniment("another-intern", "demo-accompaniment-1"),
    ).rejects.toThrow("No puedes acceder a este acompañamiento.");
  });

  test("expone escenarios vacío y error controlado", async () => {
    await expect(
      createDemoInternAccompanimentReader({ mode: "empty" }).readAssignedAccompaniments(
        "demo-intern-assigned-1",
      ),
    ).resolves.toEqual([]);
    await expect(
      createDemoInternAccompanimentReader({ mode: "error" }).readAssignedAccompaniments(
        "demo-intern-assigned-1",
      ),
    ).rejects.toThrow("No pudimos cargar tus acompañamientos asignados.");
  });
});

describe("pantalla de acompañamientos del Practicante", () => {
  test("muestra el listado minimizado sin acciones de modificación", () => {
    render(
      <InternAccompanimentsContent
        status="success"
        data={[accompaniment]}
        error={null}
        reload={jest.fn()}
      />,
    );

    expect(screen.getByText(accompaniment.objective)).toBeOnTheScreen();
    expect(screen.getByText("Activo")).toBeOnTheScreen();
    expect(screen.queryByLabelText("Estado: Activo")).not.toBeOnTheScreen();
    expect(
      screen.getByRole("button", {
        name: "Acompañamiento: Organizar apoyos para participar en actividades académicas. Estado: Activo.",
      }),
    ).toBeOnTheScreen();
    expect(screen.queryByText("Solo lectura")).not.toBeOnTheScreen();
    expect(screen.queryByText("studentId")).not.toBeOnTheScreen();
    expect(screen.queryByText("Editar")).not.toBeOnTheScreen();
    expect(screen.queryByText("Eliminar")).not.toBeOnTheScreen();
  });

  test("muestra carga, error con reintento y vacío", () => {
    const reload = jest.fn();
    const { rerender } = render(
      <InternAccompanimentsContent status="loading" data={[]} error={null} reload={reload} />,
    );
    expect(screen.getByText("Cargando acompañamientos asignados")).toBeOnTheScreen();

    rerender(
      <InternAccompanimentsContent
        status="error"
        data={[]}
        error={new Error("Falla de prueba")}
        reload={reload}
      />,
    );
    expect(screen.getByText("Falla de prueba")).toBeOnTheScreen();
    fireEvent.press(screen.getByRole("button", { name: "Reintentar" }));
    expect(reload).toHaveBeenCalledTimes(1);

    rerender(<InternAccompanimentsContent status="empty" data={[]} error={null} reload={reload} />);
    expect(screen.getByText("No tienes acompañamientos asignados")).toBeOnTheScreen();
  });

  test("muestra carga y error del detalle con reintento", () => {
    const reload = jest.fn();
    const onBack = jest.fn();
    const { rerender } = render(
      <InternAccompanimentDetailContent
        status="loading"
        data={null}
        error={null}
        reload={reload}
        onBack={onBack}
      />,
    );
    expect(screen.getByText("Cargando acompañamiento")).toBeOnTheScreen();

    rerender(
      <InternAccompanimentDetailContent
        status="error"
        data={null}
        error={new Error("Falla de detalle")}
        reload={reload}
        onBack={onBack}
      />,
    );
    expect(screen.getByText("Falla de detalle")).toBeOnTheScreen();
    fireEvent.press(screen.getByRole("button", { name: "Reintentar carga del acompañamiento" }));
    expect(reload).toHaveBeenCalledTimes(1);
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

  test("abre el detalle minimizado desde el listado", async () => {
    const focusEvent = jest.spyOn(AccessibilityInfo, "sendAccessibilityEvent");
    const navigation = renderRouter(appDirectory);
    await act(async () => {
      fireEvent.press(screen.getByRole("button", { name: "Entrar como Practicante" }));
      await Promise.resolve();
    });

    fireEvent.press(
      await screen.findByRole("button", {
        name: "Acompañamiento: Organizar apoyos para participar en actividades académicas. Estado: Activo.",
      }),
    );

    expect(await screen.findByText("Detalle del acompañamiento")).toBeOnTheScreen();
    expect(
      screen.queryByRole("button", { name: /Abre el detalle del acompañamiento/ }),
    ).not.toBeOnTheScreen();
    expect(focusEvent).toHaveBeenCalledWith(expect.anything(), "focus");
    expect(navigation.getPathname()).toBe("/practicante/asignaciones/demo-accompaniment-1");
    expect(screen.getByText(accompaniment.objective)).toBeOnTheScreen();
    expect(screen.getByText("Activo")).toBeOnTheScreen();
    expect(screen.queryByText("Vista de solo lectura")).not.toBeOnTheScreen();
    expect(screen.queryByText("studentId")).not.toBeOnTheScreen();
    expect(screen.queryByText("accessNeeds")).not.toBeOnTheScreen();
    expect(screen.queryByText("Editar")).not.toBeOnTheScreen();
    expect(screen.queryByText("Eliminar")).not.toBeOnTheScreen();

    fireEvent.press(screen.getByRole("button", { name: "Volver" }));
    await waitFor(() => expect(navigation.getPathname()).toBe(internRoutes.assigned));
    focusEvent.mockRestore();
  });

  test("usa la misma denegación para un acompañamiento no asignado o inexistente", async () => {
    const navigation = renderRouter(appDirectory);
    await act(async () => {
      fireEvent.press(screen.getByRole("button", { name: "Entrar como Practicante" }));
      await Promise.resolve();
    });

    await act(async () => {
      router.push({
        pathname: "/practicante/asignaciones/[accompanimentId]",
        params: { accompanimentId: "not-assigned" },
      });
      await Promise.resolve();
    });
    expect(await screen.findByText("No puedes acceder a este acompañamiento.")).toBeOnTheScreen();
    expect(navigation.getPathname()).toBe("/practicante/asignaciones/not-assigned");

    await act(async () => {
      router.push({
        pathname: "/practicante/asignaciones/[accompanimentId]",
        params: { accompanimentId: "does-not-exist" },
      });
      await Promise.resolve();
    });
    expect(await screen.findByText("No puedes acceder a este acompañamiento.")).toBeOnTheScreen();
    expect(screen.queryByText("not-assigned")).not.toBeOnTheScreen();
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
      mobileDependencies.internAccompanimentReader,
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
      await waitFor(() => expect(navigation.getPathname()).toBe(internRoutes.unassigned));
      readAssignedAccompaniments.mockClear();

      await act(async () => {
        router.push(internRoutes.assigned);
        await Promise.resolve();
      });

      await waitFor(() => expect(navigation.getPathname()).toBe(internRoutes.unassigned));
      expect(readAssignedAccompaniments).not.toHaveBeenCalled();
    } finally {
      readAssignedAccompaniments.mockRestore();
    }
  });
});
