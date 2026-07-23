import type { CircuitBreakerOptions, RetryOptions, Task } from './types'
import { withRetry } from './policies/retry'
import { withTimeout } from './policies/timeout'
import { withFallback } from './policies/fallback'
import { withDelay } from './policies/delay'
import { withCircuitBreaker } from './policies/circuit-breaker'

type PolicyName = 'retry' | 'timeout' | 'fallback' | 'delay' | 'circuit-breaker'

function guard(locked: Set<PolicyName>, name: PolicyName): void {
  if (locked.has(name)) {
    throw new Error(`"${name}" is already configured on this task`)
  }
  locked.add(name)
}

function createTask<TArgs extends unknown[], TReturn>(
  fn: (...args: TArgs) => TReturn,
  locked: Set<PolicyName>
): Task<TArgs, Awaited<TReturn>> {
  const exec = Object.assign(
    async (...args: TArgs): Promise<Awaited<TReturn>> => {
      return fn(...args) as Awaited<TReturn>
    },
    {
      retry(attempts_or_options: number | RetryOptions): Task<TArgs, Awaited<TReturn>> {
        guard(locked, 'retry')
        const options =
          typeof attempts_or_options === 'number'
            ? { attempts: attempts_or_options }
            : attempts_or_options
        return createTask(withRetry(fn, options), locked)
      },
      timeout(ms: number): Task<TArgs, Awaited<TReturn>> {
        guard(locked, 'timeout')
        return createTask(withTimeout(fn, ms), locked)
      },
      fallback<TFallback>(
        alt: (...args: TArgs) => TFallback
      ): Task<TArgs, Awaited<TReturn> | Awaited<TFallback>> {
        guard(locked, 'fallback')
        return createTask(withFallback(fn, alt), locked) as Task<
          TArgs,
          Awaited<TReturn> | Awaited<TFallback>
        >
      },
      delay(ms: number): Task<TArgs, Awaited<TReturn>> {
        guard(locked, 'delay')
        return createTask(withDelay(fn, ms), locked)
      },
      circuitBreaker(options: CircuitBreakerOptions): Task<TArgs, Awaited<TReturn>> {
        guard(locked, 'circuit-breaker')
        return createTask(withCircuitBreaker(fn, options), locked)
      }
    }
  )

  return exec as Task<TArgs, Awaited<TReturn>>
}

/**
 * Wrap a function with resilience policies.
 *
 * The returned {@link Task} is both callable (preserving the original
 * signature) and exposes chainable methods: `.retry()`, `.timeout()`,
 * `.fallback()`, `.delay()`, `.circuitBreaker()`.
 *
 * @param fn - The function to wrap. Accepts sync and async functions.
 * @returns A {@link Task} with the same arguments and return type.
 *
 * @example
 * const charge = task(chargeCard)
 *   .retry(3)
 *   .timeout(10_000)
 *   .fallback(() => ({ status: "pending" }))
 *
 * const result = await charge(account, amount)
 */
export function task<TArgs extends unknown[], TReturn>(
  fn: (...args: TArgs) => TReturn
): Task<TArgs, Awaited<TReturn>> {
  return createTask(fn, new Set<PolicyName>())
}
