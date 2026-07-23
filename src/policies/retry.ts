import type { RetryOptions } from '../types'
import { delay } from './utils'

function getSignal(args: unknown[]): AbortSignal | undefined {
  const last = args.length > 0 ? args[args.length - 1] : undefined
  return last instanceof AbortSignal ? last : undefined
}

function calculateBackoff(attempt: number, options: RetryOptions): number {
  const base = options.delay ?? 1000
  const baseDelay = options.backoff === 'exponential' ? base * 2 ** (attempt - 1) : base * attempt

  return options.jitter ? baseDelay * (0.5 + Math.random()) : baseDelay
}

export function withRetry<TArgs extends unknown[], TReturn>(
  fn: (...args: TArgs) => TReturn,
  options: RetryOptions
): (...args: TArgs) => Promise<Awaited<TReturn>> {
  if (options.attempts < 1) {
    throw new RangeError('"attempts" must be at least 1')
  }

  const wrapped = async (...args: TArgs): Promise<Awaited<TReturn>> => {
    const signal = getSignal(args)
    let lastError: unknown

    for (let attempt = 1; attempt <= options.attempts; attempt++) {
      if (signal?.aborted) {
        throw signal.reason
      }

      try {
        return (await fn(...args)) as Awaited<TReturn>
      } catch (error: unknown) {
        lastError = error
        if (attempt < options.attempts) {
          try {
            await delay(calculateBackoff(attempt, options), signal)
          } catch {
            throw signal!.reason
          }
        }
      }
    }

    throw lastError
  }

  return wrapped as (...args: TArgs) => Promise<Awaited<TReturn>>
}
