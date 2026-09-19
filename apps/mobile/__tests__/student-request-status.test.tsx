import { render, screen } from "@testing-library/react-native";

import type { StudentRequestStatus } from "@/application/student-area-models";
import {
  getStudentRequestStatusPresentation,
  StudentRequestStatusIndicator,
} from "@/presentation/estudiante/student-request-status-indicator";

jest.mock("lucide-react-native", () => {
  const React = require("react") as typeof import("react");
  const { View } = require("react-native") as typeof import("react-native");
  const MockIcon = (props: Record<string, unknown>) => React.createElement(View, props);

  return new Proxy(
    {},
    {
      get: () => MockIcon,
    },
  );
});

const statusCases = [
  ["received", "Recibida", "arrowDown"],
  ["underReview", "En revisión", "clock"],
  ["awaitingInformationOrAcceptance", "Esperando información o aceptación", "alert"],
  ["accepted", "Aceptada", "circleCheck"],
  ["referred", "Derivada", "arrowRight"],
  ["closedWithoutAccompaniment", "Cerrada sin acompañamiento", "circleX"],
  ["cancelled", "Cancelada", "minus"],
] as const satisfies readonly (readonly [StudentRequestStatus, string, string])[];

describe("Estado accesible de la solicitud", () => {
  test.each(statusCases)("presenta %s como texto y señal gráfica", (status, label, icon) => {
    render(<StudentRequestStatusIndicator status={status} />);

    expect(screen.getByText("Estado de la solicitud")).toHaveProp("accessible", false);
    expect(screen.getByText("Estado de la solicitud")).toHaveProp("selectable", false);
    expect(screen.getByText(label)).toHaveProp("selectable", true);
    expect(getStudentRequestStatusPresentation(status).icon).toBe(icon);
    expect(
      screen.getByTestId(`student-request-status-icon-${icon}`, { includeHiddenElements: true }),
    ).toHaveProp("accessible", false);
    expect(screen.getByLabelText(`Estado de la solicitud: ${label}`)).toHaveProp(
      "accessibilityRole",
      "text",
    );
  });

  test("cada estado usa una señal gráfica distinta", () => {
    const icons = statusCases.map(([status]) => getStudentRequestStatusPresentation(status).icon);

    expect(new Set(icons).size).toBe(statusCases.length);
  });
});
