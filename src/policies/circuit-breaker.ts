import type { CircuitBreakerOptions } from '../types'
import { CircuitBreakerOpenError } from '../errors'

type State = 'closed' | 'open' | 'half-open'

function getSignal(args: unknown[]): AbortSignal | undefined {
  const last = args.length > 0 ? args[args.length - 1] : undefined
  return last instanceof AbortSignal ? last : undefined
}

export function withCircuitBreaker<TArgs extends unknown[], TReturn>(
  fn: (...args: TArgs) => TReturn,
  options: CircuitBreakerOptions
): (...args: TArgs) => Promise<Awaited<TReturn>> {
  if (options.failureThreshold < 1) {
    throw new RangeError('"failureThreshold" must be at least 1')
  }
  if (options.successThreshold < 1) {
    throw new RangeError('"successThreshold" must be at least 1')
  }
  if (options.resetTimeout < 1) {
    throw new RangeError('"resetTimeout" must be at least 1')
  }

  let state: State = 'closed'
  let failureCount = 0
  let successCount = 0
  let nextAttempt = 0

  const wrapped = async (...args: TArgs): Promise<Awaited<TReturn>> => {
    const signal = getSignal(args)
    if (signal?.aborted) {
      throw signal.reason
    }

    if (state === 'open') {
      if (Date.now() >= nextAttempt) {
        state = 'half-open'
      } else {
        throw new CircuitBreakerOpenError()
      }
    }

    try {
      const result = (await fn(...args)) as Awaited<TReturn>

      if (state === 'half-open') {
        successCount++
        if (successCount >= options.successThreshold) {
          state = 'closed'
          failureCount = 0
          successCount = 0
        }
      } else {
        failureCount = 0
      }

      return result
    } catch (error: unknown) {
      if (state === 'half-open') {
        state = 'open'
        nextAttempt = Date.now() + options.resetTimeout
        successCount = 0
      } else {
        failureCount++
        if (failureCount >= options.failureThreshold) {
          state = 'open'
          nextAttempt = Date.now() + options.resetTimeout
        }
      }

      throw error
    }
  }

  return wrapped as (...args: TArgs) => Promise<Awaited<TReturn>>
}
