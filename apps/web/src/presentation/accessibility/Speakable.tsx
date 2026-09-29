import type { ReactNode } from "react";
import { useAccessibility } from "./accessibility-context.ts";

/**
 * Envuelve un texto para escucharlo al tocarlo cuando la lectura en voz
 * alta está activada. Sin activar, renderiza el elemento normal.
 */
export function Speakable({
  children,
  text,
  className,
  as: Tag = "p",
}: {
  children: ReactNode;
  text: string;
  className?: string;
  as?: "div" | "section" | "p" | "article";
}) {
  const { readAloud, speak } = useAccessibility();

  if (!readAloud) {
    return <Tag className={className}>{children}</Tag>;
  }

  return (
    <Tag
      className={className}
      onClick={() => speak(text)}
      role="button"
      tabIndex={0}
      onKeyDown={(event: React.KeyboardEvent) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          speak(text);
        }
      }}
      aria-label={`Leer en voz alta: ${text}`}
      style={{ cursor: "pointer" }}
    >
      {children}
    </Tag>
  );
}
