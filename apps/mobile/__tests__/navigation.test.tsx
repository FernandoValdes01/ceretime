import path from "node:path";
import { router } from "expo-router";
import { act, fireEvent, renderRouter, screen, waitFor } from "expo-router/testing-library";

const appDirectory = path.resolve(__dirname, "../app");
const roleCases = [
  ["Estudiante", "/estudiante"],
  ["Profesional", "/profesional"],
  ["Practicante", "/practicante"],
  ["Administrador", "/administrador"],
] as const;

describe("Navegación principal", () => {
  test("el arranque sin sesión muestra el selector de roles", async () => {
    const navigation = renderRouter(appDirectory);
    expect(await screen.findByText("Explora la aplicación")).toBeOnTheScreen();
    expect(navigation.getPathname()).toBe("/login");
  });

  test.each(roleCases)(
    "%s puede entrar y salir sin conservar historial protegido",
    async (label, href) => {
      const navigation = renderRouter(appDirectory);
      await fireEvent.press(await screen.findByRole("button", { name: `Entrar como ${label}` }));
      expect(await screen.findByText(`Inicio de ${label}`)).toBeOnTheScreen();
      expect(navigation.getPathname()).toBe(href);

      await fireEvent.press(screen.getByRole("button", { name: "Cambiar de rol" }));
      expect(await screen.findByText("Explora la aplicación")).toBeOnTheScreen();
      expect(navigation.getPathname()).toBe("/login");
      expect(router.canGoBack()).toBe(false);
    },
  );

  test.each(roleCases)(
    "un enlace directo a %s sin sesión vuelve al acceso",
    async (_label, href) => {
      const navigation = renderRouter(appDirectory, { initialUrl: href });
      expect(await screen.findByText("Explora la aplicación")).toBeOnTheScreen();
      expect(navigation.getPathname()).toBe("/login");
    },
  );

  test.each(roleCases)(
    "%s no puede navegar a las entradas de los otros roles",
    async (label, href) => {
      const navigation = renderRouter(appDirectory);
      await fireEvent.press(await screen.findByRole("button", { name: `Entrar como ${label}` }));
      await screen.findByText(`Inicio de ${label}`);

      for (const [otherLabel, otherHref] of roleCases) {
        if (otherHref === href) continue;
        await act(async () => router.push(otherHref));
        await waitFor(() => expect(navigation.getPathname()).toBe(href));
        expect(screen.queryByText(`Inicio de ${otherLabel}`)).not.toBeOnTheScreen();
      }
    },
  );

  test("una dirección inexistente ofrece volver al acceso", async () => {
    const navigation = renderRouter(appDirectory, { initialUrl: "/no-existe" });
    expect(await screen.findByRole("header", { name: "Página no encontrada" })).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: "Volver al inicio" }));
    expect(await screen.findByText("Explora la aplicación")).toBeOnTheScreen();
    expect(navigation.getPathname()).toBe("/login");
  });
});
