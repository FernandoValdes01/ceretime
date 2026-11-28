/**
 * Lectura del aviso de privacidad (TI2-171).
 *
 * La fuente única del aviso es `docs/privacidad-aviso.md`, que redacta
 * TI2-139: la Web lo importa como texto y lo convierte en bloques, así el
 * texto publicado no se copia a otro archivo y cada cambio del aviso llega a
 * la Web sin tocar código. Solo cubre el Markdown que usa ese documento:
 * títulos, párrafos, listas, tablas, negrita, código y enlaces.
 *
 * Los enlaces `https:` se conservan. Los enlaces relativos apuntan a otros
 * documentos del repositorio, que la Web no publica: con `documentsBaseUrl`
 * se resuelven contra esa dirección y, sin ella, se muestran como texto.
 * Cualquier otro esquema queda como texto.
 */

export type NoticeInline =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "strong"; readonly text: string }
  | { readonly kind: "code"; readonly text: string }
  | { readonly kind: "link"; readonly text: string; readonly href: string };

export type NoticeBlock =
  | { readonly kind: "heading"; readonly level: 1 | 2 | 3; readonly content: NoticeInline[] }
  | { readonly kind: "paragraph"; readonly content: NoticeInline[] }
  | { readonly kind: "list"; readonly items: NoticeInline[][] }
  | {
      readonly kind: "table";
      readonly header: NoticeInline[][];
      readonly rows: NoticeInline[][][];
    };

const INLINE_PATTERN = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/;

/** Dirección segura de un enlace, o `null` si debe quedar como texto. */
function resolveNoticeHref(href: string, documentsBaseUrl: string | undefined): string | null {
  if (href.startsWith("https://")) return href;
  const relative = !href.includes(":") && !href.startsWith("/") && !href.startsWith("#");
  if (!relative || documentsBaseUrl === undefined) return null;
  return new URL(href, documentsBaseUrl).href;
}

/** Convierte el texto de una línea en fragmentos con su formato. */
export function parseNoticeInline(text: string, documentsBaseUrl?: string): NoticeInline[] {
  const parts: NoticeInline[] = [];
  for (const piece of text.split(INLINE_PATTERN)) {
    if (piece === "") continue;
    if (piece.startsWith("**") && piece.endsWith("**") && piece.length > 4) {
      parts.push({ kind: "strong", text: piece.slice(2, -2) });
      continue;
    }
    if (piece.startsWith("`") && piece.endsWith("`") && piece.length > 2) {
      parts.push({ kind: "code", text: piece.slice(1, -1) });
      continue;
    }
    const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(piece);
    if (link !== null) {
      const [, label, href] = link;
      const resolved = resolveNoticeHref(href, documentsBaseUrl);
      parts.push(
        resolved === null
          ? { kind: "text", text: label }
          : { kind: "link", text: label, href: resolved },
      );
      continue;
    }
    parts.push({ kind: "text", text: piece });
  }
  return parts;
}

/** Texto plano de los fragmentos, para comparar o anunciar. */
export function noticeInlineText(content: readonly NoticeInline[]): string {
  return content.map((part) => part.text).join("");
}

function stripFrontmatter(lines: string[]): string[] {
  if (lines[0]?.trim() !== "---") return lines;
  const end = lines.indexOf("---", 1);
  return end === -1 ? lines : lines.slice(end + 1);
}

function tableCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

const TABLE_SEPARATOR = /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?$/;

/** Convierte el documento en bloques, en el mismo orden. */
export function parseNoticeDocument(markdown: string, documentsBaseUrl?: string): NoticeBlock[] {
  const inline = (text: string) => parseNoticeInline(text, documentsBaseUrl);
  const lines = stripFrontmatter(markdown.replace(/\r\n/g, "\n").split("\n"));
  const blocks: NoticeBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index].trim();
    if (line === "") {
      index += 1;
      continue;
    }

    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading !== null) {
      const level = heading[1].length as 1 | 2 | 3;
      blocks.push({ kind: "heading", level, content: inline(heading[2]) });
      index += 1;
      continue;
    }

    if (line.startsWith("|") && TABLE_SEPARATOR.test(lines[index + 1]?.trim() ?? "")) {
      const header = tableCells(line).map(inline);
      const rows: NoticeInline[][][] = [];
      index += 2;
      while (index < lines.length && lines[index].trim().startsWith("|")) {
        rows.push(tableCells(lines[index]).map(inline));
        index += 1;
      }
      blocks.push({ kind: "table", header, rows });
      continue;
    }

    if (line.startsWith("- ")) {
      const items: NoticeInline[][] = [];
      while (index < lines.length && lines[index].trim().startsWith("- ")) {
        items.push(inline(lines[index].trim().slice(2)));
        index += 1;
      }
      blocks.push({ kind: "list", items });
      continue;
    }

    // Un párrafo une sus líneas consecutivas hasta una línea vacía u otro bloque.
    const paragraph: string[] = [];
    while (index < lines.length) {
      const current = lines[index].trim();
      if (current === "" || /^(#{1,3}\s|- |\|)/.test(current)) break;
      paragraph.push(current);
      index += 1;
    }
    blocks.push({ kind: "paragraph", content: inline(paragraph.join(" ")) });
  }

  return blocks;
}
