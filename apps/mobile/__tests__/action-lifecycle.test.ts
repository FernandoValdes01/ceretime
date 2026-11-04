import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { AdministratorAccountsPort } from "@/application/administrator-accounts-port";
import type { ProfessionalReviewPort } from "@/application/professional-review-port";
import { createMockAdministratorAccountsAdapter } from "@/infrastructure/mock-administrator-accounts-adapter";
import { createMockProfessionalReviewAdapter } from "@/infrastructure/mock-professional-review-adapter";
import { useAdministratorAccounts } from "@/presentation/hooks/use-administrator-accounts";
import { useProfessionalReview } from "@/presentation/hooks/use-professional-review";

test("no duplica acciones sobre una solicitud ni aplica una respuesta de otro adaptador", async () => {
  const adapter = createMockProfessionalReviewAdapter();
  const rows = await adapter.readProfessionalRequests();
  const receipt = await adapter.performProfessionalRequestAction(rows[0].id, "startReview");
  let finish!: (result: typeof receipt) => void;
  const pending = new Promise<typeof receipt>((resolve) => {
    finish = resolve;
  });
  const port: ProfessionalReviewPort = {
    readProfessionalRequests: async () => rows,
    performProfessionalRequestAction: jest.fn(() => pending),
  };
  const { result, rerender } = renderHook(
    ({ source }: { source: ProfessionalReviewPort }) => useProfessionalReview(source),
    { initialProps: { source: port } },
  );
  await waitFor(() => expect(result.current.status).toBe("success"));
  let submission!: Promise<void>;
  act(() => {
    submission = result.current.performAction(rows[0].id, "startReview");
    void result.current.performAction(rows[0].id, "startReview");
  });
  expect(port.performProfessionalRequestAction).toHaveBeenCalledTimes(1);
  rerender({ source: { ...port, readProfessionalRequests: async () => rows } });
  await waitFor(() => expect(result.current.status).toBe("success"));
  act(() => {
    void result.current.performAction(rows[0].id, "startReview");
  });
  expect(port.performProfessionalRequestAction).toHaveBeenCalledTimes(1);
  await act(async () => {
    finish(receipt);
    await submission;
  });
  expect(result.current.requests[0].status).toBe("received");
  expect(result.current.getRequestFeedback(rows[0].id).status).toBe("idle");
});

test("una habilitación tardía no cambia las cuentas de otra fuente ni su estado de acción", async () => {
  const adapter = createMockAdministratorAccountsAdapter();
  const accounts = await adapter.readPractitionerAccounts();
  const receipt = await adapter.enablePractitionerAccount(accounts[0].id);
  let finish!: (result: typeof receipt) => void;
  const pending = new Promise<typeof receipt>((resolve) => {
    finish = resolve;
  });
  const port: AdministratorAccountsPort = {
    readPractitionerAccounts: async () => accounts,
    enablePractitionerAccount: jest.fn(() => pending),
  };
  const { result, rerender } = renderHook(
    ({ source }: { source: AdministratorAccountsPort }) => useAdministratorAccounts(source),
    { initialProps: { source: port } },
  );
  await waitFor(() => expect(result.current.status).toBe("success"));
  let submission!: Promise<void>;
  act(() => {
    submission = result.current.enableAccount(accounts[0].id);
  });
  rerender({ source: { ...port, readPractitionerAccounts: async () => accounts } });
  await waitFor(() => expect(result.current.status).toBe("success"));
  expect(result.current.getEnablementState(accounts[0].id).status).toBe("loading");
  act(() => {
    void result.current.enableAccount(accounts[0].id);
  });
  expect(port.enablePractitionerAccount).toHaveBeenCalledTimes(1);
  await act(async () => {
    finish(receipt);
    await submission;
  });
  expect(result.current.accounts[0].status).toBe("pending");
  expect(result.current.getEnablementState(accounts[0].id).status).toBe("idle");
});

test("los errores inesperados de habilitación se ocultan y el reintento funciona", async () => {
  const adapter = createMockAdministratorAccountsAdapter();
  const accounts = await adapter.readPractitionerAccounts();
  const enablePractitionerAccount = jest
    .fn()
    .mockRejectedValueOnce(new Error("SDK privado"))
    .mockImplementation(adapter.enablePractitionerAccount);
  const port = { ...adapter, enablePractitionerAccount };
  const { result, unmount } = renderHook(() => useAdministratorAccounts(port));
  await waitFor(() => expect(result.current.status).toBe("success"));
  await act(async () => {
    await result.current.enableAccount(accounts[0].id);
  });
  expect(result.current.getEnablementState(accounts[0].id).error).toEqual(
    new Error("No pudimos habilitar la cuenta. Intenta nuevamente."),
  );
  await act(async () => {
    await result.current.enableAccount(accounts[0].id);
  });
  expect(result.current.accounts[0].status).toBe("enabled");
  const retainedEnable = result.current.enableAccount;
  unmount();
  await retainedEnable(accounts[1].id);
  expect(enablePractitionerAccount).toHaveBeenCalledTimes(2);
});
