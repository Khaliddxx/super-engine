import { Queue, Worker, QueueEvents, type Processor } from "bullmq";
import { redis } from "./redis.js";

export const QUEUE_NAMES = {
  pipeline: "pipeline",
  inbox: "inbox",
  send: "send",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

const queueCache = new Map<string, Queue>();

export function getQueue(name: QueueName): Queue {
  let q = queueCache.get(name);
  if (!q) {
    q = new Queue(name, {
      connection: redis(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: { count: 500 },
        removeOnFail: { count: 500 },
      },
    });
    queueCache.set(name, q);
  }
  return q;
}

export function createWorker<T = unknown, R = unknown>(
  name: QueueName,
  processor: Processor<T, R>,
  concurrency = 3,
): Worker<T, R> {
  return new Worker<T, R>(name, processor, {
    connection: redis(),
    concurrency,
  });
}

export { QueueEvents };
