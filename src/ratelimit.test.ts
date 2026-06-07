import { describe, it, expect } from 'vitest'
import {
  RULES,
  MEMBER_CAP,
  windowId,
  windowEndIso,
  bucketKey,
  decide,
  utcDateStamp,
  hashIp,
} from './ratelimit'

describe('rules', () => {
  it('match PLAN §7', () => {
    expect(RULES.create).toMatchObject({ limit: 5, windowMs: 86_400_000 })
    expect(RULES.unlock).toMatchObject({ limit: 5, windowMs: 600_000, perGroup: true })
    expect(RULES.addMember).toMatchObject({ limit: 10, windowMs: 3_600_000 })
    expect(RULES.vcard).toMatchObject({ limit: 30, windowMs: 60_000 })
    expect(MEMBER_CAP).toBe(75)
  })
})

describe('window math', () => {
  it('computes window id and end deterministically', () => {
    expect(windowId(0, 60_000)).toBe(0)
    expect(windowId(60_000, 60_000)).toBe(1)
    expect(windowId(119_999, 60_000)).toBe(1)
    expect(windowEndIso(0, 60_000)).toBe('1970-01-01T00:01:00.000Z')
    expect(windowEndIso(61_000, 60_000)).toBe('1970-01-01T00:02:00.000Z')
  })
})

describe('bucketKey', () => {
  it('encodes action/ip/window and includes group only when perGroup', () => {
    expect(bucketKey(RULES.create, 'IPH', 0)).toBe('create:IPH:0')
    expect(bucketKey(RULES.unlock, 'IPH', 0, 42)).toBe('unlock:IPH:42:0')
    // perGroup rule without a group id falls back to a stable placeholder
    expect(bucketKey(RULES.unlock, 'IPH', 0)).toBe('unlock:IPH:na:0')
  })

  it('isolates /unlock counters per group (one group cannot drain another)', () => {
    const t = 5_000
    expect(bucketKey(RULES.unlock, 'IP', t, 1)).not.toBe(bucketKey(RULES.unlock, 'IP', t, 2))
  })

  it('rolls to a fresh bucket exactly at the window boundary', () => {
    const w = RULES.unlock.windowMs
    // last ms of window 0 shares a bucket with the start of window 0
    expect(bucketKey(RULES.unlock, 'IP', w - 1, 7)).toBe(bucketKey(RULES.unlock, 'IP', 0, 7))
    // the very next ms is a new window → new bucket (counter resets next window)
    expect(bucketKey(RULES.unlock, 'IP', w, 7)).not.toBe(bucketKey(RULES.unlock, 'IP', 0, 7))
    // windowEndIso is the purge cursor: exact next boundary for a mid-window time
    expect(windowEndIso(w - 1, w)).toBe(new Date(w).toISOString())
  })
})

describe('decide', () => {
  it('allows while count <= limit', () => {
    expect(decide(1, 5)).toEqual({ allowed: true, remaining: 4 })
    expect(decide(5, 5)).toEqual({ allowed: true, remaining: 0 })
    expect(decide(6, 5)).toEqual({ allowed: false, remaining: 0 })
  })

  it('keeps rejecting once over-limit — the window stays hot (brute-force defense)', () => {
    // Simulate the counter incrementing on every attempt INCLUDING rejected ones
    // (checkRateLimit increments even when over-limit). /unlock limit = 5.
    const limit = RULES.unlock.limit
    const verdicts = Array.from({ length: 7 }, (_, i) => decide(i + 1, limit))
    expect(verdicts.slice(0, 5).every((v) => v.allowed)).toBe(true) // attempts 1..5 allowed
    expect(verdicts[5]).toEqual({ allowed: false, remaining: 0 }) // 6th rejected
    expect(verdicts[6]).toEqual({ allowed: false, remaining: 0 }) // 7th still rejected (no reset)
  })
})

describe('utcDateStamp / hashIp', () => {
  it('stamps YYYYMMDD in UTC', () => {
    expect(utcDateStamp(0)).toBe('19700101')
    expect(utcDateStamp(Date.parse('2026-06-07T23:59:00Z'))).toBe('20260607')
  })

  it('produces a hex hash that rotates by day, ip, and secret', async () => {
    const day1 = Date.parse('2026-06-07T10:00:00Z')
    const day2 = Date.parse('2026-06-08T10:00:00Z')
    const a = await hashIp('1.2.3.4', 'secret', day1)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(await hashIp('1.2.3.4', 'secret', day1)).toBe(a) // stable within day
    expect(await hashIp('1.2.3.4', 'secret', day2)).not.toBe(a) // rotates next day
    expect(await hashIp('9.9.9.9', 'secret', day1)).not.toBe(a) // per-ip
    expect(await hashIp('1.2.3.4', 'other', day1)).not.toBe(a) // per-secret
  })
})
