// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from "vitest";
import { downloadCalendarFile } from "./calendar-download.ts";

/**
 * Pruebas de la descarga local del `.ics` (TI2-122).
 *
 * No construyen URLs del backend ni tocan red: comprueban que el Blob se
 * descarga con el nombre del contrato y que la URL temporal se revoca después
 * del turno del clic.
 */

describe("downloadCalendarFile", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  test("descarga el contenido y revoca la URL en el siguiente turno", () => {
    vi.useFakeTimers();
    const createObjectURL = vi.fn(() => "blob:atencion");
    const revokeObjectURL = vi.fn();
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    try {
      downloadCalendarFile({
        fileName: "atencion-programada.ics",
        content: "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n",
      });

      expect(createObjectURL).toHaveBeenCalledOnce();
      expect(click).toHaveBeenCalledOnce();
      expect(revokeObjectURL).not.toHaveBeenCalled();

      vi.runAllTimers();
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:atencion");
    } finally {
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
    }
  });
});
