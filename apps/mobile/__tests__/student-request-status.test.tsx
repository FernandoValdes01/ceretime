import { render, screen } from "@testing-library/react-native";

import type { StudentRequestStatus } from "@/application/student-area-models";
import {
  getStudentRequestStatusPresentation,
  StudentRequestStatusIndicator,
} from "@/presentation/estudiante/student-request-status-indicator";

const statusCases = [
  ["received", "Recibida", "↓"],
  ["underReview", "En revisión", "◷"],
  ["awaitingInformationOrAcceptance", "Esperando información o aceptación", "!"],
  ["accepted", "Aceptada", "✓"],
  ["referred", "Derivada", "→"],
  ["closedWithoutAccompaniment", "Cerrada sin acompañamiento", "×"],
  ["cancelled", "Cancelada", "−"],
] as const satisfies readonly (readonly [StudentRequestStatus, string, string])[];

describe("Estado accesible de la solicitud", () => {
  test.each(statusCases)("presenta %s como texto y señal gráfica", (status, label, symbol) => {
    render(<StudentRequestStatusIndicator status={status} />);

    expect(screen.getByText("Estado de la solicitud")).toHaveProp("accessible", false);
    expect(screen.getByText("Estado de la solicitud")).toHaveProp("selectable", false);
    expect(screen.getByText(label)).toHaveProp("selectable", true);
    expect(screen.getByText(symbol, { includeHiddenElements: true })).toHaveProp(
      "accessible",
      false,
    );
    expect(screen.getByLabelText(`Estado de la solicitud: ${label}`)).toHaveProp(
      "accessibilityRole",
      "text",
    );
  });

  test("cada estado usa una señal gráfica distinta", () => {
    const symbols = statusCases.map(
      ([status]) => getStudentRequestStatusPresentation(status).symbol,
    );

    expect(new Set(symbols).size).toBe(statusCases.length);
  });
});
