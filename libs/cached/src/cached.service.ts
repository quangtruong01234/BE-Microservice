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

  async decr(key: string): Promise<number> {
    return await this.redis.decr(key);
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
