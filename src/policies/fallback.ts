export function withFallback<TArgs extends unknown[], TReturn, TFallback>(
  fn: (...args: TArgs) => TReturn,
  fallbackFn: (...args: TArgs) => TFallback
): (...args: TArgs) => Promise<Awaited<TReturn> | Awaited<TFallback>> {
  const wrapped = async (...args: TArgs): Promise<Awaited<TReturn> | Awaited<TFallback>> => {
    try {
      return (await fn(...args)) as Awaited<TReturn>
    } catch {
      return (await fallbackFn(...args)) as Awaited<TFallback>
    }
  }

  return wrapped as (...args: TArgs) => Promise<Awaited<TReturn> | Awaited<TFallback>>
}
