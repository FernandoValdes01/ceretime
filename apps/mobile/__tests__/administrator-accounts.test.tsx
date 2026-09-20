import type { PractitionerAccount } from "@/application/administrator-account-models";
import type { AdministratorAccountsPort } from "@/application/administrator-accounts-port";
import { createMockAdministratorAccountsAdapter } from "@/infrastructure/mock-administrator-accounts-adapter";
import {
  useAdministratorAccounts,
  type AdministratorAccountsState,
} from "@/presentation/hooks/use-administrator-accounts";
import { fireEvent, renderRouter, screen } from "expo-router/testing-library";
import path from "node:path";
import React from "react";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";

const appDirectory = path.resolve(__dirname, "../app");

function ProbeOutput({ value: _value }: { readonly value: unknown }): null {
  return null;
}

function mountAccounts(port: AdministratorAccountsPort): {
  readonly renderer: ReactTestRenderer;
  readonly getState: () => AdministratorAccountsState;
} {
  function Probe() {
    return React.createElement(ProbeOutput, { value: useAdministratorAccounts(port) });
  }

  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(React.createElement(Probe));
  });
  return {
    renderer,
    getState: () => renderer.root.findByType(ProbeOutput).props.value as AdministratorAccountsState,
  };
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("habilitación administrativa de cuentas", () => {
  test("habilita una cuenta institucional pendiente", async () => {
    const adapter = createMockAdministratorAccountsAdapter();

    const accounts = await adapter.readPractitionerAccounts();
    expect(accounts[0]).toMatchObject({
      id: "practitioner-account-1",
      email: "camila.soto@alu.uct.cl",
      status: "pending",
    });

    const receipt = await adapter.enablePractitionerAccount("practitioner-account-1");
    expect(receipt.account.status).toBe("enabled");
    expect(receipt.message).toBe("La cuenta institucional quedó habilitada.");

    await expect(adapter.readPractitionerAccounts()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "practitioner-account-1", status: "enabled" }),
      ]),
    );
  });

  test("rechaza habilitar una cuenta que ya está habilitada", async () => {
    const adapter = createMockAdministratorAccountsAdapter();

    await adapter.enablePractitionerAccount("practitioner-account-1");

    await expect(adapter.enablePractitionerAccount("practitioner-account-1")).rejects.toThrow(
      "La cuenta institucional ya está habilitada.",
    );
  });

  test("conserva pendiente una cuenta no institucional", async () => {
    const adapter = createMockAdministratorAccountsAdapter();

    await expect(adapter.enablePractitionerAccount("practitioner-account-2")).rejects.toThrow(
      "Solo puedes habilitar cuentas institucionales @alu.uct.cl.",
    );

    const accounts = await adapter.readPractitionerAccounts();
    expect(accounts[1]).toMatchObject({
      id: "practitioner-account-2",
      email: "matias.vera@example.com",
      status: "pending",
    });
  });

  test("ignora una segunda habilitación mientras la primera sigue pendiente", async () => {
    const account: PractitionerAccount = {
      id: "pending-account",
      displayName: "Cuenta de prueba",
      email: "cuenta.prueba@alu.uct.cl",
      status: "pending",
    };
    let resolveEnable!: (value: {
      readonly account: PractitionerAccount;
      readonly message: string;
    }) => void;
    const pendingEnablement = new Promise<{
      readonly account: PractitionerAccount;
      readonly message: string;
    }>((resolve) => {
      resolveEnable = resolve;
    });
    const port: AdministratorAccountsPort = {
      readPractitionerAccounts: jest.fn(async () => [account]),
      enablePractitionerAccount: jest.fn(() => pendingEnablement),
    };
    const mounted = mountAccounts(port);
    await settle();

    let firstEnablement!: Promise<void>;
    let secondEnablement!: Promise<void>;
    act(() => {
      firstEnablement = mounted.getState().enableAccount(account.id);
      secondEnablement = mounted.getState().enableAccount(account.id);
    });
    expect(port.enablePractitionerAccount).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveEnable({
        account: { ...account, status: "enabled" },
        message: "La cuenta institucional quedó habilitada.",
      });
      await Promise.all([firstEnablement, secondEnablement]);
    });
    expect(mounted.getState().accounts[0]?.status).toBe("enabled");
    act(() => mounted.renderer.unmount());
  });

  test("muestra un error de lectura y permite reintentar hasta el estado vacío", async () => {
    let attempts = 0;
    const port: AdministratorAccountsPort = {
      readPractitionerAccounts: jest.fn(() => {
        attempts += 1;
        return attempts === 1
          ? Promise.reject(new Error("No pudimos cargar las cuentas institucionales."))
          : Promise.resolve([]);
      }),
      enablePractitionerAccount: jest.fn(),
    };
    const mounted = mountAccounts(port);

    await settle();
    expect(mounted.getState().status).toBe("error");
    expect(mounted.getState().error).toEqual(
      new Error("No pudimos cargar las cuentas institucionales."),
    );

    act(() => mounted.getState().reload());
    expect(mounted.getState().status).toBe("loading");
    await settle();
    expect(mounted.getState().status).toBe("empty");
    expect(attempts).toBe(2);
    act(() => mounted.renderer.unmount());
  });
});

describe("flujo administrativo", () => {
  test("recorre Inicio hacia la habilitación de cuentas", async () => {
    const navigation = renderRouter(appDirectory);

    fireEvent.press(await screen.findByRole("button", { name: "Entrar como Administrador" }));
    fireEvent.press(await screen.findByRole("button", { name: "Abrir habilitación de cuentas" }));

    expect(
      await screen.findByRole("header", { name: "Habilitación de cuentas" }),
    ).toBeOnTheScreen();
    expect(navigation.getPathname()).toBe("/administrador/usuarios");
    expect(
      screen.getByText(
        "Habilitar una cuenta permite entrar al área de gestión. No concede acceso a acompañamientos.",
      ),
    ).toBeOnTheScreen();
  });

  test("habilita una cuenta y confirma el nuevo estado", async () => {
    renderRouter(appDirectory);

    fireEvent.press(await screen.findByRole("button", { name: "Entrar como Administrador" }));
    fireEvent.press(await screen.findByRole("button", { name: "Abrir habilitación de cuentas" }));

    expect(await screen.findByText("Camila Soto")).toBeOnTheScreen();
    fireEvent.press(screen.getByRole("button", { name: "Habilitar cuenta de Camila Soto" }));

    expect(await screen.findByText("Cuenta habilitada")).toBeOnTheScreen();
    expect(screen.getByText("La cuenta institucional quedó habilitada.")).toBeOnTheScreen();
    expect(
      screen.queryByRole("button", { name: "Habilitar cuenta de Camila Soto" }),
    ).not.toBeOnTheScreen();
  });

  test("muestra un error controlado y permite reintentar la habilitación", async () => {
    renderRouter(appDirectory);

    fireEvent.press(await screen.findByRole("button", { name: "Entrar como Administrador" }));
    fireEvent.press(await screen.findByRole("button", { name: "Abrir habilitación de cuentas" }));

    expect(await screen.findByText("Matías Vera")).toBeOnTheScreen();
    const enableButton = screen.getByRole("button", {
      name: "Habilitar cuenta de Matías Vera",
    });
    fireEvent.press(enableButton);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Solo puedes habilitar cuentas institucionales @alu.uct.cl.",
    );
    expect(screen.getByLabelText("Estado: Pendiente")).toBeOnTheScreen();
    expect(enableButton).toBeEnabled();
  });
});
