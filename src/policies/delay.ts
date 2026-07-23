import { delay } from './utils'

function getSignal(args: unknown[]): AbortSignal | undefined {
  const last = args.length > 0 ? args[args.length - 1] : undefined
  return last instanceof AbortSignal ? last : undefined
}

export function withDelay<TArgs extends unknown[], TReturn>(
  fn: (...args: TArgs) => TReturn,
  ms: number
): (...args: TArgs) => Promise<Awaited<TReturn>> {
  if (ms < 1) {
    throw new RangeError('"delay" ms must be at least 1')
  }

  const wrapped = async (...args: TArgs): Promise<Awaited<TReturn>> => {
    const signal = getSignal(args)
    await delay(ms, signal)
    return (await fn(...args)) as Awaited<TReturn>
  }

  return wrapped as (...args: TArgs) => Promise<Awaited<TReturn>>
}
