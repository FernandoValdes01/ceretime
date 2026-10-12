import path from "node:path";
import { router } from "expo-router";
import { act, fireEvent, renderRouter, screen, waitFor } from "expo-router/testing-library";

const appDirectory = path.resolve(__dirname, "../app");
const roleCases = [
  ["Estudiante", "/estudiante", "Inicio de Estudiante"],
  ["Profesional", "/profesional", "Jueves, 24 de Octubre"],
  ["Practicante", "/practicante/asignaciones", "Acompañamientos asignados"],
  ["Administrador", "/administrador", "Inicio de Administrador"],
] as const;

describe("Navegación principal", () => {
  test("el arranque sin sesión muestra el selector de roles", async () => {
    const navigation = renderRouter(appDirectory);
    expect(await screen.findByText("Explora la aplicación")).toBeOnTheScreen();
    expect(navigation.getPathname()).toBe("/login");
  });

  test.each(roleCases)(
    "%s puede entrar y salir sin conservar historial protegido",
    async (label, href, title) => {
      const navigation = renderRouter(appDirectory);
      const loginButton = await screen.findByRole("button", { name: `Entrar como ${label}` });
      await act(async () => {
        fireEvent.press(loginButton);
        await Promise.resolve();
      });
      await waitFor(() => expect(screen.getByText(title)).toBeOnTheScreen());
      expect(navigation.getPathname()).toBe(href);

      await act(async () => {
        fireEvent.press(screen.getByRole("button", { name: "Cerrar sesión" }));
        await Promise.resolve();
      });
      await waitFor(() => expect(screen.getByText("Explora la aplicación")).toBeOnTheScreen());
      expect(navigation.getPathname()).toBe("/login");
      expect(router.canGoBack()).toBe(false);
    },
  );

  test.each(roleCases)("%s abre el centro común desde el header", async (label) => {
    const navigation = renderRouter(appDirectory);
    fireEvent.press(await screen.findByRole("button", { name: `Entrar como ${label}` }));
    const preferencesButton = await screen.findByRole("button", {
      name: "Preferencias de accesibilidad",
    });
    await act(async () => {
      fireEvent.press(preferencesButton);
      await Promise.resolve();
    });

    expect(await screen.findByText("Preferencias de accesibilidad")).toBeOnTheScreen();
    expect(navigation.getPathname()).toBe("/preferencias");
    expect(screen.queryByRole("button", { name: "Preferencias de accesibilidad" })).toBeNull();

    fireEvent.press(screen.getByRole("button", { name: "Volver" }));
    await waitFor(() => expect(navigation.getPathname()).not.toBe("/preferencias"));
    expect(navigation.getPathname()).toBe(roleCases.find(([role]) => role === label)?.[1]);
  });

  test("una ruta directa al centro de preferencias sin sesión vuelve al acceso", async () => {
    const navigation = renderRouter(appDirectory, { initialUrl: "/preferencias" });
    expect(await screen.findByText("Explora la aplicación")).toBeOnTheScreen();
    expect(navigation.getPathname()).toBe("/login");
  });

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
    async (label, href, title) => {
      const navigation = renderRouter(appDirectory);
      const loginButton = await screen.findByRole("button", { name: `Entrar como ${label}` });
      await act(async () => {
        fireEvent.press(loginButton);
        await Promise.resolve();
      });
      await waitFor(() => expect(screen.getByText(title)).toBeOnTheScreen());

      for (const [, otherHref, otherTitle] of roleCases) {
        if (otherHref === href) continue;
        await act(async () => {
          router.push(otherHref);
          await Promise.resolve();
        });
        await waitFor(() => expect(navigation.getPathname()).toBe(href));
        expect(screen.getByText("Acceso denegado")).toBeOnTheScreen();
        expect(screen.queryByText(otherTitle)).not.toBeOnTheScreen();
      }
    },
  );

  test.each([
    ["Estudiante", ["Inicio", "Solicitudes", "Perfil"]],
    ["Profesional", ["Agenda", "Solicitudes", "Acompañamientos", "Perfil"]],
    ["Practicante", ["Inicio", "Perfil"]],
    ["Administrador", ["Inicio", "Usuarios", "Perfil"]],
  ] as const)("%s anuncia nombre, pestaña y posición en iOS", async (role, labels) => {
    renderRouter(appDirectory);
    fireEvent.press(await screen.findByRole("button", { name: `Entrar como ${role}` }));
    for (const [index, label] of labels.entries()) {
      expect(
        await screen.findByRole("button", {
          name: `${label}, pestaña, ${index + 1} de ${labels.length}`,
        }),
      ).toBeOnTheScreen();
    }
  });

  test("divide visualmente las pestañas largas sin perder los nombres completos", async () => {
    renderRouter(appDirectory);
    fireEvent.press(await screen.findByRole("button", { name: "Entrar como Profesional" }));

    expect(
      await screen.findByText("Solicitudes".slice(0, 8) + "\u200B" + "Solicitudes".slice(8)),
    ).toBeOnTheScreen();
    expect(
      screen.getByText("Acompañamientos".slice(0, 7) + "\u200B" + "Acompañamientos".slice(7)),
    ).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Solicitudes, pestaña, 2 de 4" })).toBeOnTheScreen();
    expect(
      screen.getByRole("button", { name: "Acompañamientos, pestaña, 3 de 4" }),
    ).toBeOnTheScreen();
  });

  test("una dirección inexistente ofrece volver al acceso", async () => {
    const navigation = renderRouter(appDirectory, { initialUrl: "/no-existe" });
    expect(await screen.findByRole("header", { name: "Página no encontrada" })).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: "Volver al inicio" }));
    expect(await screen.findByText("Explora la aplicación")).toBeOnTheScreen();
    expect(navigation.getPathname()).toBe("/login");
  });
});
