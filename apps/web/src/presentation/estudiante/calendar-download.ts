/**
 * Descarga del archivo `.ics` de una atención (TI2-122).
 *
 * Presentación: crea un Blob local con el contenido ya autorizado por Convex y
 * dispara la descarga con un enlace temporal. No construye URLs del backend ni
 * incluye tokens; el nombre del archivo viene del contrato de Dominio.
 */

export interface DownloadableCalendarFile {
  readonly fileName: string;
  readonly content: string;
}

export function downloadCalendarFile(file: DownloadableCalendarFile): void {
  const blob = new Blob([file.content], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.fileName;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
