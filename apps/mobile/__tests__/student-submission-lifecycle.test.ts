import { act, renderHook } from "@testing-library/react-native";
import type {
  StudentRequestSubmissionReceipt,
  SubmitStudentRequestCommand,
} from "@/domain/student-area-models";
import type { StudentRequestSubmitter } from "@/application/student-area-port";
import { useSubmitStudentRequest } from "@/presentation/hooks/use-submit-student-request";

const command: SubmitStudentRequestCommand = {
  needSummary: "Acceder al material del curso",
  expectedOutcome: "Acordar apoyos",
  accessNeeds: [{ id: "digital", label: "Material digital" }],
  modalityPreference: "online",
  generalAvailability: { preferredWeekdays: [1] },
  preferredAccessibleInformationChannel: "Correo accesible",
};
const receipt: StudentRequestSubmissionReceipt = {
  requestId: "SOL-TEST",
  receivedAt: "2026-11-03T12:00:00.000Z",
};

function pendingSubmission() {
  let resolve!: (value: StudentRequestSubmissionReceipt) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<StudentRequestSubmissionReceipt>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  const submitStudentRequest = jest.fn(() => promise);
  return { resolve, reject, submitStudentRequest };
}

test("un reemplazo del adaptador conserva el bloqueo hasta que termina el envío anterior", async () => {
  const old = pendingSubmission();
  const current = pendingSubmission();
  const { result, rerender } = renderHook(
    ({ submitter }: { submitter: StudentRequestSubmitter }) => useSubmitStudentRequest(submitter),
    { initialProps: { submitter: old } },
  );
  let oldSubmission!: Promise<void>;
  act(() => {
    oldSubmission = result.current.submit(command);
  });
  rerender({ submitter: current });
  expect(result.current.status).toBe("submitting");
  await act(async () => {
    await result.current.submit(command);
  });
  expect(current.submitStudentRequest).not.toHaveBeenCalled();
  await act(async () => {
    old.resolve({ ...receipt, requestId: "SOL-OLD" });
    await oldSubmission;
  });
  expect(result.current.status).toBe("idle");
  expect(result.current.receipt).toBeNull();
  await act(async () => {
    current.resolve(receipt);
    await result.current.submit(command);
  });
  expect(result.current.status).toBe("success");
  expect(result.current.receipt).toEqual(receipt);
});

test("volver a un adaptador anterior no recupera su comprobante", async () => {
  const first: StudentRequestSubmitter = { submitStudentRequest: async () => receipt };
  const second: StudentRequestSubmitter = { submitStudentRequest: async () => receipt };
  const { result, rerender } = renderHook(
    ({ submitter }: { submitter: StudentRequestSubmitter }) => useSubmitStudentRequest(submitter),
    { initialProps: { submitter: first } },
  );
  await act(async () => {
    await result.current.submit(command);
  });
  expect(result.current.status).toBe("success");
  rerender({ submitter: second });
  rerender({ submitter: first });
  expect(result.current.status).toBe("idle");
  expect(result.current.receipt).toBeNull();
});

test("bloquea el doble envío y permite reintentar con un error seguro", async () => {
  const pending = pendingSubmission();
  const submitter: StudentRequestSubmitter = {
    submitStudentRequest: jest
      .fn()
      .mockImplementationOnce(pending.submitStudentRequest)
      .mockResolvedValue(receipt),
  };
  const { result } = renderHook(() => useSubmitStudentRequest(submitter));
  let submission!: Promise<void>;
  act(() => {
    submission = result.current.submit(command);
    void result.current.submit(command);
  });
  expect(submitter.submitStudentRequest).toHaveBeenCalledTimes(1);
  await act(async () => {
    pending.reject(new Error("SDK token interno"));
    await submission;
  });
  expect(result.current.status).toBe("error");
  expect(result.current.error?.message).toBe("No pudimos enviar la solicitud. Intenta nuevamente.");
  expect(result.current.receipt).toBeNull();
  await act(async () => {
    await result.current.submit(command);
  });
  expect(result.current.receipt).toEqual(receipt);
  expect(result.current.error).toBeNull();
});

test("un callback retenido no envía después del desmontaje", async () => {
  const pending = pendingSubmission();
  const { result, unmount } = renderHook(() => useSubmitStudentRequest(pending));
  const submit = result.current.submit;
  unmount();
  pending.resolve(receipt);
  await submit(command);
  expect(pending.submitStudentRequest).not.toHaveBeenCalled();
});
