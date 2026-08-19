import { Inject, Injectable } from "@nestjs/common";
import Redis from "ioredis";

@Injectable()
export class CachedService {
  constructor(@Inject("REDIS_CLIENT") private readonly redis: Redis) {}

  async setFooBar() {
    await this.redis.set("foo", "bar");
    const result = await this.redis.get("foo");
    console.log(result);
  }

  async get(key: string): Promise<string | null> {
    return await this.redis.get(key);
  }

  async ping(): Promise<string> {
    return await this.redis.ping();
  }

  /**
   * Batch read (MGET). Returns one entry per key, in the same order —
   * `null` for keys that do not exist. One round-trip instead of N gets.
   */
  async mget(keys: string[]): Promise<(string | null)[]> {
    if (keys.length === 0) {
      return [];
    }
    return await this.redis.mget(...keys);
  }

  async set(key: string, value: string, expireSeconds?: number): Promise<"OK"> {
    if (expireSeconds) {
      return await this.redis.set(key, value, "EX", expireSeconds);
    }
    return await this.redis.set(key, value);
  }

  /**
   * Atomically set a key only if it does not already exist (SET NX EX).
   * Returns true if the key was claimed, false if it already existed.
   * Used for idempotency locks / single-flight guards.
   */
  async setNx(
    key: string,
    value: string,
    expireSeconds: number,
  ): Promise<boolean> {
    const result = await this.redis.set(key, value, "EX", expireSeconds, "NX");
    return result === "OK";
  }

  async del(key: string): Promise<number> {
    return await this.redis.del(key);
  }

  async exists(key: string): Promise<number> {
    return await this.redis.exists(key);
  }

  async expire(key: string, seconds: number): Promise<number> {
    return await this.redis.expire(key, seconds);
  }

  async incr(key: string): Promise<number> {
    return await this.redis.incr(key);
  }

  /**
   * Atomic INCR that guarantees the key carries a TTL. Plain INCR + EXPIRE
   * ("expire only when count === 1") loses the EXPIRE under concurrency,
   * leaving a counter with TTL -1 that never resets (permanent 429 for
   * rate-limit windows). The Lua script increments and (re)arms the TTL in
   * one atomic step whenever the key has no expiry — which also self-heals
   * keys already stuck at TTL -1.
   */
  async incrementWithWindow(
    key: string,
    windowSeconds: number,
  ): Promise<number> {
    const result = await this.redis.eval(
      `local count = redis.call('INCR', KEYS[1])
       if redis.call('TTL', KEYS[1]) < 0 then
         redis.call('EXPIRE', KEYS[1], ARGV[1])
       end
       return count`,
      1,
      key,
      windowSeconds,
    );
    return Number(result);
  }

  async decr(key: string): Promise<number> {
    return await this.redis.decr(key);
  }

  /**
   * Claim one unit from a counter that seeds itself on first touch, atomically.
   * Used as a cheap admission gate in front of a scarce SQL resource (voucher
   * quota): the losers are rejected here, before the request spends anything
   * expensive downstream, while SQL stays the source of truth.
   *
   * Seeding, the bound check and the decrement have to be ONE step — a
   * GET-then-DECR pair lets N concurrent callers all read the last unit and
   * every one of them claim it. Returns the remaining count after the claim,
   * or -1 when the quota was already exhausted (nothing is decremented then,
   * so the counter never runs away below zero).
   *
   * The TTL makes the counter self-healing: once it lapses, the next caller
   * re-seeds from whatever the caller reads out of SQL, so drift cannot
   * accumulate.
   */
  async claimFromSeededQuota(
    key: string,
    seedRemaining: number,
    ttlSeconds: number,
  ): Promise<number> {
    const result = await this.redis.eval(
      `local remaining = redis.call('GET', KEYS[1])
       if not remaining then
         redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
         remaining = ARGV[1]
       end
       if tonumber(remaining) <= 0 then
         return -1
       end
       return redis.call('DECR', KEYS[1])`,
      1,
      key,
      seedRemaining,
      ttlSeconds,
    );
    return Number(result);
  }

  /**
   * Give one unit back to a counter claimed via {@link claimFromSeededQuota},
   * for when the work the claim was covering did not go through.
   *
   * Deliberately does NOT recreate an expired key: a plain INCR would resurrect
   * it as a TTL-less counter holding `1`, which then reads as "one unit left"
   * forever. If the key is gone the release is a no-op (-1) and the next claim
   * re-seeds from SQL, which by then already reflects the rollback.
   */
  async releaseToSeededQuota(key: string): Promise<number> {
    const result = await this.redis.eval(
      `if redis.call('EXISTS', KEYS[1]) == 0 then
         return -1
       end
       return redis.call('INCR', KEYS[1])`,
      1,
      key,
    );
    return Number(result);
  }

  // Hashes
  async hget(hash: string, field: string): Promise<string | null> {
    return await this.redis.hget(hash, field);
  }

  async hset(hash: string, field: string, value: string): Promise<number> {
    return await this.redis.hset(hash, field, value);
  }

  async hdel(hash: string, field: string): Promise<number> {
    return await this.redis.hdel(hash, field);
  }

  async hgetall(hash: string): Promise<Record<string, string>> {
    return await this.redis.hgetall(hash);
  }

  // Lists
  async lpush(key: string, ...values: string[]): Promise<number> {
    return await this.redis.lpush(key, ...values);
  }

  async rpush(key: string, ...values: string[]): Promise<number> {
    return await this.redis.rpush(key, ...values);
  }

  async lpop(key: string): Promise<string | null> {
    return await this.redis.lpop(key);
  }

  async rpop(key: string): Promise<string | null> {
    return await this.redis.rpop(key);
  }

  // Sets
  async sadd(key: string, ...members: string[]): Promise<number> {
    return await this.redis.sadd(key, ...members);
  }

  async srem(key: string, ...members: string[]): Promise<number> {
    return await this.redis.srem(key, ...members);
  }

  async smembers(key: string): Promise<string[]> {
    return await this.redis.smembers(key);
  }

  // Sorted Sets
  async zadd(key: string, ...args: (string | number)[]): Promise<number> {
    return await this.redis.zadd(key, ...args);
  }

  async zrange(
    key: string,
    start: number,
    stop: number,
    withScores = false,
  ): Promise<string[]> {
    if (withScores) {
      return await this.redis.zrange(key, start, stop, "WITHSCORES");
    }
    return await this.redis.zrange(key, start, stop);
  }

  async zrem(key: string, ...members: string[]): Promise<number> {
    return await this.redis.zrem(key, ...members);
  }

  async keys(pattern: string): Promise<string[]> {
    return await this.redis.keys(pattern);
  }
}
