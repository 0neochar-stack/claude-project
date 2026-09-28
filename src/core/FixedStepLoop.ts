/**
 * Fixed-timestep accumulator. Gameplay and physics advance in constant `step`
 * increments no matter the display rate; rendering interpolates with the
 * returned alpha. A long hitch drops the backlog instead of spiralling.
 */
export class FixedStepLoop {
  private accumulator = 0;

  constructor(
    readonly step: number,
    private readonly maxSteps = 8,
  ) {}

  /** Runs `fixed(step)` as many times as `frameDt` allows; returns alpha in [0, 1). */
  advance(frameDt: number, fixed: (dt: number) => void): number {
    this.accumulator += Math.max(0, frameDt);
    let steps = 0;
    while (this.accumulator >= this.step && steps < this.maxSteps) {
      fixed(this.step);
      this.accumulator -= this.step;
      steps++;
    }
    if (this.accumulator >= this.step) this.accumulator %= this.step; // hitch: drop backlog
    return this.accumulator / this.step;
  }
}
