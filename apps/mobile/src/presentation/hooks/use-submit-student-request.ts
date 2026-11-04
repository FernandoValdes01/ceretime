import { useCallback, useEffect, useRef, useState } from "react";

import type {
  StudentRequestSubmissionReceipt,
  SubmitStudentRequestCommand,
} from "@/application/student-area-models";
import type { StudentRequestSubmitter } from "@/application/student-area-port";
import { toMobileOperationError } from "@/presentation/to-mobile-operation-error";

export type StudentRequestSubmissionStatus = "idle" | "submitting" | "error" | "success";

export type StudentRequestSubmissionState = SubmissionResult & {
  readonly submit: (command: SubmitStudentRequestCommand) => Promise<void>;
};

type SubmissionResult =
  | { readonly status: "idle" | "submitting"; readonly receipt: null; readonly error: null }
  | {
      readonly status: "success";
      readonly receipt: StudentRequestSubmissionReceipt;
      readonly error: null;
    }
  | { readonly status: "error"; readonly receipt: null; readonly error: Error };

const initialResult: SubmissionResult = {
  status: "idle",
  receipt: null,
  error: null,
};
const submittingResult: SubmissionResult = { status: "submitting", receipt: null, error: null };

export function useSubmitStudentRequest(
  submitter: StudentRequestSubmitter,
): StudentRequestSubmissionState {
  const [submission, setSubmission] = useState({ submitter, result: initialResult });
  const inFlight = useRef(false);
  const attemptId = useRef(0);
  const activeSubmitter = useRef<StudentRequestSubmitter | null>(submitter);

  useEffect(() => {
    activeSubmitter.current = submitter;
    return () => {
      activeSubmitter.current = null;
      attemptId.current += 1;
    };
  }, [submitter]);

  const submit = useCallback(
    async (command: SubmitStudentRequestCommand) => {
      if (activeSubmitter.current !== submitter || inFlight.current) return;

      inFlight.current = true;
      const currentAttempt = ++attemptId.current;
      setSubmission({ submitter, result: { status: "submitting", receipt: null, error: null } });

      try {
        const receipt = await submitter.submitStudentRequest(command);
        if (activeSubmitter.current === submitter && attemptId.current === currentAttempt) {
          setSubmission({ submitter, result: { status: "success", receipt, error: null } });
        }
      } catch (error) {
        if (activeSubmitter.current === submitter && attemptId.current === currentAttempt) {
          setSubmission({
            submitter,
            result: {
              status: "error",
              receipt: null,
              error: toMobileOperationError(
                error,
                "No pudimos enviar la solicitud. Intenta nuevamente.",
              ),
            },
          });
        }
      } finally {
        // Descartar la respuesta no cancela la escritura. El bloqueo dura hasta que termine.
        inFlight.current = false;
        if (activeSubmitter.current && attemptId.current !== currentAttempt) {
          setSubmission({ submitter: activeSubmitter.current, result: initialResult });
        }
      }
    },
    [submitter],
  );

  const result =
    submission.submitter === submitter
      ? submission.result
      : submission.result.status === "submitting"
        ? submittingResult
        : initialResult;
  if (submission.submitter !== submitter) setSubmission({ submitter, result });
  return { ...result, submit };
}
