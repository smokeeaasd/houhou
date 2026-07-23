/**
 * Configuration for `.retry()`.
 *
 * @property attempts     - Number of retry attempts (required).
 * @property backoff      - Backoff strategy (default `"fixed"`).
 * @property jitter       - Adds randomness to delay to avoid thundering herd (default `false`).
 * @property delay        - Base delay in ms between attempts (default `1000`).
 *
 * @example
 * task(fn).retry({
 *   attempts: 3,
 *   backoff: "exponential",
 *   jitter: true,
 *   delay: 500
 * })
 */
export interface RetryOptions {
  /** Number of retry attempts (required). */
  attempts: number
  /**
   * Backoff strategy between retries.
   * - `"fixed"` — constant delay (`delay * attempt`)
   * - `"exponential"` — delay doubles each attempt (`delay * 2^(attempt-1)`)
   * @default "fixed"
   */
  backoff?: 'fixed' | 'exponential'
  /**
   * Adds random jitter to the backoff delay to avoid thundering herd.
   * @default false
   */
  jitter?: boolean
  /**
   * Base delay in milliseconds.
   * @default 1000
   */
  delay?: number
}

/**
 * Configuration for `.circuitBreaker()`.
 *
 * @property failureThreshold - Failures before opening the circuit (required).
 * @property successThreshold - Successes in half-open state to close it (required).
 * @property resetTimeout     - Milliseconds before transitioning from open to half-open (required).
 *
 * @example
 * task(queryDb).circuitBreaker({
 *   failureThreshold: 5,
 *   successThreshold: 2,
 *   resetTimeout: 30000
 * })
 */
export interface CircuitBreakerOptions {
  /** Failures before the circuit opens. */
  failureThreshold: number
  /** Successes in half-open state before the circuit closes. */
  successThreshold: number
  /** Milliseconds to wait before transitioning from open to half-open. */
  resetTimeout: number
}

/**
 * A callable function extended with resilience policies via a fluent API.
 *
 * The returned value is both callable (preserving the original signature)
 * and exposes chainable policy methods. Each policy can be configured
 * only once — attempting to set it again throws at runtime and is
 * prevented at the type level.
 *
 * @typeParam TArgs   - Argument types of the wrapped function.
 * @typeParam TReturn - Return type of the wrapped function.
 * @typeParam TLocked - Policy names that have already been configured
 *                       (managed internally, never set by the user).
 */
export type Task<TArgs extends unknown[], TReturn, TLocked extends string = never> = ((
  ...args: TArgs
) => Promise<TReturn>) &
  Omit<
    {
      /**
       * Retry the wrapped function on failure.
       *
       * @param attempts - Shortcut for `{ attempts }`.
       *
       * @example
       * task(fn).retry(3)
       */
      retry(attempts: number): Task<TArgs, TReturn, TLocked | 'retry'>

      /**
       * Retry the wrapped function on failure with full options.
       *
       * @param options - Retry configuration (attempts, backoff, jitter, delay).
       *
       * @example
       * task(fn).retry({
       *   attempts: 3,
       *   backoff: "exponential",
       *   jitter: true
       * })
       */
      retry(options: RetryOptions): Task<TArgs, TReturn, TLocked | 'retry'>

      /**
       * Reject if the wrapped function does not complete in time.
       *
       * @param ms - Timeout in milliseconds.
       * @throws {@link TaskTimeoutError} when the time elapses.
       *
       * @example
       * task(fn).timeout(5000)
       */
      timeout(ms: number): Task<TArgs, TReturn, TLocked | 'timeout'>

      /**
       * Provide an alternative function to run when the main one fails.
       *
       * @param fn - Fallback function (receives the same arguments).
       *
       * @example
       * task(riskyOp).fallback(() => defaultValue)
       */
      fallback<TFallback>(
        fn: (...args: TArgs) => TFallback
      ): Task<TArgs, TReturn | Awaited<TFallback>, TLocked | 'fallback'>

      /**
       * Wait a fixed amount of time before executing the wrapped function.
       *
       * @param ms - Delay in milliseconds.
       *
       * @example
       * task(fn).delay(1000)
       */
      delay(ms: number): Task<TArgs, TReturn, TLocked | 'delay'>

      /**
       * Protect the wrapped function with a circuit breaker.
       *
       * Prevents repeated calls to an unhealthy service by tracking
       * failures. States: closed → open → half-open → closed.
       *
       * @param options - Circuit breaker configuration.
       * @throws {@link CircuitBreakerOpenError} when the circuit is open.
       *
       * @example
       * task(query).circuitBreaker({
       *   failureThreshold: 5,
       *   successThreshold: 2,
       *   resetTimeout: 30000
       * })
       */
      circuitBreaker(
        options: CircuitBreakerOptions
      ): Task<TArgs, TReturn, TLocked | 'circuit-breaker'>
    },
    TLocked
  >
