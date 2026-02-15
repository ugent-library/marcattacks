// slow-writable.ts
import { Writable, type WritableOptions } from "stream";
import log4js from 'log4js';

const logger = log4js.getLogger();

export interface SlowWritableOptions extends WritableOptions {
  /**
   * Delay per chunk (ms). Default 200 ms.
   */
  delayMs?: number;

  /**
   * Maximum number of concurrent "in-flight" asynchronous writes.
   * While more writes may be queued, only up to this number will be processed in parallel.
   * Default 1.
   */
  maxConcurrency?: number;

  /**
   * If set to a positive integer n, every nth chunk will produce an error (for testing).
   * Default 0 (never error).
   */
  simulateErrorEveryN?: number;
}

/**
 * SlowWritable: a Writable stream that processes writes asynchronously
 * with an artificial delay and optional concurrency control.
 */
export class SlowWritable extends Writable {
  private delayMs: number;
  private maxConcurrency: number;
  private simulateErrorEveryN: number;
  private inFlight = 0;
  private queue: Array<{
    chunk: any;
    encoding: BufferEncoding;
    callback: (err?: Error | null) => void;
    seq: number;
  }> = [];
  private seqCounter = 0;
  private destroyedFlag = false;

  constructor(opts: SlowWritableOptions = {}) {
    // Keep objectMode/encoding behavior from user but default to object mode false
    const { delayMs = 200, maxConcurrency = 1, simulateErrorEveryN = 0, ...writableOpts } = opts;
    super(writableOpts);
    this.delayMs = delayMs;
    this.maxConcurrency = Math.max(1, Math.floor(maxConcurrency));
    this.simulateErrorEveryN = Math.max(0, Math.floor(simulateErrorEveryN));
  }

  // Node will call _write for each chunk
  _write(chunk: any, encoding: BufferEncoding, callback: (err?: Error | null) => void): void {
    if (this.destroyedFlag) {
      callback(new Error("Stream is destroyed"));
      return;
    }

    const seq = ++this.seqCounter;
    this.queue.push({ chunk, encoding, callback, seq });
    this.processQueue();
  }

  // Process queued writes honoring maxConcurrency
  private processQueue(): void {
    // If nothing to do or already at concurrency limit, return
    while (this.inFlight < this.maxConcurrency && this.queue.length > 0 && !this.destroyedFlag) {
      const item = this.queue.shift()!;
      this.inFlight++;
      this.performAsyncWrite(item)
        .then(() => {
          this.inFlight--;
          // After finishing one, try to process more
          // Use nextTick to avoid deep recursion
          process.nextTick(() => this.processQueue());
        })
        .catch((err) => {
          this.inFlight--;
          // propagate error via callback; stream will emit 'error' as well
          item.callback(err);
          this.emit("error", err);
          // continue processing queue
          process.nextTick(() => this.processQueue());
        });
    }
  }

  // Simulate an asynchronous write that takes `delayMs` ms
  private async performAsyncWrite(item: {
    chunk: any;
    encoding: BufferEncoding;
    callback: (err?: Error | null) => void;
    seq: number;
  }): Promise<void> {
    return new Promise((resolve, reject) => {
      const maybeError =
        this.simulateErrorEveryN > 0 && item.seq % this.simulateErrorEveryN === 0;

      const timer = setTimeout(() => {
        // simulate processing chunk here. For demonstration we just log.
        // In real use, replace with actual async I/O.
        // eslint-disable-next-line no-console
        logger.info(`SlowWritable processed seq=${item.seq}`);

        if (maybeError) {
          const err = new Error(`Simulated error at seq ${item.seq}`);
          item.callback(err);
          reject(err);
        } else {
          item.callback();
          resolve();
        }
      }, this.delayMs);

      // If stream was destroyed meantime, cancel timer and callback with error
      const onDestroy = () => {
        clearTimeout(timer);
        const err = new Error("Stream destroyed while writing");
        try {
          item.callback(err);
        } catch (_) {
          // ignore
        }
        reject(err);
      };

      // Ensure we don't leak listeners. If destroyedFlag becomes true quickly, call onDestroy.
      if (this.destroyedFlag) {
        onDestroy();
      }
    });
  }

  _final(callback: (err?: Error | null) => void): void {
    // Wait until queue emptied and inFlight is zero
    const check = () => {
      if (this.destroyedFlag) {
        callback(new Error("Stream destroyed before finalizing"));
        return;
      }
      if (this.queue.length === 0 && this.inFlight === 0) {
        callback();
      } else {
        setTimeout(check, 10);
      }
    };
    check();
  }

  _destroy(err: Error | null, callback: (error?: Error | null) => void): void {
    this.destroyedFlag = true;
    // flush callbacks in queue with error
    while (this.queue.length > 0) {
      const item = this.queue.shift()!;
      try {
        item.callback(err ?? new Error("Stream destroyed"));
      } catch (_) {
        // ignore
      }
    }
    callback(err);
  }
}