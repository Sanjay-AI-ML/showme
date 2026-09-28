/** Framework-neutral state bridge for embedding ShowMe in another application. */
export interface HostBridge<State, Action, Result> {
  getContext(): Promise<State>;
  execute(action: Action): Promise<Result>;
  apply<Value>(request: () => Promise<Value>, stateOf: (value: Value) => State): Promise<Value>;
  onChange(listener: (state: State) => void): () => void;
  current(): State | null;
  reset(): void;
}

export function createHostBridge<State, Action, Result>(options: {
  read: () => Promise<State>;
  write: (action: Action) => Promise<Result>;
  stateOf: (result: Result) => State;
  revisionOf: (state: State) => number;
}): HostBridge<State, Action, Result> {
  const listeners = new Set<(state: State) => void>();
  let latest: State | null = null;
  let latestRevision = -1;
  let latestRequest = -1;
  let requestSequence = 0;
  let sessionEpoch = 0;

  function publish(state: State, request: number, epoch: number): State {
    if (epoch !== sessionEpoch) throw new Error('Host session changed before the request completed.');
    const revision = options.revisionOf(state);
    if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('Host state needs a non-negative revision.');
    if (revision > latestRevision || (revision === latestRevision && request >= latestRequest)) {
      latest = state;
      latestRevision = revision;
      latestRequest = request;
      for (const listener of listeners) listener(state);
    }
    return latest ?? state;
  }

  return {
    async getContext() {
      const request = ++requestSequence;
      const epoch = sessionEpoch;
      return publish(await options.read(), request, epoch);
    },
    async execute(action) {
      const request = ++requestSequence;
      const epoch = sessionEpoch;
      const result = await options.write(action);
      publish(options.stateOf(result), request, epoch);
      return result;
    },
    async apply(requestFn, stateOf) {
      const request = ++requestSequence;
      const epoch = sessionEpoch;
      const value = await requestFn();
      publish(stateOf(value), request, epoch);
      return value;
    },
    onChange(listener) {
      listeners.add(listener);
      if (latest) listener(latest);
      return () => listeners.delete(listener);
    },
    current: () => latest,
    reset() {
      sessionEpoch++;
      latest = null;
      latestRevision = -1;
      latestRequest = -1;
    },
  };
}
