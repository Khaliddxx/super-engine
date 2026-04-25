import IORedis from "ioredis";
import { env } from "./env.js";

let cached: IORedis | null = null;

export function redis(): IORedis {
  if (cached) return cached;
  cached = new IORedis(env().REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    family: 0, // allow both IPv4 and IPv6 (Upstash)
  });
  return cached;
}
