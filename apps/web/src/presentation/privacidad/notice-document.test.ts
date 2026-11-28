import { describe, expect, test } from "vitest";
import noticeMarkdown from "../../../../../docs/privacidad-aviso.md?raw";
import { SUBMITTABLE_PRIVACY_REQUEST_KINDS } from "../../../../../convex/domain/index.ts";
import { noticeInlineText, parseNoticeDocument, parseNoticeInline } from "./notice-document.ts";
import { privacyKindDescription } from "./privacy-notice.ts";

/**
 * Lectura del aviso de privacidad (TI2-171): la Web publica el documento de
 * TI2-139 tal como está, con su versión, su estado de borrador y sus
 * decisiones pendientes.
 */

describe("parseNoticeInline", () => {
  test("distingue negrita, código y enlaces", () => {
    expect(parseNoticeInline("**Versión:** 0.2 con `calendar.events`")).toEqual([
      { kind: "strong", text: "Versión:" },
      { kind: "text", text: " 0.2 con " },
      { kind: "code", text: "calendar.events" },
    ]);
  });

  test("un enlace a otro documento del repositorio queda como texto", () => {
    expect(parseNoticeInline("ver el [inventario](privacidad-inventario.md).")).toEqual([
      { kind: "text", text: "ver el " },
      { kind: "text", text: "inventario" },
      { kind: "text", text: "." },
    ]);
    expect(parseNoticeInline("[Agencia](https://example.cl)")).toEqual([
      { kind: "link", text: "Agencia", href: "https://example.cl" },
    ]);
  });

  test("con dirección base, un enlace relativo lleva al documento publicado", () => {
    const base = "https://example.cl/repo/docs/";
    expect(parseNoticeInline("[ley](producto/ley-21719.md)", base)).toEqual([
      { kind: "link", text: "ley", href: "https://example.cl/repo/docs/producto/ley-21719.md" },
    ]);
    expect(parseNoticeInline("[x](javascript:void)", base)).toEqual([{ kind: "text", text: "x" }]);
    expect(parseNoticeInline("[raíz](/otro.md)", base)).toEqual([{ kind: "text", text: "raíz" }]);
  });
});

describe("parseNoticeDocument", () => {
  test("omite el frontmatter y arma títulos, párrafos, listas y tablas", () => {
    const blocks = parseNoticeDocument(
      [
        "---",
        "created: 2026-11-17",
        "---",
        "",
        "# Aviso",
        "",
        "Primera línea",
        "segunda línea.",
        "",
        "- Uno",
        "- Dos",
        "",
        "| Pendiente | Estado |",
        "| --- | --- |",
        "| Algo | Pendiente |",
      ].join("\r\n"),
    );
    expect(blocks.map((block) => block.kind)).toEqual(["heading", "paragraph", "list", "table"]);
    expect(blocks[1]).toEqual({
      kind: "paragraph",
      content: [{ kind: "text", text: "Primera línea segunda línea." }],
    });
    const table = blocks[3];
    if (table.kind !== "table") throw new Error("Se esperaba una tabla.");
    expect(table.header.map(noticeInlineText)).toEqual(["Pendiente", "Estado"]);
    expect(table.rows.map((row) => row.map(noticeInlineText))).toEqual([["Algo", "Pendiente"]]);
  });

  test("el aviso del repositorio conserva su título, versión, estado y pendientes", () => {
    const blocks = parseNoticeDocument(noticeMarkdown);
    const text = blocks.map((block) =>
      block.kind === "heading" || block.kind === "paragraph" ? noticeInlineText(block.content) : "",
    );
    expect(blocks[0]).toMatchObject({ kind: "heading", level: 1 });
    expect(text[0]).toBe("Aviso de privacidad de CERETI");
    expect(text.some((line) => line.startsWith("Versión:"))).toBe(true);
    expect(text.some((line) => line.startsWith("Estado: no publicado"))).toBe(true);
    const pending = blocks.find(
      (block) =>
        block.kind === "heading" &&
        noticeInlineText(block.content) === "Pendientes antes de publicar",
    );
    expect(pending).toBeDefined();
    // Ningún bloque queda con la sintaxis cruda de Markdown.
    expect(text.some((line) => line.includes("**") || line.startsWith("#"))).toBe(false);
  });
});

describe("privacyKindDescription", () => {
  test("el aviso explica cada derecho que se ofrece al Estudiante", () => {
    for (const kind of SUBMITTABLE_PRIVACY_REQUEST_KINDS) {
      expect(privacyKindDescription(kind)).toMatch(/^\p{Lu}.+\.$/u);
    }
    expect(privacyKindDescription("access")).toBe(
      "Saber qué datos mantenemos y obtener una copia comprensible.",
    );
  });
});
