// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { A11Y_STORAGE_KEY } from "./accessibility-context";
import { AccessibilityProvider } from "./AccessibilityProvider";
import { AccessibilityMenu } from "./AccessibilityMenu";
import { Speakable } from "./Speakable";

function renderMenu() {
  return render(
    <AccessibilityProvider>
      <AccessibilityMenu />
    </AccessibilityProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove("hc");
  document.documentElement.style.removeProperty("--font-scale");
});

afterEach(() => {
  cleanup();
});

describe("preferencias de accesibilidad (rescate v0)", () => {
  test("abre y cierra el panel con Escape devolviendo el foco", async () => {
    renderMenu();
    const trigger = screen.getByRole("button", { name: "Opciones de accesibilidad" });

    fireEvent.click(trigger);
    await screen.findByRole("dialog", { name: "Opciones de accesibilidad" });

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Opciones de accesibilidad" })).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  test("el tamaño Muy grande ajusta la escala y persiste", async () => {
    renderMenu();
    fireEvent.click(screen.getByRole("button", { name: "Opciones de accesibilidad" }));

    fireEvent.click(screen.getByRole("radio", { name: "Muy grande" }));
    expect(document.documentElement.style.getPropertyValue("--font-scale")).toBe("1.3");
    expect(JSON.parse(localStorage.getItem(A11Y_STORAGE_KEY) ?? "{}").textSize).toBe("muy-grande");
  });

  test("el alto contraste alterna la clase y persiste", async () => {
    renderMenu();
    fireEvent.click(screen.getByRole("button", { name: "Opciones de accesibilidad" }));

    const toggle = screen.getByRole("switch", { name: "Alto contraste" });
    fireEvent.click(toggle);
    expect(document.documentElement.classList.contains("hc")).toBe(true);
    expect(toggle.getAttribute("aria-checked")).toBe("true");

    fireEvent.click(toggle);
    expect(document.documentElement.classList.contains("hc")).toBe(false);
  });

  test("carga las preferencias guardadas al montar", async () => {
    localStorage.setItem(
      A11Y_STORAGE_KEY,
      JSON.stringify({ textSize: "grande", highContrast: true }),
    );
    renderMenu();

    expect(document.documentElement.style.getPropertyValue("--font-scale")).toBe("1.15");
    expect(document.documentElement.classList.contains("hc")).toBe(true);
  });

  test("Speakable renderiza el elemento normal sin lectura activada", () => {
    render(
      <AccessibilityProvider>
        <Speakable text="Hola" className="lead">
          Hola
        </Speakable>
      </AccessibilityProvider>,
    );

    const paragraph = screen.getByText("Hola");
    expect(paragraph.tagName).toBe("P");
    expect(paragraph.getAttribute("role")).toBeNull();
  });
});
