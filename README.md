# houhou

![npm](https://img.shields.io/npm/v/houhou)
![License](https://img.shields.io/npm/l/houhou)
![TypeScript](https://img.shields.io/badge/TypeScript-7.0-3178C6)
![Zero Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)

A lightweight TypeScript library for adding resilience policies to async functions.

## Install

```
npm install houhou
```

## Quick start

```ts
import { task } from 'houhou'

const charge = task(chargeCard)
  .retry(3)
  .timeout(10_000)
  .fallback(() => ({ status: 'pending' }))

await charge(account, amount)
```

The wrapped function keeps the same arguments and return type — call it exactly like the original.

## Policies

### Retry

Re-execute on failure with fixed or exponential backoff.

```ts
// shorthand — retries 3 times with default delay
task(fetchUser).retry(3)

// full options
task(fetchUser).retry({
  attempts: 5,
  backoff: 'exponential',
  jitter: true,
  delay: 500
})
```

### Timeout

Reject if the function does not complete in time.

```ts
task(fetchUser).timeout(5000)
```

### Fallback

Run an alternative function when the main one fails.

```ts
task(fetchUser).fallback(() => loadFromCache(id))
```

### Circuit breaker

Prevent repeated calls to an unhealthy service.

```ts
task(queryDb).circuitBreaker({
  failureThreshold: 5,
  successThreshold: 2,
  resetTimeout: 30_000
})
```

### Delay

Wait before execution.

```ts
task(syncData).delay(1000)
```

## Policy ordering

Policies are **nested**: the last method called wraps the previous ones. The execution order is the reverse of the declaration order.

```ts
task(fn).retry(3).timeout(1000)
// → timeout wraps retry
// → function runs → retry on failure (up to 3 times) → timeout of 1s total
// → if the timeout fires, there are no more retries
```

```ts
task(fn).timeout(1000).retry(3)
// → retry wraps timeout
// → function runs → timeout of 1s → if timeout fires, retry catches it
// → the whole cycle repeats up to 3 times
```

## Type safety

Each policy exposes a fluent method on the returned `Task`. Calling a method **locks** it at the type level — TypeScript will prevent you from configuring the same policy twice:

```ts
const t = task(fn).retry(3)

// @ts-expect-error — 'retry' is already locked
t.retry(2)
```

The same lock is enforced at runtime — a second call throws an error.

## Cancellation

houhou uses `AbortController` to cancel operations when a timeout fires or an external signal is provided. The `AbortSignal` is passed as the **last argument** to your wrapped function — consuming it is optional.

```ts
// Consume the signal to cancel real resources
const fn = (url: string, signal?: AbortSignal) =>
  fetch(url, { signal })

task(fn).timeout(5000)('https://api.example.com')
// → fn receives merged AbortSignal
// → if timeout fires → controller.abort() → fetch is cancelled
```

### Passing an external signal

If you need manual cancellation alongside the policies, pass an `AbortSignal` as the last call argument. It is merged with any internal signals via `AbortSignal.any()`.

```ts
const controller = new AbortController()
const promise = task(fn)
  .timeout(5000)
  .retry(3)('url', controller.signal)

// Later — cancels both the timeout timer and the function
controller.abort()
```

### What is cancelled

| What | Cancelled? |
|------|-----------|
| `fn` execution | ✅ If fn consumes the signal (e.g. `fetch(url, { signal })`) |
| Delay between retries | ✅ Stops retry loop immediately |
| Delay policy | ✅ Aborted, fn is not called |
| Timeout's own timer | ✅ Cleared when external signal aborts |
| Circuit breaker / Fallback | ✅ `signal.aborted` check at entry |

### What is NOT cancelled

- `fn` that ignores the signal (no zombie prevention if you choose not to opt in)
- Code already executing inside `fn` when signal fires (cooperative cancellation only)

## Composition

Policies chain fluently and can be combined in any order.

```ts
const resilient = task(callApi)
  .retry({ attempts: 3, backoff: 'exponential' })
  .timeout(5000)
  .fallback(loadFromCache)
  .circuitBreaker({ failureThreshold: 5, successThreshold: 2, resetTimeout: 30_000 })
  .delay(100)
```

## API

### `task(fn)`

Wrap a function with resilience policies. Returns a callable with the same signature plus chainable methods.

| Method                        | Description                         |
| ----------------------------- | ----------------------------------- |
| `.retry(attempts \| options)` | Retry on failure                    |
| `.timeout(ms)`                | Reject after elapsed time           |
| `.fallback(fn)`               | Alternative on failure              |
| `.circuitBreaker(options)`    | Closed/open/half-open state machine |
| `.delay(ms)`                  | Wait before execution               |

### Errors

- `TaskTimeoutError` — thrown by `.timeout()` when the time elapses
- `CircuitBreakerOpenError` — thrown by `.circuitBreaker()` when the circuit is open

## License

MIT
