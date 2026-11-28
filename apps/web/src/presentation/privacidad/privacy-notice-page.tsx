import { Fragment, useEffect, useRef, type Ref } from "react";
import { Link } from "@tanstack/react-router";
import {
  FOCUS_CLASS,
  HEADING_RESET_CLASS,
  LINK_CLASS,
  PAGE_CLASS,
  PAGE_TITLE_CLASS,
  SECTION_TITLE_CLASS,
} from "../estudiante/student-page-classes.ts";
import { noticeInlineText, type NoticeBlock, type NoticeInline } from "./notice-document.ts";
import { PRIVACY_NOTICE_BLOCKS } from "./privacy-notice.ts";

/**
 * Aviso de privacidad público (TI2-171), en `/privacidad`.
 *
 * Se alcanza sin iniciar sesión: no consulta el Backend ni depende del rol.
 * El texto, la fecha y la versión salen de `docs/privacidad-aviso.md`, que
 * declara que es un borrador no aprobado por la UCT y marca cada decisión
 * institucional como «Pendiente»; la Web no agrega ni quita contenido. Las
 * celdas «Pendiente» se destacan con texto y borde, no solo con color, para
 * que las decisiones sin tomar se identifiquen como tales.
 */

/** El título del documento es el de la página y recibe el foco al entrar. */
const firstHeadingIndex = PRIVACY_NOTICE_BLOCKS.findIndex(
  (block) => block.kind === "heading" && block.level === 1,
);

const PENDING = "Pendiente";

export function PrivacyNoticePage() {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <article aria-labelledby="privacy-notice-title" className={`${PAGE_CLASS} py-8`}>
      {PRIVACY_NOTICE_BLOCKS.map((block, index) => (
        <NoticeBlockView
          // El documento es estático: la posición identifica cada bloque.
          key={index}
          block={block}
          headingRef={index === firstHeadingIndex ? headingRef : undefined}
        />
      ))}
      <p className="m-0">
        <Link to="/" className={LINK_CLASS}>
          Volver al inicio
        </Link>
      </p>
    </article>
  );
}

function NoticeBlockView({
  block,
  headingRef,
}: {
  block: NoticeBlock;
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  switch (block.kind) {
    case "heading":
      if (block.level === 1) {
        return (
          <h1
            id="privacy-notice-title"
            ref={headingRef}
            tabIndex={-1}
            className={`${PAGE_TITLE_CLASS} ${FOCUS_CLASS}`}
          >
            <NoticeText content={block.content} />
          </h1>
        );
      }
      if (block.level === 2) {
        return (
          <h2 className={`${SECTION_TITLE_CLASS} mt-4!`}>
            <NoticeText content={block.content} />
          </h2>
        );
      }
      return (
        <h3 className={`${HEADING_RESET_CLASS} text-lg! font-semibold! text-on-surface!`}>
          <NoticeText content={block.content} />
        </h3>
      );
    case "paragraph":
      return (
        <p className="m-0 text-base text-on-surface">
          <NoticeText content={block.content} />
        </p>
      );
    case "list":
      return (
        <ul className="m-0 flex flex-col gap-2 pl-6 text-base text-on-surface">
          {block.items.map((item, index) => (
            <li key={index}>
              <NoticeText content={item} />
            </li>
          ))}
        </ul>
      );
    case "table":
      return <NoticeTable header={block.header} rows={block.rows} />;
  }
}

/**
 * Tabla del aviso. En pantallas angostas se desplaza dentro de su propio
 * contenedor, que recibe el foco para poder recorrerla con el teclado, en vez
 * de desbordar la página.
 */
function NoticeTable({
  header,
  rows,
}: {
  header: readonly NoticeInline[][];
  rows: readonly NoticeInline[][][];
}) {
  const label = header.map(noticeInlineText).join(", ");
  return (
    <div
      role="region"
      aria-label={`Tabla: ${label}`}
      tabIndex={0}
      className={`max-w-full overflow-x-auto rounded-lg border border-border-low ${FOCUS_CLASS}`}
    >
      <table className="w-full min-w-[36rem] border-collapse text-left text-base text-on-surface">
        <thead className="bg-surface-container-low">
          <tr>
            {header.map((cell, index) => (
              <th key={index} scope="col" className="p-3 align-top font-semibold">
                <NoticeText content={cell} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="border-t border-border-low">
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className="p-3 align-top">
                  {noticeInlineText(cell) === PENDING ? (
                    <span className="inline-flex rounded-full border-2 border-tertiary px-2 py-0.5 text-sm font-bold">
                      {PENDING}
                    </span>
                  ) : (
                    <NoticeText content={cell} />
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function NoticeText({ content }: { content: readonly NoticeInline[] }) {
  return (
    <>
      {content.map((part, index) => (
        <Fragment key={index}>
          {part.kind === "strong" ? (
            <strong>{part.text}</strong>
          ) : part.kind === "code" ? (
            <code className="rounded bg-surface-container px-1">{part.text}</code>
          ) : part.kind === "link" ? (
            <a href={part.href} className="font-semibold text-primary underline">
              {part.text}
            </a>
          ) : (
            part.text
          )}
        </Fragment>
      ))}
    </>
  );
}
