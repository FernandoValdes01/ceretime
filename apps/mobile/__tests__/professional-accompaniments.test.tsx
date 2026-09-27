import path from "node:path";
import { router } from "expo-router";
import { act, render } from "@testing-library/react-native";
import { fireEvent, renderRouter, screen, waitFor } from "expo-router/testing-library";

import type { ProfessionalAccompaniment } from "../src/application/professional-accompaniment-models";
import { createMockProfessionalAccompanimentReader } from "../src/infrastructure/mock-professional-accompaniment-reader";
import {
  createMockProfessionalAccompanimentStore,
  fictionalOtherProfessionalAccompaniments,
} from "../src/infrastructure/mock-professional-accompaniment-data";
import { createMockProfessionalReviewAdapter } from "../src/infrastructure/mock-professional-review-adapter";
import { ProfessionalAccompanimentsContent } from "../src/presentation/profesional/professional-accompaniments-screen";

const appDirectory = path.resolve(__dirname, "../app");

const accompaniment: ProfessionalAccompaniment = {
  id: "assigned-professional-1",
  studentName: "Camila Muñoz",
  objective: "Coordinar apoyos para participar en las evaluaciones del semestre.",
  status: "active",
};

describe("lector de acompañamientos del Profesional", () => {
  test("devuelve sólo el conjunto autorizado", async () => {
    const reader = createMockProfessionalAccompanimentReader();
    const accompaniments = await reader.readAccompaniments();

    expect(accompaniments).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "ACO-PRO-001" })]),
    );
    expect(accompaniments).not.toEqual(
      expect.arrayContaining(
        fictionalOtherProfessionalAccompaniments.map(({ id }) => expect.objectContaining({ id })),
      ),
    );
  });

  test("expone escenarios vacío y error controlado", async () => {
    await expect(
      createMockProfessionalAccompanimentReader({ mode: "empty" }).readAccompaniments(),
    ).resolves.toEqual([]);
    await expect(
      createMockProfessionalAccompanimentReader({ mode: "error" }).readAccompaniments(),
    ).rejects.toThrow("No pudimos cargar tus acompañamientos.");
  });

  test("comparte el acompañamiento creado al aceptar una solicitud", async () => {
    const store = createMockProfessionalAccompanimentStore([]);
    const reader = createMockProfessionalAccompanimentReader({ store });
    const reviewAdapter = createMockProfessionalReviewAdapter({ accompanimentStore: store });

    await reviewAdapter.performProfessionalRequestAction("SOL-PRO-003", "accept");

    await expect(reader.readAccompaniments()).resolves.toEqual([
      expect.objectContaining({
        id: "ACO-SOL-PRO-003",
        studentName: "Tomás Herrera",
      }),
    ]);
  });
});

describe("pantalla de acompañamientos del Profesional", () => {
  test("muestra sólo los datos mínimos y convierte toda la tarjeta en navegación", () => {
    render(
      <ProfessionalAccompanimentsContent
        status="success"
        data={[accompaniment]}
        error={null}
        reload={jest.fn()}
      />,
    );

    expect(screen.getByText(accompaniment.studentName)).toBeOnTheScreen();
    expect(screen.getByText(accompaniment.objective)).toBeOnTheScreen();
    expect(screen.getByText("Activo")).toBeOnTheScreen();
    expect(screen.queryByText("Acompañamientos autorizados")).not.toBeOnTheScreen();
    expect(
      screen.queryByText("Consulta los acompañamientos que tienes autorizados y abre su detalle."),
    ).not.toBeOnTheScreen();
    expect(
      screen.getByRole("button", {
        name: "Acompañamiento de Camila Muñoz. Estado: Activo. Coordinar apoyos para participar en las evaluaciones del semestre.",
      }),
    ).toBeOnTheScreen();
    expect(screen.queryByText("accessNeeds")).not.toBeOnTheScreen();
    expect(screen.queryByText("studentId")).not.toBeOnTheScreen();
  });

  test("muestra carga, error con reintento y vacío", () => {
    const reload = jest.fn();
    const { rerender } = render(
      <ProfessionalAccompanimentsContent status="loading" data={[]} error={null} reload={reload} />,
    );
    expect(screen.getByText("Cargando acompañamientos…")).toBeOnTheScreen();

    rerender(
      <ProfessionalAccompanimentsContent
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
      <ProfessionalAccompanimentsContent status="empty" data={[]} error={null} reload={reload} />,
    );
    expect(screen.getByText("No tienes acompañamientos autorizados")).toBeOnTheScreen();
  });

  test("permite navegar desde el listado al placeholder del detalle", async () => {
    const navigation = renderRouter(appDirectory);
    await act(async () => {
      fireEvent.press(await screen.findByRole("button", { name: "Entrar como Profesional" }));
      await Promise.resolve();
    });

    await act(async () => {
      router.push("/profesional/acompanamientos");
      await Promise.resolve();
    });

    expect(await screen.findByRole("header", { name: "Acompañamientos" })).toBeOnTheScreen();
    fireEvent.press(
      screen.getByRole("button", {
        name: "Acompañamiento de Camila Muñoz. Estado: Activo. Coordinar apoyos para participar en las evaluaciones del semestre.",
      }),
    );

    await waitFor(() =>
      expect(navigation.getPathname()).toBe("/profesional/acompanamientos/ACO-PRO-001"),
    );
    expect(await screen.findByText("Acompañamiento seleccionado")).toBeOnTheScreen();
    expect(screen.getByText(/ACO-PRO-001/)).toBeOnTheScreen();
  });
});
