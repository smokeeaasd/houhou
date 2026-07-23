function getSignal(args: unknown[]): AbortSignal | undefined {
  const last = args.length > 0 ? args[args.length - 1] : undefined
  return last instanceof AbortSignal ? last : undefined
}

export function withFallback<TArgs extends unknown[], TReturn, TFallback>(
  fn: (...args: TArgs) => TReturn,
  fallbackFn: (...args: TArgs) => TFallback
): (...args: TArgs) => Promise<Awaited<TReturn> | Awaited<TFallback>> {
  const wrapped = async (...args: TArgs): Promise<Awaited<TReturn> | Awaited<TFallback>> => {
    const signal = getSignal(args)
    if (signal?.aborted) {
      throw signal.reason
    }

    try {
      return (await fn(...args)) as Awaited<TReturn>
    } catch {
      return (await fallbackFn(...args)) as Awaited<TFallback>
    }
  }

  return wrapped as (...args: TArgs) => Promise<Awaited<TReturn> | Awaited<TFallback>>
}
