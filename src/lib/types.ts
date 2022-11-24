export const EMPTY = Symbol('EMPTY');

type DeepPartial<T> = T extends object ? {
  [P in keyof T]?: DeepPartial<T[P]>;
} : T;

export type Context<State> = {
  symbol: symbol,
  state: State
};

export type TransitionPoint<State> = {
  symbol?: symbol,
  args?: any[],
  payload?: DeepPartial<State>,
  transform?: (prevState: State, update: DeepPartial<State>) => State
};

export type Action<State> = (
  ctx: Context<State>,
  ctrl: AbortController,
  ...args: any[]
) => undefined
  | TransitionPoint<State>
  | Promise<TransitionPoint<State>>
  | AsyncIterableIterator<TransitionPoint<State> | undefined>
  | IterableIterator<TransitionPoint<State> | undefined>;

export type WrappedAction = {
  (...args: any[]): void;
  abortController: AbortController
};

export type NDFSMConfig<State> = {
  defaultSymbol: symbol,
  getDefaultState: () => State,
  actions: { [s: symbol]: Action<State> },
  stateChecks?: { [s: symbol]: (ctx: Context<State>) => boolean },
  rollback?: { [s: symbol]: (ctx: Context<State>) => TransitionPoint<State> },
  callback?: (ctx: Context<State>) => void,
};
