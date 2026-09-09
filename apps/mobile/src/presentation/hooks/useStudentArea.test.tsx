import React, { StrictMode } from 'react';
import { expect, test } from 'bun:test';
import TestRenderer, {
  act,
  type ReactTestRenderer,
} from 'react-test-renderer';

import type {
  Accompaniment,
  StudentAreaSnapshot,
  StudentRequest,
} from '../../application/student-area-models';
import type { StudentAreaReader } from '../../application/student-area-port';
import { createMockStudentAreaReader } from '../../infrastructure/mock-student-area-reader';
import {
  useStudentAccompaniments,
  useStudentArea,
  useStudentIdentity,
  useStudentRequests,
  type StudentAccompanimentsState,
  type StudentAreaState,
  type StudentIdentityState,
  type StudentRequestsState,
} from './useStudentArea';

type ReactActGlobal = typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean;
};

(globalThis as ReactActGlobal).IS_REACT_ACT_ENVIRONMENT = true;

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T | PromiseLike<T>) => void;
  readonly reject: (reason?: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>['resolve'];
  let reject!: Deferred<T>['reject'];
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function request(id: string): StudentRequest {
  return {
    id,
    status: 'received',
    origin: 'student',
    createdAt: '2026-08-10T15:00:00.000Z',
    updatedAt: '2026-08-10T15:00:00.000Z',
    needSummary: 'Necesidad ficticia',
    expectedOutcome: 'Resultado ficticio',
    accessNeeds: [],
    generalAvailability: { preferredWeekdays: [2] },
    modalityPreference: 'online',
    preferredAccessibleInformationChannel: 'Canal ficticio',
  };
}

function accompaniment(id: string): Accompaniment {
  return {
    id,
    requestId: 'request-1',
    status: 'active',
    createdAt: '2026-08-12T15:00:00.000Z',
  };
}

const fixtureReader = createMockStudentAreaReader();

async function snapshot({
  requests = [],
  accompaniments = [],
}: {
  readonly requests?: readonly StudentRequest[];
  readonly accompaniments?: readonly Accompaniment[];
} = {}): Promise<StudentAreaSnapshot> {
  // Reuse the existing adapter's identity so these fixtures do not depend on
  // optional fields that may exist only in a local working tree.
  const base = await fixtureReader.readStudentArea();
  return {
    ...base,
    requests,
    accompaniments,
  };
}

function mount(
  reader: StudentAreaReader,
  strict = false,
): { readonly renderer: ReactTestRenderer; readonly getState: () => StudentAreaState } {
  let current!: StudentAreaState;

  function Probe() {
    current = useStudentArea(reader);
    return null;
  }

  const element = strict
    ? React.createElement(StrictMode, null, React.createElement(Probe))
    : React.createElement(Probe);
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(element);
  });
  return { renderer, getState: () => current };
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

test('mounted hook transitions from loading to success and tracks empty collections independently', async () => {
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
  expect(mounted.getState().status).toBe('loading');
  expect(mounted.getState().snapshot).toBeNull();
  expect(mounted.getState().requests.status).toBe('loading');
  expect(mounted.getState().requests.data).toEqual([]);

  await act(async () => {
    read.resolve(
      await snapshot({ accompaniments: [accompaniment('accompaniment-1')] }),
    );
    await read.promise;
  });

  const state = mounted.getState();
  expect(state.status).toBe('success');
  expect(state.identity.status).toBe('success');
  expect(state.identity.data?.id).toBe('example-student-1');
  expect(state.requests.status).toBe('empty');
  expect(state.accompaniments.status).toBe('success');
  act(() => mounted.renderer.unmount());
});

test('a populated request collection and an empty accompaniment collection are distinct', async () => {
  const read = deferred<StudentAreaSnapshot>();
  const reader: StudentAreaReader = { readStudentArea: () => read.promise };
  const mounted = mount(reader);

  await act(async () => {
    read.resolve(await snapshot({ requests: [request('request-1')] }));
    await read.promise;
  });

  expect(mounted.getState().requests.status).toBe('success');
  expect(mounted.getState().requests.data).toHaveLength(1);
  expect(mounted.getState().accompaniments.status).toBe('empty');
  expect(mounted.getState().accompaniments.data).toEqual([]);
  act(() => mounted.renderer.unmount());
});

test('consumes the actual infrastructure mock reader when mounted', async () => {
  const mounted = mount(createMockStudentAreaReader());

  await settle();

  const state = mounted.getState();
  expect(state.status).toBe('success');
  expect(state.identity.data?.id).toBe('example-student-1');
  expect(state.requests.data[0]?.id).toBe('example-request-1');
  expect(state.accompaniments.data[0]?.id).toBe('example-accompaniment-1');
  act(() => mounted.renderer.unmount());
});

test('reports rejected reads, then reloads successfully', async () => {
  const first = deferred<StudentAreaSnapshot>();
  const second = deferred<StudentAreaSnapshot>();
  let reads = 0;
  const reader: StudentAreaReader = {
    readStudentArea: () => (++reads === 1 ? first.promise : second.promise),
  };
  const mounted = mount(reader);
  const failure = new Error('reader unavailable');

  await act(async () => {
    first.reject(failure);
    await first.promise.catch(() => undefined);
  });
  expect(mounted.getState().status).toBe('error');
  expect(mounted.getState().error).toBe(failure);

  await act(async () => {
    mounted.getState().reload();
  });
  expect(reads).toBe(2);
  expect(mounted.getState().status).toBe('loading');
  expect(mounted.getState().snapshot).toBeNull();

  await act(async () => {
    second.resolve(await snapshot());
    await second.promise;
  });
  expect(mounted.getState().status).toBe('success');
  act(() => mounted.renderer.unmount());
});

test('catches a synchronous reader throw', () => {
  const failure = new Error('sync failure');
  const reader: StudentAreaReader = {
    readStudentArea: () => {
      throw failure;
    },
  };
  const mounted = mount(reader);

  expect(mounted.getState().status).toBe('error');
  expect(mounted.getState().error).toBe(failure);
  act(() => mounted.renderer.unmount());
});

test('ignores an obsolete reload result', async () => {
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
  expect(mounted.getState().status).toBe('loading');

  await act(async () => {
    second.resolve(await snapshot());
    await second.promise;
  });
  expect(mounted.getState().status).toBe('success');

  await act(async () => {
    first.resolve(await snapshot({ requests: [request('obsolete')] }));
    await first.promise;
  });
  expect(mounted.getState().snapshot?.requests).toEqual([]);
  act(() => mounted.renderer.unmount());
});

test('hides populated old data when the reader is replaced', async () => {
  const oldRead = deferred<StudentAreaSnapshot>();
  const newRead = deferred<StudentAreaSnapshot>();
  const oldReader: StudentAreaReader = { readStudentArea: () => oldRead.promise };
  const newReader: StudentAreaReader = { readStudentArea: () => newRead.promise };
  let currentReader = oldReader;
  let current!: StudentAreaState;

  function Probe() {
    current = useStudentArea(currentReader);
    return null;
  }

  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(React.createElement(Probe));
  });
  await act(async () => {
    oldRead.resolve(await snapshot({ requests: [request('old')] }));
    await oldRead.promise;
  });
  expect(current.snapshot?.requests[0]?.id).toBe('old');

  currentReader = newReader;
  await act(async () => {
    renderer.update(React.createElement(Probe));
  });
  expect(current.status).toBe('loading');
  expect(current.snapshot).toBeNull();
  expect(current.requests.data).toEqual([]);

  await act(async () => {
    newRead.resolve(await snapshot({ requests: [request('new')] }));
    await newRead.promise;
  });
  expect(current.snapshot?.requests[0]?.id).toBe('new');
  act(() => renderer.unmount());
});

test('ignores stale resolves and rejects when a reader is replaced while pending', async () => {
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
  let current!: StudentAreaState;

  function Probe() {
    current = useStudentArea(currentReader);
    return null;
  }

  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(React.createElement(Probe));
  });
  // Keep the old read pending until after the source replacement.
  currentReader = replacementReader;
  await act(async () => {
    renderer.update(React.createElement(Probe));
  });

  await act(async () => {
    oldRead.resolve(await snapshot({ requests: [request('obsolete-old')] }));
    await oldRead.promise;
  });
  await settle();
  expect(current.status).toBe('loading');
  expect(current.snapshot).toBeNull();

  // A second pending read proves the rejection path is stale as well; the
  // first deferred was already settled and is intentionally not reused.
  currentReader = currentReaderAdapter;
  await act(async () => {
    renderer.update(React.createElement(Probe));
  });

  const staleFailure = new Error('obsolete reader failure');
  await act(async () => {
    replacementRead.reject(staleFailure);
    await replacementRead.promise.catch(() => undefined);
  });
  await settle();
  expect(current.status).toBe('loading');
  expect(current.snapshot).toBeNull();

  await act(async () => {
    currentRead.resolve(await snapshot({ requests: [request('new')] }));
    await currentRead.promise;
  });
  expect(current.status).toBe('success');
  expect(current.snapshot?.requests[0]?.id).toBe('new');
  act(() => renderer.unmount());
});

test('public aggregate hooks expose reload after rejection and retry independently', async () => {
  const reads: Array<Deferred<StudentAreaSnapshot>> = [];
  const reader: StudentAreaReader = {
    readStudentArea: () => {
      const read = deferred<StudentAreaSnapshot>();
      reads.push(read);
      return read.promise;
    },
  };
  let current!: {
    readonly identity: StudentIdentityState;
    readonly requests: StudentRequestsState;
    readonly accompaniments: StudentAccompanimentsState;
  };

  function Probe() {
    current = {
      identity: useStudentIdentity(reader),
      requests: useStudentRequests(reader),
      accompaniments: useStudentAccompaniments(reader),
    };
    return null;
  }

  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(React.createElement(Probe));
  });
  expect(reads).toHaveLength(3);

  const failure = new Error('aggregate reader unavailable');
  await act(async () => {
    reads.forEach((read) => read.reject(failure));
    await Promise.all(reads.map((read) => read.promise.catch(() => undefined)));
  });
  expect(current.identity.status).toBe('error');
  expect(current.requests.status).toBe('error');
  expect(current.accompaniments.status).toBe('error');

  const reloads = [
    current.identity.reload,
    current.requests.reload,
    current.accompaniments.reload,
  ];
  await act(async () => {
    reloads.forEach((reload) => reload());
  });
  expect(reads).toHaveLength(6);
  expect(current.identity.status).toBe('loading');
  expect(current.requests.status).toBe('loading');
  expect(current.accompaniments.status).toBe('loading');

  const retryReads = reads.slice(3);
  await act(async () => {
    const retrySnapshot = await snapshot();
    retryReads.forEach((read) => read.resolve(retrySnapshot));
    await Promise.all(retryReads.map((read) => read.promise));
  });
  expect(current.identity.status).toBe('success');
  expect(current.requests.status).toBe('empty');
  expect(current.accompaniments.status).toBe('empty');
  act(() => renderer.unmount());
});

test('completes safely when unmounted and when mounted in StrictMode', async () => {
  const read = deferred<StudentAreaSnapshot>();
  const reader: StudentAreaReader = { readStudentArea: () => read.promise };
  const mounted = mount(reader, true);
  act(() => mounted.renderer.unmount());

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
  expect(strictMounted.getState().status).toBe('success');
  act(() => strictMounted.renderer.unmount());
});
