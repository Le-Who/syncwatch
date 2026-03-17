import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LRUCache } from '../lib/lru-cache';

describe('LRUCache', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should store and retrieve values', () => {
    const cache = new LRUCache<string, number>(3);
    cache.set('a', 1);
    cache.set('b', 2);

    expect(cache.get('a')).toBe(1);
    expect(cache.get('b')).toBe(2);
    expect(cache.get('c')).toBeUndefined();
  });

  it('should correctly report if it has a key', () => {
    const cache = new LRUCache<string, number>(3);
    cache.set('a', 1);

    expect(cache.has('a')).toBe(true);
    expect(cache.has('b')).toBe(false);
  });

  it('should evict the least recently used item when max size is exceeded (insertion)', () => {
    const cache = new LRUCache<string, number>(2);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);

    expect(cache.has('a')).toBe(false);
    expect(cache.get('b')).toBe(2);
    expect(cache.get('c')).toBe(3);
  });

  it('should update the LRU status on get', () => {
    const cache = new LRUCache<string, number>(2);
    cache.set('a', 1);
    cache.set('b', 2);

    // Access 'a', making 'b' the least recently used
    cache.get('a');

    cache.set('c', 3);

    expect(cache.has('a')).toBe(true);
    expect(cache.has('b')).toBe(false);
    expect(cache.get('c')).toBe(3);
  });

  it('should update the value and LRU status on set for an existing key', () => {
    const cache = new LRUCache<string, number>(2);
    cache.set('a', 1);
    cache.set('b', 2);

    // Update 'a', making 'b' the least recently used
    cache.set('a', 10);

    cache.set('c', 3);

    expect(cache.get('a')).toBe(10);
    expect(cache.has('b')).toBe(false);
    expect(cache.get('c')).toBe(3);
  });

  it('should respect TTL on get', () => {
    const cache = new LRUCache<string, number>(3, 1000);
    cache.set('a', 1);

    expect(cache.get('a')).toBe(1);

    vi.advanceTimersByTime(1001);

    expect(cache.get('a')).toBeUndefined();
  });

  it('should respect TTL on has', () => {
    const cache = new LRUCache<string, number>(3, 1000);
    cache.set('a', 1);

    expect(cache.has('a')).toBe(true);

    vi.advanceTimersByTime(1001);

    expect(cache.has('a')).toBe(false);
  });
});
