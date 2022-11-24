import { UNKNOWN_ELEMENT_IN_STACK } from './errors';
import { Context, NDFSMConfig, TransitionPoint } from './types';
import merge from 'ts-deepmerge';

function isIterable(obj: object) {
  if (!obj) {
    return false;
  }
  return typeof obj[ Symbol.iterator ] === 'function';
}

function isAsyncIterable(obj: object) {
  if (!obj) {
    return false;
  }
  return typeof obj[ Symbol.asyncIterator ] === 'function';
}

export async function unpackAndExecute(point, actions, ctx, ctrl) {
  if (!point.symbol) {
    return;
  }
  const input = actions[ point.symbol ];
  const iteratorOrPoint = input(ctx, ctrl, ...(point.args || []));
  if (iteratorOrPoint instanceof Promise) {
    return await iteratorOrPoint;
  }
  return iteratorOrPoint;
}

export async function startProcess(initialPoint, actions, ctx, ctrl, { after }): Promise<void> {
  const stack = [ initialPoint ];
  while (stack.length > 0) {
    if (ctrl.signal.aborted) {
      return;
    }
    const iteratorOrPoint = stack[ stack.length - 1 ];
    if (!isAsyncIterable(iteratorOrPoint) && !isIterable(iteratorOrPoint)) {
      if (iteratorOrPoint.symbol && typeof actions[ iteratorOrPoint.symbol ] === 'function') {
        const nextPointOrIterator = await unpackAndExecute(iteratorOrPoint, actions, ctx, ctrl);
        if (ctrl.signal.aborted) {
          return;
        }
        stack.pop();
        if (nextPointOrIterator) {
          stack.push(nextPointOrIterator);
        }
        continue;
      } else {
        after(iteratorOrPoint);
        stack.pop();
        continue;
      }
    }
    let iteratorResult;
    if (isAsyncIterable(iteratorOrPoint)) {
      iteratorResult = await iteratorOrPoint.next();
      if (ctrl.signal.aborted) {
        return;
      }
    } else if (isIterable(iteratorOrPoint)) {
      iteratorResult = iteratorOrPoint.next();
    }
    if (iteratorResult) {
      if (iteratorResult.done) {
        stack.pop();
      }
      if (iteratorResult.value) {
        stack.push(iteratorResult.value);
      }
    } else {
      throw new Error(UNKNOWN_ELEMENT_IN_STACK);
    }
  }
}

export function makeActions<State>(config: NDFSMConfig<State>) {
  const ctx: Context<State> = {
    symbol: config.defaultSymbol,
    state: config.getDefaultState()
  };
  const wrappedActions = Object.create(null);

  function commit(point: TransitionPoint<State> | undefined): void {
    if (!point) {
      return;
    }
    if (point.symbol) {
      ctx.symbol = point.symbol;
    }
    if (point.transform && point.payload) {
      ctx.state = point.transform(ctx.state, point.payload);
    } else if (point.payload) {
      ctx.state = merge.withOptions(
        { mergeArrays: false },
        ctx.state,
        point.payload
      ) as State;
    }
  }

  function wrap(symbol) {
    f.ctrl = new AbortController();
    async function f(...args) {
      if (f.ctrl) {
        f.ctrl.abort();
        f.ctrl = new AbortController();
      }
      await startProcess(
        {
          symbol,
          args: [ ...args ]
        },
        config.actions,
        ctx,
        f.ctrl,
        {
          after: function (point: TransitionPoint<State>) {
            commit(point);
            if (config.callback) {
              config.callback(ctx);
            }
          }
        }
      );
      if (f.ctrl.signal.aborted
        && config.rollback
        && config.rollback[ symbol ]
      ) {
        const rollbackState = config.rollback[ symbol ](ctx);
        commit(rollbackState);
        if (config.callback) {
          config.callback(ctx);
        }
      }
    }
    return f;
  }

  Object.getOwnPropertySymbols(config.actions).forEach((symbol) => {
    wrappedActions[ symbol ] = wrap(symbol);
  });

  return wrappedActions;
}
