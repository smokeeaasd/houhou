/**
 * Thrown by `.timeout(ms)` when the wrapped function does not complete
 * within the given time.
 *
 * @example
 * try {
 *   await task(fetchUser).timeout(1000)()
 * } catch (error) {
 *   if (error instanceof TaskTimeoutError) {
 *     console.log(error.ms)
 *   }
 * }
 */
export class TaskTimeoutError extends Error {
  readonly ms: number

  constructor(ms: number) {
    super(`Task timed out after ${ms}ms`)
    this.name = 'TaskTimeoutError'
    this.ms = ms
  }
}

/**
 * Thrown by `.circuitBreaker()` when the circuit is **open** and
 * the `resetTimeout` has not yet elapsed.
 */
export class CircuitBreakerOpenError extends Error {
  constructor() {
    super('Circuit breaker is open')
    this.name = 'CircuitBreakerOpenError'
  }
}
