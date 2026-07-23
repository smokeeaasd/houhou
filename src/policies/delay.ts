export function withDelay<TArgs extends unknown[], TReturn>(
  fn: (...args: TArgs) => TReturn,
  ms: number
): (...args: TArgs) => Promise<Awaited<TReturn>> {
  const wrapped = async (...args: TArgs): Promise<Awaited<TReturn>> => {
    await new Promise((resolve) => setTimeout(resolve, ms))
    return (await fn(...args)) as Awaited<TReturn>
  }

  return wrapped as (...args: TArgs) => Promise<Awaited<TReturn>>
}
