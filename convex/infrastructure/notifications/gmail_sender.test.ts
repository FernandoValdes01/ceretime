import { describe, expect, test, vi } from "vitest";
import {
  composeGmailRawMessage,
  gmailEmailSender,
  gmailSenderConfigFromEnv,
  type GmailSenderConfig,
} from "./gmail_sender";

const CONFIG: GmailSenderConfig = {
  clientId: "client-id-ficticio",
  clientSecret: "client-secret-ficticio",
  refreshToken: "refresh-token-ficticio",
  senderAddress: "remitente@alu.uct.cl",
};

function decodeBase64(value: string): string {
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function decodeBase64Url(value: string): string {
  const padded = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(value.length + ((4 - (value.length % 4)) % 4), "=");
  return decodeBase64(padded);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("adaptador de correo Gmail (TI2-159)", () => {
  test("devuelve null cuando falta alguna credencial de entorno", () => {
    expect(gmailSenderConfigFromEnv({})).toBeNull();
    expect(
      gmailSenderConfigFromEnv({
        GOOGLE_CLIENT_ID: "id",
        GOOGLE_CLIENT_SECRET: "secret",
        GMAIL_SENDER_ADDRESS: "remitente@alu.uct.cl",
      }),
    ).toBeNull();
  });

  test("normaliza la lista de destinos de prueba habilitados", () => {
    const config = gmailSenderConfigFromEnv({
      GOOGLE_CLIENT_ID: " id ",
      GOOGLE_CLIENT_SECRET: " secret ",
      GMAIL_SENDER_ADDRESS: " remitente@alu.uct.cl ",
      GMAIL_SENDER_REFRESH_TOKEN: " token ",
      EMAIL_ALLOWED_RECIPIENTS: " Uno@Alu.Uct.Cl , dos@uct.cl , ",
    });
    expect(config).toEqual({
      clientId: "id",
      clientSecret: "secret",
      senderAddress: "remitente@alu.uct.cl",
      refreshToken: "token",
      allowedRecipients: ["uno@alu.uct.cl", "dos@uct.cl"],
    });
  });

  test("compone un mensaje RFC 5322 genérico sin mencionar CERETI", () => {
    const raw = composeGmailRawMessage("remitente@alu.uct.cl", {
      to: "prueba@alu.uct.cl",
      subject: "Tienes una atención programada",
      text: "Revisa el detalle en la aplicación.",
    });
    const decoded = decodeBase64Url(raw);
    expect(decoded).toContain("From: remitente@alu.uct.cl\r\n");
    expect(decoded).toContain("To: prueba@alu.uct.cl\r\n");
    expect(decoded).toContain('Content-Type: text/plain; charset="UTF-8"\r\n');
    expect(decoded.toLowerCase()).not.toContain("cereti");

    const [, bodyBase64] = decoded.split("\r\n\r\n");
    expect(decodeBase64(bodyBase64 ?? "")).toBe("Revisa el detalle en la aplicación.");
  });

  test("sin configuración responde not_configured sin llamar a la red", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const sender = gmailEmailSender(null, fetchMock);
    const result = await sender.send({
      to: "prueba@alu.uct.cl",
      subject: "Tienes una actualización pendiente",
      text: "Revisa las novedades en la aplicación.",
    });
    expect(result).toEqual({ status: "failed", errorCode: "not_configured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("rechaza destinos inválidos o fuera de la lista de prueba sin llamar a Google", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const sender = gmailEmailSender(
      { ...CONFIG, allowedRecipients: ["permitido@alu.uct.cl"] },
      fetchMock,
    );

    await expect(
      sender.send({ to: "no-es-correo", subject: "Aviso", text: "Cuerpo" }),
    ).resolves.toEqual({ status: "failed", errorCode: "invalid_destination" });
    await expect(
      sender.send({ to: "otro@alu.uct.cl", subject: "Aviso", text: "Cuerpo" }),
    ).resolves.toEqual({ status: "failed", errorCode: "invalid_destination" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("canjea el token y envía el correo por la API de Gmail", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ access_token: "access-ficticio" }))
      .mockResolvedValueOnce(jsonResponse({ id: "gmail-msg-1" }));
    const sender = gmailEmailSender(CONFIG, fetchMock);

    const result = await sender.send({
      to: "destino@alu.uct.cl",
      subject: "Tienes una actualización pendiente",
      text: "Revisa las novedades en la aplicación.",
    });

    expect(result).toEqual({ status: "sent" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://oauth2.googleapis.com/token");
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    );
    const sendInit = fetchMock.mock.calls[1]?.[1];
    expect(sendInit?.headers).toMatchObject({ Authorization: "Bearer access-ficticio" });
  });

  test("traduce un refresh token vencido o revocado a not_authorized", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ error: "invalid_grant" }, 400));
    const sender = gmailEmailSender(CONFIG, fetchMock);

    await expect(
      sender.send({
        to: "destino@alu.uct.cl",
        subject: "Tienes una actualización pendiente",
        text: "Revisa las novedades en la aplicación.",
      }),
    ).resolves.toEqual({ status: "failed", errorCode: "not_authorized" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("traduce 403 de Gmail a not_authorized y 5xx o caída de red a provider_unavailable", async () => {
    const forbiddenFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ access_token: "access-ficticio" }))
      .mockResolvedValueOnce(jsonResponse({ error: { message: "Forbidden" } }, 403));
    await expect(
      gmailEmailSender(CONFIG, forbiddenFetch).send({
        to: "destino@alu.uct.cl",
        subject: "Aviso",
        text: "Cuerpo",
      }),
    ).resolves.toEqual({ status: "failed", errorCode: "not_authorized" });

    const serverErrorFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ access_token: "access-ficticio" }))
      .mockResolvedValueOnce(jsonResponse({}, 503));
    await expect(
      gmailEmailSender(CONFIG, serverErrorFetch).send({
        to: "destino@alu.uct.cl",
        subject: "Aviso",
        text: "Cuerpo",
      }),
    ).resolves.toEqual({ status: "failed", errorCode: "provider_unavailable" });

    const networkErrorFetch = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error("ECONNRESET"));
    await expect(
      gmailEmailSender(CONFIG, networkErrorFetch).send({
        to: "destino@alu.uct.cl",
        subject: "Aviso",
        text: "Cuerpo",
      }),
    ).resolves.toEqual({ status: "failed", errorCode: "provider_unavailable" });
  });
});
