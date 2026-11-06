/**
 * A value driven by a spring, in Apple's terms: `damping` ratio (1 = no overshoot) and `response` (seconds to
 * get there, roughly). Retargeting keeps the current value and velocity, so any motion can be grabbed and
 * reversed mid-flight without a jump.
 */
export class SpringValue {
  value: number;
  velocity = 0;
  private target: number;
  private k = 0;
  private c = 0;
  private raf = 0;
  private last = 0;
  private done?: () => void;

  constructor(
    value: number,
    private onChange: (v: number) => void,
  ) {
    this.value = value;
    this.target = value;
  }

  to(target: number, opts: { response?: number; damping?: number; velocity?: number } = {}, done?: () => void) {
    const { response = 0.4, damping = 1 } = opts;
    this.target = target;
    if (opts.velocity !== undefined) this.velocity = opts.velocity;
    const w = (2 * Math.PI) / response;
    this.k = w * w;
    this.c = 2 * damping * w;
    this.done = done;
    if (reducedMotion()) {
      this.set(target);
      done?.();
      return;
    }
    if (!this.raf) {
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.tick);
    }
  }

  /** Jumps straight to `v` (a finger is moving it), forgetting any motion in progress. */
  set(v: number) {
    this.stop();
    this.value = this.target = v;
    this.velocity = 0;
    this.onChange(v);
  }

  stop() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private tick = (t: number) => {
    const dt = Math.min((t - this.last) / 1000, 1 / 30);
    this.last = t;
    const steps = Math.max(1, Math.ceil(dt * 240));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      this.velocity += (-this.k * (this.value - this.target) - this.c * this.velocity) * h;
      this.value += this.velocity * h;
    }
    if (Math.abs(this.value - this.target) < 0.0005 && Math.abs(this.velocity) < 0.01) {
      this.value = this.target;
      this.velocity = 0;
      this.raf = 0;
      this.onChange(this.value);
      const done = this.done;
      this.done = undefined;
      done?.();
      return;
    }
    this.onChange(this.value);
    this.raf = requestAnimationFrame(this.tick);
  };
}

export const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Android: the same look, painted cheaply. Chrome on Android (PWA and WebAPK alike) pays for every backdrop blur and
 * every clip-path frame, so styles.css drops the blur under `data-lite` (main.tsx sets it) and layer.tsx opens
 * screens by sliding and fading them, never scaling (a scaled scroller is rastered again on every frame).
 */
export const lite = () => /Android/i.test(navigator.userAgent);

/** Where a flick comes to rest (Apple's scroll deceleration), px from the release point. */
export const project = (velocity: number, rate = 0.998) => ((velocity / 1000) * rate) / (1 - rate);
