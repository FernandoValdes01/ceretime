import { StrictMode } from "react";
import { act, renderHook } from "@testing-library/react-native";

import type {
  Accompaniment,
  StudentAreaSnapshot,
  StudentRequest,
} from "../../domain/student-area-models";
import type { StudentAreaReader } from "../../application/student-area-port";
import { createDemoStudentAreaReader } from "../../infrastructure/demo-student-area-reader";
import { useStudentArea } from "./use-student-area";

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T | PromiseLike<T>) => void;
  readonly reject: (reason?: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>["resolve"];
  let reject!: Deferred<T>["reject"];
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function request(id: string): StudentRequest {
  return {
    id,
    status: "received",
    createdAt: "2026-08-10T15:00:00.000Z",
    updatedAt: "2026-08-10T15:00:00.000Z",
    needSummary: "Necesidad ficticia",
    expectedOutcome: "Resultado ficticio",
    accessNeeds: "",
    generalAvailability: { preferredWeekdays: [2] },
    modalityPreference: "online",
    preferredAccessibleInformationChannel: "Canal ficticio",
  };
}

function accompaniment(id: string): Accompaniment {
  return {
    id,
    requestId: "request-1",
    status: "active",
    createdAt: "2026-08-12T15:00:00.000Z",
  };
}

const fixtureReader = createDemoStudentAreaReader();

async function snapshot({
  requests = [],
  accompaniments = [],
}: {
  readonly requests?: readonly StudentRequest[];
  readonly accompaniments?: readonly Accompaniment[];
} = {}): Promise<StudentAreaSnapshot> {
  const base = await fixtureReader.readStudentArea();
  return {
    ...base,
    requests,
    accompaniments,
  };
}

function mount(reader: StudentAreaReader, strict = false) {
  const hook = renderHook(() => useStudentArea(reader), {
    wrapper: strict ? StrictMode : undefined,
  });
  return { unmount: hook.unmount, getState: () => hook.result.current };
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

test("mounted hook transitions from loading to success and tracks empty collections independently", async () => {
  const read = deferred<StudentAreaSnapshot>();
  let reads = 0;
  const reader: StudentAreaReader = {
    readStudentArea: () => {
      reads += 1;
      return read.promise;
    },
  };
  const mounted = mount(reader);

  expect(reads).toBe(1);
  expect(mounted.getState().status).toBe("loading");
  expect(mounted.getState().snapshot).toBeNull();
  expect(mounted.getState().requests.status).toBe("loading");
  expect(mounted.getState().requests.data).toEqual([]);

  await act(async () => {
    read.resolve(await snapshot({ accompaniments: [accompaniment("accompaniment-1")] }));
    await read.promise;
  });

  const state = mounted.getState();
  expect(state.status).toBe("success");
  expect(state.identity.status).toBe("success");
  expect(state.identity.data?.id).toBe("example-student-1");
  expect(state.requests.status).toBe("empty");
  expect(state.accompaniments.status).toBe("success");
  act(() => mounted.unmount());
});

test("a populated request collection and an empty accompaniment collection are distinct", async () => {
  const read = deferred<StudentAreaSnapshot>();
  const reader: StudentAreaReader = { readStudentArea: () => read.promise };
  const mounted = mount(reader);

  await act(async () => {
    read.resolve(await snapshot({ requests: [request("request-1")] }));
    await read.promise;
  });

  expect(mounted.getState().requests.status).toBe("success");
  expect(mounted.getState().requests.data).toHaveLength(1);
  expect(mounted.getState().accompaniments.status).toBe("empty");
  expect(mounted.getState().accompaniments.data).toEqual([]);
  act(() => mounted.unmount());
});

test("consumes the demo reader from infrastructure when mounted", async () => {
  const mounted = mount(createDemoStudentAreaReader());

  await settle();

  const state = mounted.getState();
  expect(state.status).toBe("success");
  expect(state.identity.data?.id).toBe("example-student-1");
  expect(state.requests.data[0]?.id).toBe("SOL-DEMO-001");
  expect(state.accompaniments.data[0]?.id).toBe("accompaniments:accompaniment-demo-1");
  act(() => mounted.unmount());
});

test("reports rejected reads, then reloads successfully", async () => {
  const first = deferred<StudentAreaSnapshot>();
  const second = deferred<StudentAreaSnapshot>();
  let reads = 0;
  const reader: StudentAreaReader = {
    readStudentArea: () => (++reads === 1 ? first.promise : second.promise),
  };
  const mounted = mount(reader);
  const failure = new Error("reader unavailable");

  await act(async () => {
    first.reject(failure);
    await first.promise.catch(() => undefined);
  });
  expect(mounted.getState().status).toBe("error");
  expect(mounted.getState().error).toEqual(
    new Error("No pudimos cargar tus solicitudes. Intenta nuevamente."),
  );

  await act(async () => {
    mounted.getState().reload();
  });
  expect(reads).toBe(2);
  expect(mounted.getState().status).toBe("loading");
  expect(mounted.getState().snapshot).toBeNull();

  await act(async () => {
    second.resolve(await snapshot());
    await second.promise;
  });
  expect(mounted.getState().status).toBe("success");
  act(() => mounted.unmount());
});

test("catches a synchronous reader throw", () => {
  const failure = new Error("sync failure");
  const reader: StudentAreaReader = {
    readStudentArea: () => {
      throw failure;
    },
  };
  const mounted = mount(reader);

  expect(mounted.getState().status).toBe("error");
  expect(mounted.getState().error).toEqual(
    new Error("No pudimos cargar tus solicitudes. Intenta nuevamente."),
  );
  act(() => mounted.unmount());
});

test("ignores an obsolete reload result", async () => {
  const first = deferred<StudentAreaSnapshot>();
  const second = deferred<StudentAreaSnapshot>();
  let reads = 0;
  const reader: StudentAreaReader = {
    readStudentArea: () => (++reads === 1 ? first.promise : second.promise),
  };
  const mounted = mount(reader);

  await act(async () => {
    mounted.getState().reload();
  });
  expect(mounted.getState().status).toBe("loading");

  await act(async () => {
    second.resolve(await snapshot());
    await second.promise;
  });
  expect(mounted.getState().status).toBe("success");

  await act(async () => {
    first.resolve(await snapshot({ requests: [request("obsolete")] }));
    await first.promise;
  });
  expect(mounted.getState().snapshot?.requests).toEqual([]);
  act(() => mounted.unmount());
});

test("hides populated old data when the reader is replaced", async () => {
  const oldRead = deferred<StudentAreaSnapshot>();
  const newRead = deferred<StudentAreaSnapshot>();
  const oldReader: StudentAreaReader = { readStudentArea: () => oldRead.promise };
  const newReader: StudentAreaReader = { readStudentArea: () => newRead.promise };
  let currentReader = oldReader;

  const { result, rerender, unmount } = renderHook(() => useStudentArea(currentReader));
  const getState = () => result.current;
  await act(async () => {
    oldRead.resolve(await snapshot({ requests: [request("old")] }));
    await oldRead.promise;
  });
  expect(getState().snapshot?.requests[0]?.id).toBe("old");

  currentReader = newReader;
  await act(async () => {
    rerender({});
  });
  expect(getState().status).toBe("loading");
  expect(getState().snapshot).toBeNull();
  expect(getState().requests.data).toEqual([]);

  await act(async () => {
    newRead.resolve(await snapshot({ requests: [request("new")] }));
    await newRead.promise;
  });
  expect(getState().snapshot?.requests[0]?.id).toBe("new");
  act(() => unmount());
});

test("ignores stale resolves and rejects when a reader is replaced while pending", async () => {
  const oldRead = deferred<StudentAreaSnapshot>();
  const replacementRead = deferred<StudentAreaSnapshot>();
  const currentRead = deferred<StudentAreaSnapshot>();
  const oldReader: StudentAreaReader = { readStudentArea: () => oldRead.promise };
  const replacementReader: StudentAreaReader = {
    readStudentArea: () => replacementRead.promise,
  };
  const currentReaderAdapter: StudentAreaReader = {
    readStudentArea: () => currentRead.promise,
  };
  let currentReader = oldReader;

  const { result, rerender, unmount } = renderHook(() => useStudentArea(currentReader));
  const getState = () => result.current;
  // Keep the old read pending until after the source replacement.
  currentReader = replacementReader;
  await act(async () => {
    rerender({});
  });

  await act(async () => {
    oldRead.resolve(await snapshot({ requests: [request("obsolete-old")] }));
    await oldRead.promise;
  });
  await settle();
  expect(getState().status).toBe("loading");
  expect(getState().snapshot).toBeNull();

  // A second pending read proves the rejection path is stale as well; the
  // first deferred was already settled and is intentionally not reused.
  currentReader = currentReaderAdapter;
  await act(async () => {
    rerender({});
  });

  const staleFailure = new Error("obsolete reader failure");
  await act(async () => {
    replacementRead.reject(staleFailure);
    await replacementRead.promise.catch(() => undefined);
  });
  await settle();
  expect(getState().status).toBe("loading");
  expect(getState().snapshot).toBeNull();

  await act(async () => {
    currentRead.resolve(await snapshot({ requests: [request("new")] }));
    await currentRead.promise;
  });
  expect(getState().status).toBe("success");
  expect(getState().snapshot?.requests[0]?.id).toBe("new");
  act(() => unmount());
});

test("completes safely when unmounted and when mounted in StrictMode", async () => {
  const read = deferred<StudentAreaSnapshot>();
  const reader: StudentAreaReader = { readStudentArea: () => read.promise };
  const mounted = mount(reader, true);
  act(() => mounted.unmount());

  await act(async () => {
    read.resolve(await snapshot());
    await read.promise;
  });

  const strictRead = deferred<StudentAreaSnapshot>();
  const strictReader: StudentAreaReader = {
    readStudentArea: () => strictRead.promise,
  };
  const strictMounted = mount(strictReader, true);
  await act(async () => {
    strictRead.resolve(await snapshot());
    await strictRead.promise;
  });
  expect(strictMounted.getState().status).toBe("success");
  act(() => strictMounted.unmount());
});
