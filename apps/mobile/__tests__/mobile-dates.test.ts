import { formatRequestDate } from "@/presentation/estudiante/student-request-formatters";

test("muestra un instante en el día institucional aunque UTC ya haya cambiado de día", () => {
  expect(formatRequestDate("2026-07-10T02:30:00.000Z")).toBe("9 de julio de 2026");
});

test.each([
  ["2026-09-06T03:30:00.000Z", "5 de septiembre de 2026"],
  ["2026-09-06T04:30:00.000Z", "6 de septiembre de 2026"],
])("respeta el cambio de horario de Chile para %s", (instant, expected) => {
  expect(formatRequestDate(instant)).toBe(expected);
});

test("una fecha civil conserva su día sin interpretarse como medianoche UTC", () => {
  expect(formatRequestDate("2026-07-10")).toBe("10 de julio de 2026");
});
