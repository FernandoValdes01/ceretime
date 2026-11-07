// Puertos del Estudiante: leer su área (solicitudes y acompañamientos) y enviar una solicitud nueva.
import type {
  StudentAreaSnapshot,
  StudentRequestSubmissionReceipt,
  SubmitStudentRequestCommand,
} from "../domain/student-area-models";

/** Lectura del área estudiantil, sin dependencias de React ni del transporte. */
export interface StudentAreaReader {
  readStudentArea(): Promise<StudentAreaSnapshot>;
  subscribe?(onChange: () => void): () => void;
}

/** Envío de contenido completo. La composición actual selecciona un simulador local. */
export interface StudentRequestSubmitter {
  submitStudentRequest(
    command: SubmitStudentRequestCommand,
  ): Promise<StudentRequestSubmissionReceipt>;
}
