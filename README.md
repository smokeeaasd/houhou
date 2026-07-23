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

## Composition

Policies chain fluently and can be combined in any order. Each policy can be configured only once per task — attempting to set it again throws at runtime and is prevented at the type level.

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
