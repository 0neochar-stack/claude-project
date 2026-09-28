import type { WebGPURenderer } from "three/webgpu";

/**
 * Keeps the frame rate up by scaling render resolution: drops quickly when frames
 * run long, climbs back slowly when there is headroom. Also reports FPS for the HUD.
 */
export class DynamicResolution {
  scale = 1;
  fps = 60;
  private elapsed = 0;
  private frames = 0;

  constructor(
    private readonly renderer: WebGPURenderer,
    private readonly maxPixelRatio = Math.min(window.devicePixelRatio, 1.5),
    private readonly minScale = 0.5,
  ) {
    renderer.setPixelRatio(this.maxPixelRatio);
  }

  update(dt: number): void {
    this.elapsed += dt;
    this.frames++;
    if (this.elapsed < 0.5) return;
    this.fps = this.frames / this.elapsed;
    this.elapsed = 0;
    this.frames = 0;
    const before = this.scale;
    if (this.fps < 50) this.scale = Math.max(this.minScale, this.scale - 0.1);
    else if (this.fps > 58) this.scale = Math.min(1, this.scale + 0.05);
    if (this.scale !== before) this.renderer.setPixelRatio(this.maxPixelRatio * this.scale);
  }

  get label(): string {
    return `${Math.round(this.fps)} fps · ${Math.round(this.scale * 100)}% res`;
  }
}
