import { useCallback, useEffect, useRef, useState } from "react";

import type {
  StudentRequestSubmissionReceipt,
  SubmitStudentRequestCommand,
} from "@/application/student-area-models";
import type { StudentRequestSubmitter } from "@/application/student-area-port";

export type StudentRequestSubmissionStatus = "idle" | "submitting" | "error" | "success";

export interface StudentRequestSubmissionState {
  readonly status: StudentRequestSubmissionStatus;
  readonly receipt: StudentRequestSubmissionReceipt | null;
  readonly error: unknown | null;
  readonly submit: (command: SubmitStudentRequestCommand) => Promise<void>;
  readonly retry: () => Promise<void>;
}

interface SubmissionResult {
  readonly status: StudentRequestSubmissionStatus;
  readonly receipt: StudentRequestSubmissionReceipt | null;
  readonly error: unknown | null;
}

const initialResult: SubmissionResult = {
  status: "idle",
  receipt: null,
  error: null,
};

export function useSubmitStudentRequest(
  submitter: StudentRequestSubmitter,
): StudentRequestSubmissionState {
  const [result, setResult] = useState<SubmissionResult>(initialResult);
  const inFlight = useRef(false);
  const lastCommand = useRef<SubmitStudentRequestCommand | null>(null);
  const attemptId = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      attemptId.current += 1;
      inFlight.current = false;
    };
  }, []);

  const performSubmission = useCallback(
    async (command: SubmitStudentRequestCommand) => {
      if (inFlight.current) return;

      inFlight.current = true;
      const currentAttempt = ++attemptId.current;
      setResult({ status: "submitting", receipt: null, error: null });

      try {
        const receipt = await submitter.submitStudentRequest(command);
        if (mounted.current && attemptId.current === currentAttempt) {
          setResult({ status: "success", receipt, error: null });
        }
      } catch (error) {
        if (mounted.current && attemptId.current === currentAttempt) {
          setResult({ status: "error", receipt: null, error });
        }
      } finally {
        if (attemptId.current === currentAttempt) {
          inFlight.current = false;
        }
      }
    },
    [submitter],
  );

  const submit = useCallback(
    async (command: SubmitStudentRequestCommand) => {
      if (inFlight.current) return;
      lastCommand.current = command;
      await performSubmission(command);
    },
    [performSubmission],
  );

  const retry = useCallback(async () => {
    if (lastCommand.current) await performSubmission(lastCommand.current);
  }, [performSubmission]);

  return { ...result, submit, retry };
}
