import { MOVE_MS } from "./interaction";

// A running animation can be resolved synchronously before taking a history snapshot.
export class Glide {
  private frame = 0;
  private complete: (() => void) | null = null;

  constructor(
    private readonly request = (callback: FrameRequestCallback) => requestAnimationFrame(callback),
    private readonly cancelFrame = (frame: number) => cancelAnimationFrame(frame),
    private readonly now = () => performance.now(),
  ) {}

  start(update: (progress: number) => void, done: () => void, reduceMotion = false): void {
    this.cancel();
    const start = this.now();
    this.complete = () => {
      update(1);
      done();
    };
    const step = (now: number) => {
      const progress = reduceMotion ? 1 : Math.min(1, (now - start) / MOVE_MS);
      if (progress >= 1) this.finish();
      else {
        update(progress);
        this.frame = this.request(step);
      }
    };
    this.frame = this.request(step);
  }

  finish(): void {
    const complete = this.complete;
    this.cancel();
    complete?.();
  }

  cancel(): boolean {
    const active = this.complete !== null;
    this.cancelFrame(this.frame);
    this.frame = 0;
    this.complete = null;
    return active;
  }
}
