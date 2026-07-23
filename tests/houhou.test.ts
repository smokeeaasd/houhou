import { describe, it, expect, vi } from 'vitest'
import { task } from '../src/task'
import { TaskTimeoutError } from '../src/errors'
import type { Task } from '../src/types'

// type-level tests (validated by tsc, skipped in runtime)
describe.skip('type-lock', () => {
  it('prevents double configuration of any policy', () => {
    const fn = async (x: number) => x
    const t = task(fn)
      .retry({ attempts: 3 })
      .timeout(1000)
      .fallback(() => 0)
      .delay(10)
      .circuitBreaker({ failureThreshold: 5, successThreshold: 2, resetTimeout: 30000 })

    // @ts-expect-error
    t.retry({ attempts: 2 })

    // @ts-expect-error
    t.timeout(500)

    // @ts-expect-error
    t.fallback(() => 1)

    // @ts-expect-error
    t.delay(20)

    // @ts-expect-error
    t.circuitBreaker({ failureThreshold: 3, successThreshold: 1, resetTimeout: 10000 })
  })
})

describe('task', () => {
  it('returns a callable function', async () => {
    const fn = task(async (x: number) => x + 1)
    expect(await fn(1)).toBe(2)
  })

  it('preserves argument types', () => {
    const fn = task((a: string, b: number) => `${a}${b}`)
    fn('x', 1)
  })

  it('preserves return type', async () => {
    const fn = task((x: number) => Promise.resolve(x.toString()))
    const result = await fn(42)
    expect(typeof result).toBe('string')
  })

  it('accepts sync functions', async () => {
    const fn = task((x: number) => x * 2)
    expect(await fn(3)).toBe(6)
  })

  it('returns a promise', () => {
    const fn = task((x: number) => x)
    const result = fn(1)
    expect(result).toBeInstanceOf(Promise)
  })
})

describe('retry', () => {
  it('succeeds on first attempt', async () => {
    const fn = vi.fn().mockResolvedValue('ok')
    const wrapped = task(fn).retry({ attempts: 3 })
    expect(await wrapped()).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('retries on failure and succeeds', async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error('fail')).mockResolvedValueOnce('ok')
    const wrapped = task(fn).retry({ attempts: 3 })
    expect(await wrapped()).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('accepts shorthand retry(3) for retry({ attempts: 3 })', async () => {
    const fn = vi.fn().mockResolvedValue('ok')
    const wrapped = task(fn).retry(3)
    expect(await wrapped()).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('retries on failure with shorthand retry(3)', async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error('fail')).mockResolvedValueOnce('ok')
    const wrapped = task(fn).retry(3)
    expect(await wrapped()).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('throws last error after exhausting attempts', async () => {
    const error = new Error('permanent')
    const fn = vi.fn().mockRejectedValue(error)
    const wrapped = task(fn).retry({ attempts: 3 })
    await expect(wrapped()).rejects.toThrow(error)
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('passes arguments correctly', async () => {
    const fn = vi.fn().mockResolvedValue('ok')
    const wrapped = task(fn).retry({ attempts: 3 })
    await wrapped('a', 1)
    expect(fn).toHaveBeenCalledWith('a', 1)
  })

  it('uses fixed backoff delay', async () => {
    vi.useFakeTimers()
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValueOnce('ok')
    const wrapped = task(fn).retry({ attempts: 3, delay: 100 })
    const promise = wrapped()
    await vi.advanceTimersByTimeAsync(100)
    expect(fn).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(200)
    await expect(promise).resolves.toBe('ok')
    vi.useRealTimers()
  })

  it('only runs once with attempts: 1', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('fail'))
    const wrapped = task(fn).retry({ attempts: 1 })
    await expect(wrapped()).rejects.toThrow('fail')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('throws RangeError when attempts < 1', () => {
    expect(() => task(async () => {}).retry(0)).toThrow(RangeError)
    expect(() => task(async () => {}).retry({ attempts: 0 })).toThrow(RangeError)
    expect(() => task(async () => {}).retry({ attempts: -1 })).toThrow(RangeError)
  })

  it('uses exponential backoff', async () => {
    vi.useFakeTimers()
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValueOnce('ok')
    const wrapped = task(fn).retry({ attempts: 3, delay: 100, backoff: 'exponential' })
    const promise = wrapped()
    await vi.advanceTimersByTimeAsync(100)
    expect(fn).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(200)
    expect(fn).toHaveBeenCalledTimes(3)
    await expect(promise).resolves.toBe('ok')
    vi.useRealTimers()
  })

  it('works with jitter enabled', async () => {
    vi.useFakeTimers()
    const fn = vi.fn().mockRejectedValueOnce(new Error('fail')).mockResolvedValueOnce('ok')
    const wrapped = task(fn).retry({ attempts: 2, delay: 100, jitter: true })
    const promise = wrapped()
    await vi.advanceTimersByTimeAsync(200)
    await expect(promise).resolves.toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })

  it('stops retry loop when external signal is aborted', async () => {
    const ac = new AbortController()
    const fn = vi.fn().mockRejectedValue(new Error('fail'))
    const wrapped = task(fn).retry({ attempts: 10, delay: 100 })

    setTimeout(() => ac.abort(new Error('user cancelled')), 30)
    await expect(wrapped('url', ac.signal)).rejects.toThrow('user cancelled')
    expect(fn.mock.calls.length).toBeLessThan(10)
  }, 5000)
})

describe('timeout', () => {
  it('returns result when function completes in time', async () => {
    const fn = vi.fn().mockResolvedValue('ok')
    const wrapped = task(fn).timeout(5000)
    await expect(wrapped()).resolves.toBe('ok')
  })

  it('rejects with TaskTimeoutError when function is too slow', async () => {
    const start = Date.now()
    const fn = vi.fn().mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 200)))
    const wrapped = task(fn).timeout(20)
    await expect(wrapped()).rejects.toThrow('timed out')
    expect(Date.now() - start).toBeLessThan(100)
  }, 5000)

  it('includes the error name TaskTimeoutError', async () => {
    const fn = vi.fn().mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 200)))
    const wrapped = task(fn).timeout(20)
    await expect(wrapped()).rejects.toMatchObject({ name: 'TaskTimeoutError' })
  }, 5000)

  it('does not affect fast functions', async () => {
    const fn = vi.fn().mockResolvedValue(42)
    const wrapped = task(fn).timeout(5000)
    await expect(wrapped()).resolves.toBe(42)
  })

  it('throws RangeError when ms < 1', () => {
    expect(() => task(async () => {}).timeout(0)).toThrow(RangeError)
    expect(() => task(async () => {}).timeout(-1)).toThrow(RangeError)
  })

  it('stores ms on TaskTimeoutError', async () => {
    const fn = vi.fn().mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 200)))
    const timeoutMs = 20
    const wrapped = task(fn).timeout(timeoutMs)
    try {
      await wrapped()
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(TaskTimeoutError)
      expect((error as TaskTimeoutError).ms).toBe(timeoutMs)
    }
  })

  it('passes AbortSignal that is aborted on timeout', async () => {
    let receivedSignal: AbortSignal | undefined
    const fn = vi.fn().mockImplementation((_url: string, signal?: AbortSignal) => {
      receivedSignal = signal
      return new Promise((resolve) => setTimeout(resolve, 200))
    })
    const wrapped = task(fn).timeout(50)
    await expect(wrapped('url')).rejects.toThrow('timed out')
    expect(receivedSignal).toBeInstanceOf(AbortSignal)
    expect(receivedSignal?.aborted).toBe(true)
  }, 5000)

  it('cancels timer and rejects when external signal aborts', async () => {
    const ac = new AbortController()
    const fn = vi.fn().mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 200)))
    const wrapped = task(fn).timeout(5000)

    setTimeout(() => ac.abort(new Error('user cancelled')), 10)
    await expect(wrapped('url', ac.signal)).rejects.toThrow('user cancelled')
    expect(fn).toHaveBeenCalledTimes(1)
  }, 5000)
})

describe('fallback', () => {
  it('returns the main result on success', async () => {
    const fn = vi.fn().mockResolvedValue('main')
    const fallback = vi.fn().mockResolvedValue('fallback')
    const wrapped = task(fn).fallback(fallback)
    await expect(wrapped()).resolves.toBe('main')
    expect(fallback).not.toHaveBeenCalled()
  })

  it('calls fallback when main fails', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('fail'))
    const fallback = vi.fn().mockResolvedValue('fallback')
    const wrapped = task(fn).fallback(fallback)
    await expect(wrapped()).resolves.toBe('fallback')
    expect(fallback).toHaveBeenCalledTimes(1)
  })

  it('passes arguments to fallback', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('fail'))
    const fallback = vi.fn().mockResolvedValue('ok')
    const wrapped = task(fn).fallback(fallback)
    await wrapped('a', 1)
    expect(fallback).toHaveBeenCalledWith('a', 1)
  })

  it('propagates error when fallback also fails', async () => {
    const error = new Error('fallback also failed')
    const fn = vi.fn().mockRejectedValue(new Error('main fail'))
    const fallback = vi.fn().mockRejectedValue(error)
    const wrapped = task(fn).fallback(fallback)
    await expect(wrapped()).rejects.toThrow(error)
  })

  it('infer union return type', async () => {
    const fn = vi.fn<(x: number) => Promise<string>>().mockResolvedValue('ok')
    const alt = vi.fn<(x: number) => number>().mockResolvedValue(42)
    const wrapped = task(fn).fallback(alt)
    const result = await wrapped(1)
    expect(typeof result === 'string' || typeof result === 'number').toBe(true)
  })

  it('rejects immediately when signal is already aborted', async () => {
    const ac = new AbortController()
    ac.abort(new Error('cancelled'))
    const fn = vi.fn()
    const fallback = vi.fn()
    const wrapped = task(fn).fallback(fallback)
    await expect(wrapped(ac.signal)).rejects.toThrow('cancelled')
    expect(fn).not.toHaveBeenCalled()
    expect(fallback).not.toHaveBeenCalled()
  })
})

describe('delay', () => {
  it('delays execution by the specified time', async () => {
    vi.useFakeTimers()
    const fn = vi.fn().mockResolvedValue('ok')
    const wrapped = task(fn).delay(50)
    const promise = wrapped()
    expect(fn).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(50)
    await expect(promise).resolves.toBe('ok')
    vi.useRealTimers()
  })

  it('returns the function result after delay', async () => {
    vi.useFakeTimers()
    const fn = vi.fn().mockResolvedValue(42)
    const wrapped = task(fn).delay(10)
    const promise = wrapped()
    await vi.advanceTimersByTimeAsync(10)
    await expect(promise).resolves.toBe(42)
    vi.useRealTimers()
  })

  it('propagates errors', async () => {
    const error = new Error('fail')
    const fn = vi.fn().mockRejectedValue(error)
    const wrapped = task(fn).delay(10)
    await expect(wrapped()).rejects.toThrow(error)
  })

  it('throws RangeError when ms < 1', () => {
    expect(() => task(async () => {}).delay(0)).toThrow(RangeError)
    expect(() => task(async () => {}).delay(-1)).toThrow(RangeError)
  })

  it('aborts delay when external signal is aborted', async () => {
    const ac = new AbortController()
    const fn = vi.fn()
    const wrapped = task(fn).delay(5000)

    setTimeout(() => ac.abort(new Error('cancelled')), 10)
    await expect(wrapped(ac.signal)).rejects.toThrow('cancelled')
    expect(fn).not.toHaveBeenCalled()
  }, 5000)
})

describe('circuit breaker', () => {
  it('succeeds when closed', async () => {
    const fn = vi.fn().mockResolvedValue('ok')
    const wrapped = task(fn).circuitBreaker({
      failureThreshold: 3,
      successThreshold: 1,
      resetTimeout: 1000
    })
    await expect(wrapped()).resolves.toBe('ok')
  })

  it('opens after failureThreshold failures', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('fail'))
    const wrapped = task(fn).circuitBreaker({
      failureThreshold: 2,
      successThreshold: 1,
      resetTimeout: 1000
    })
    await expect(wrapped()).rejects.toThrow('fail')
    await expect(wrapped()).rejects.toThrow('fail')
    await expect(wrapped()).rejects.toThrow('Circuit breaker is open')
  })

  it('rejects immediately when open', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('fail'))
    const wrapped = task(fn).circuitBreaker({
      failureThreshold: 1,
      successThreshold: 1,
      resetTimeout: 5000
    })
    await expect(wrapped()).rejects.toThrow('fail')
    expect(fn).toHaveBeenCalledTimes(1)
    await expect(wrapped()).rejects.toThrow('Circuit breaker is open')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('transitions to half-open after resetTimeout', async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error('fail')).mockResolvedValueOnce('recovered')
    const wrapped = task(fn).circuitBreaker({
      failureThreshold: 1,
      successThreshold: 1,
      resetTimeout: 50
    })
    await expect(wrapped()).rejects.toThrow('fail')
    await expect(wrapped()).rejects.toThrow('Circuit breaker is open')
    await new Promise((resolve) => setTimeout(resolve, 60))
    await expect(wrapped()).resolves.toBe('recovered')
  }, 5000)

  it('returns to open if half-open call fails', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('first'))
      .mockRejectedValueOnce(new Error('second'))
    const wrapped = task(fn).circuitBreaker({
      failureThreshold: 1,
      successThreshold: 1,
      resetTimeout: 50
    })
    await expect(wrapped()).rejects.toThrow('first')
    await waitForHalfOpen(60)
    await expect(wrapped()).rejects.toThrow('second')
    await expect(wrapped()).rejects.toThrow('Circuit breaker is open')
  }, 5000)

  it('throws RangeError when failureThreshold < 1', () => {
    expect(() =>
      task(async () => {}).circuitBreaker({
        failureThreshold: 0,
        successThreshold: 1,
        resetTimeout: 1000
      })
    ).toThrow(RangeError)
  })

  it('throws RangeError when successThreshold < 1', () => {
    expect(() =>
      task(async () => {}).circuitBreaker({
        failureThreshold: 1,
        successThreshold: 0,
        resetTimeout: 1000
      })
    ).toThrow(RangeError)
  })

  it('throws RangeError when resetTimeout < 1', () => {
    expect(() =>
      task(async () => {}).circuitBreaker({
        failureThreshold: 1,
        successThreshold: 1,
        resetTimeout: 0
      })
    ).toThrow(RangeError)
  })

  it('requires multiple successes in half-open to close', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValueOnce('ok1')
      .mockResolvedValueOnce('ok2')
      .mockRejectedValueOnce(new Error('fail2'))
    const wrapped = task(fn).circuitBreaker({
      failureThreshold: 1,
      successThreshold: 2,
      resetTimeout: 50
    })

    await expect(wrapped()).rejects.toThrow('fail')
    await expect(wrapped()).rejects.toThrow('Circuit breaker is open')

    await waitForHalfOpen(60)

    await expect(wrapped()).resolves.toBe('ok1')
    await expect(wrapped()).resolves.toBe('ok2')
    await expect(wrapped()).rejects.toThrow('fail2')
    await expect(wrapped()).rejects.toThrow('Circuit breaker is open')
  }, 10000)

  it('rejects immediately when signal is already aborted', async () => {
    const ac = new AbortController()
    ac.abort(new Error('cancelled'))
    const fn = vi.fn()
    const wrapped = task(fn).circuitBreaker({
      failureThreshold: 3,
      successThreshold: 1,
      resetTimeout: 1000
    })
    await expect(wrapped(ac.signal)).rejects.toThrow('cancelled')
    expect(fn).not.toHaveBeenCalled()
  })

  it('maintains independent state across instances', async () => {
    const fn1 = vi.fn().mockRejectedValue(new Error('fail'))
    const fn2 = vi.fn().mockRejectedValue(new Error('fail'))
    const cb1 = task(fn1).circuitBreaker({
      failureThreshold: 1,
      successThreshold: 1,
      resetTimeout: 5000
    })
    const cb2 = task(fn2).circuitBreaker({
      failureThreshold: 1,
      successThreshold: 1,
      resetTimeout: 5000
    })

    await expect(cb1()).rejects.toThrow('fail')
    await expect(cb1()).rejects.toThrow('Circuit breaker is open')
    await expect(cb2()).rejects.toThrow('fail')
    expect(fn2).toHaveBeenCalledTimes(1)
  })

  it('resets failure count on success', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValueOnce('ok')
      .mockRejectedValueOnce(new Error('fail2'))
      .mockResolvedValueOnce('ok2')
    const wrapped = task(fn).circuitBreaker({
      failureThreshold: 1,
      successThreshold: 1,
      resetTimeout: 50
    })
    await expect(wrapped()).rejects.toThrow('fail')
    await waitForHalfOpen(60)
    await expect(wrapped()).resolves.toBe('ok')
    await expect(wrapped()).rejects.toThrow('fail2')
    await waitForHalfOpen(60)
    await expect(wrapped()).resolves.toBe('ok2')
  }, 10000)
})

describe('lock policies', () => {
  it('throws at runtime when configuring same policy twice', () => {
    const fn = async (x: number) => x
    const t = task(fn).retry({ attempts: 3 })

    expect(() => {
      ;(t as Task<[number], number>).retry({ attempts: 3 })
    }).toThrow('"retry" is already configured')
  })

  it('throws for each policy only once', () => {
    const fn = async () => 'ok'
    const t = task(fn).retry({ attempts: 3 }).timeout(1000).delay(10)

    expect(() => {
      ;(t as Task<[], string>).retry({ attempts: 3 })
    }).toThrow('retry')

    expect(() => {
      ;(t as Task<[], string>).timeout(100)
    }).toThrow('timeout')

    expect(() => {
      ;(t as Task<[], string>).delay(5)
    }).toThrow('delay')
  })

  it('allows same policy on separate instances', () => {
    const fn = async (x: number) => x
    const a = task(fn).retry({ attempts: 1 })
    const b = task(fn).retry({ attempts: 1 })

    expect(() => {
      ;(a as Task<[number], number>).retry({ attempts: 1 })
    }).toThrow()

    expect(() => {
      ;(b as Task<[number], number>).retry({ attempts: 1 })
    }).toThrow()
  })
})

describe('composition', () => {
  it('timeout wraps retry when configured after retry', async () => {
    const fn = vi.fn().mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 200)))
    const wrapped = task(fn).retry({ attempts: 3, delay: 10 }).timeout(50)
    await expect(wrapped()).rejects.toThrow('timed out')
    expect(fn).toHaveBeenCalledTimes(1)
    // Wait to ensure no zombie retries fire after timeout
    await new Promise((resolve) => setTimeout(resolve, 500))
    expect(fn).toHaveBeenCalledTimes(1)
  }, 10000)

  it('retry wraps timeout when configured after timeout', async () => {
    const fn = vi.fn().mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 200)))
    const wrapped = task(fn).timeout(50).retry({ attempts: 3, delay: 10 })
    await expect(wrapped()).rejects.toThrow('timed out')
    expect(fn).toHaveBeenCalledTimes(3)
  }, 10000)
})

async function waitForHalfOpen(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}
