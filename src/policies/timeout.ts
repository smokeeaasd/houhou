import { TaskTimeoutError } from '../errors'

function getSignal(args: unknown[]): AbortSignal | undefined {
  const last = args.length > 0 ? args[args.length - 1] : undefined
  return last instanceof AbortSignal ? last : undefined
}

export function withTimeout<TArgs extends unknown[], TReturn>(
  fn: (...args: TArgs) => TReturn,
  ms: number
): (...args: TArgs) => Promise<Awaited<TReturn>> {
  if (ms < 1) {
    throw new RangeError('"timeout" ms must be at least 1')
  }

  return async (...args: TArgs): Promise<Awaited<TReturn>> => {
    const externalSignal = getSignal(args)
    const cleanArgs = externalSignal
      ? (args.slice(0, -1) as unknown as unknown[])
      : (args as unknown as unknown[])

    const controller = new AbortController()

    const signal = externalSignal
      ? AbortSignal.any([externalSignal, controller.signal])
      : controller.signal

    return new Promise<Awaited<TReturn>>((resolve, reject) => {
      const onExternalAbort = () => {
        clearTimeout(timer)
        controller.abort()
        reject(externalSignal!.reason)
      }
      externalSignal?.addEventListener('abort', onExternalAbort, { once: true })

      const timer = setTimeout(() => {
        externalSignal?.removeEventListener('abort', onExternalAbort)
        controller.abort()
        reject(new TaskTimeoutError(ms))
      }, ms)

      Promise.resolve((fn as (...a: unknown[]) => unknown)(...cleanArgs, signal))
        .then((result) => {
          clearTimeout(timer)
          externalSignal?.removeEventListener('abort', onExternalAbort)
          resolve(result as Awaited<TReturn>)
        })
        .catch((error) => {
          clearTimeout(timer)
          externalSignal?.removeEventListener('abort', onExternalAbort)
          reject(error)
        })
    })
  }
}
