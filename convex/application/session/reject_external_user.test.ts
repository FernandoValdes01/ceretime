import { describe, expect, test } from "vitest";
import { rejectExternalUser } from "./reject_external_user";

describe("rejectExternalUser", () => {
  test("rechaza correos fuera de la institución", async () => {
    await expect(rejectExternalUser("a@gmail.com")).resolves.toBe(false);
    await expect(rejectExternalUser("a@uct.cl.evil.com")).resolves.toBe(false);
    await expect(rejectExternalUser(null)).resolves.toBe(false);
  });

  test("permite ambos dominios institucionales", async () => {
    await expect(rejectExternalUser("a@alu.uct.cl")).resolves.toBeUndefined();
    await expect(rejectExternalUser("b@uct.cl")).resolves.toBeUndefined();
  });
});
