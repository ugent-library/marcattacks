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
  // In-flight delayed writes, so _destroy can cancel their timers, settle their
  // promises, and error their callbacks exactly once.
  private active = new Set<{
    timer: ReturnType<typeof setTimeout>;
    resolve: () => void;
    callback: (err?: Error | null) => void;
  }>();

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
      // performAsyncWrite always invokes item.callback itself (once) and never
      // rejects, so there is no second callback and no manual emit('error') —
      // calling the write callback with an error is what makes the stream emit.
      this.performAsyncWrite(item)
        .then(() => {
          this.inFlight--;
          // nextTick to avoid deep recursion
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
    return new Promise<void>((resolve) => {
      const maybeError =
        this.simulateErrorEveryN > 0 && item.seq % this.simulateErrorEveryN === 0;

      const op = { timer: undefined as unknown as ReturnType<typeof setTimeout>, resolve, callback: item.callback };

      op.timer = setTimeout(() => {
        this.active.delete(op);
        if (maybeError) {
          logger.info(`SlowWritable simulated error at seq=${item.seq}`);
          item.callback(new Error(`Simulated error at seq ${item.seq}`));
        } else {
          logger.info(`SlowWritable processed seq=${item.seq}`);
          item.callback();
        }
        resolve();
      }, this.delayMs);

      this.active.add(op);
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
    const destroyErr = err ?? new Error("Stream destroyed");
    // Cancel in-flight delayed writes: clear the timer (so it can't fire and
    // call back a second time), error the callback once, and settle the promise.
    for (const op of this.active) {
      clearTimeout(op.timer);
      try { op.callback(destroyErr); } catch (_) { /* ignore */ }
      op.resolve();
    }
    this.active.clear();
    // Error any not-yet-started queued writes.
    while (this.queue.length > 0) {
      const item = this.queue.shift()!;
      try { item.callback(destroyErr); } catch (_) { /* ignore */ }
    }
    callback(err);
  }
}