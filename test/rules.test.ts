import { describe, expect, it } from 'vitest';
import { windowState } from '../src/rules.js';

const start = new Date('2026-12-14T08:00:00Z');
const at = (minutes: number) => new Date(start.getTime() + minutes * 60_000);

describe('windowState', () => {
  it('is upcoming until 5 minutes before the start', () => {
    expect(windowState(start, at(-60))).toBe('upcoming');
    expect(windowState(start, at(-5.01))).toBe('upcoming');
  });

  it('is open from 5 minutes before to 5 minutes after, inclusive', () => {
    expect(windowState(start, at(-5))).toBe('open');
    expect(windowState(start, at(0))).toBe('open');
    expect(windowState(start, at(5))).toBe('open');
  });

  it('is closed after 5 minutes past the start', () => {
    expect(windowState(start, at(5.01))).toBe('closed');
    expect(windowState(start, at(60))).toBe('closed');
  });
});
