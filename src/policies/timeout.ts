import { TaskTimeoutError } from '../errors'

export function withTimeout<TArgs extends unknown[], TReturn>(
  fn: (...args: TArgs) => TReturn,
  ms: number
): (...args: TArgs) => Promise<Awaited<TReturn>> {
  if (ms < 1) {
    throw new RangeError('timeout ms must be at least 1')
  }

  const wrapped = async (...args: TArgs): Promise<Awaited<TReturn>> => {
    const controller = new AbortController()

    return new Promise<Awaited<TReturn>>((resolve, reject) => {
      const timer = setTimeout(() => {
        controller.abort()
        reject(new TaskTimeoutError(ms))
      }, ms)

      Promise.resolve(fn(...args))
        .then((result) => {
          clearTimeout(timer)
          resolve(result as Awaited<TReturn>)
        })
        .catch((error) => {
          clearTimeout(timer)
          reject(error)
        })
    })
  }

  return wrapped as (...args: TArgs) => Promise<Awaited<TReturn>>
}
