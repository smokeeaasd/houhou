import { describe, it, expect, vi } from 'vitest'
import { task } from '../src/task'
import type { Task } from '../src/types'

// type-level tests (validated by tsc, skipped in runtime)
describe.skip('type-lock', () => {
  it('prevents double configuration', () => {
    const fn = async (x: number) => x
    const t = task(fn).retry({ attempts: 3 }).timeout(1000)

    // @ts-expect-error — 'retry' is locked
    t.retry({ attempts: 2 })

    // @ts-expect-error — 'timeout' is locked
    t.timeout(500)

    t.fallback(() => 0)
    t.delay(10)
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

async function waitForHalfOpen(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}
