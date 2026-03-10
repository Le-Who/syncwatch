export class LRUCache<K, V> {
  private cache: Map<K, { value: V; expiresAt?: number }>;
  private maxSize: number;
  private ttlMs?: number;

  constructor(maxSize: number, ttlMs?: number) {
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
    this.cache = new Map();
  }

  get(key: K): V | undefined {
    const item = this.cache.get(key);
    if (!item) return undefined;

    if (item.expiresAt && Date.now() > item.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }

    // Refresh position for LRU
    this.cache.delete(key);
    this.cache.set(key, item);
    return item.value;
  }

  set(key: K, value: V) {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) this.cache.delete(firstKey);
    }

    const expiresAt = this.ttlMs ? Date.now() + this.ttlMs : undefined;
    this.cache.set(key, { value, expiresAt });
  }

  has(key: K): boolean {
    const item = this.cache.get(key);
    if (!item) return false;
    if (item.expiresAt && Date.now() > item.expiresAt) {
      this.cache.delete(key);
      return false;
    }
    return true;
  }
}
