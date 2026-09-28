import { AgXToneMapping, PCFShadowMap, RenderPipeline, Scene, Vector3, WebGPURenderer } from "three/webgpu";
import { pass } from "three/tsl";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { parseVehicleRig } from "../assets/vehicleRig";
import { ChaseCamera } from "../camera/ChaseCamera";
import { Haptics } from "../input/Haptics";
import { InputManager } from "../input/InputManager";
import { PhysicsWorld } from "../physics/PhysicsWorld";
import { Hud } from "../ui/Hud";
import { PlayerCar } from "../vehicles/PlayerCar";
import { createRain } from "../fx/Rain";
import { VehicleFX } from "../fx/VehicleFX";
import { NeonCity } from "../world/NeonCity";
import { TestTrack } from "../world/TestTrack";
import { FixedStepLoop } from "./FixedStepLoop";
import { DEG } from "./math";

export const FIXED_STEP = 1 / 120;
const CAR_URL = `${import.meta.env.BASE_URL}models/cars/player_car.glb`;
/** Seconds on its roof (or side) before the car is set back on its wheels. */
const FLIP_RECOVERY_TIME = 2;

/**
 * Loads the car GLB. A `data:` URL is decoded in place instead of fetched, because
 * sandboxed hosts (e.g. the published artifact build) may block fetching data URLs.
 */
async function loadCar(url: string) {
  const loader = new GLTFLoader();
  if (!url.startsWith("data:")) return loader.loadAsync(url);
  const binary = atob(url.slice(url.indexOf(",") + 1));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return loader.parseAsync(bytes.buffer, "");
}

/**
 * Composition root for the Phase 1 test pad. Owns every system and runs the
 * frame: input -> fixed-step physics (120 Hz) -> interpolated visuals -> camera,
 * rumble, HUD -> render.
 */
export class Game {
  private readonly loop = new FixedStepLoop(FIXED_STEP);
  private readonly input = new InputManager();
  private readonly haptics = new Haptics();
  private readonly chase = new ChaseCamera();
  private readonly fx: VehicleFX;
  private lastTime = performance.now();
  private flippedFor = 0;

  static async create(container: HTMLElement): Promise<Game> {
    const renderer = new WebGPURenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.toneMapping = AgXToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFShadowMap;
    container.append(renderer.domElement);
    await renderer.init();

    const [physics, gltf] = await Promise.all([PhysicsWorld.create(), loadCar(CAR_URL)]);
    const scene = new Scene();
    // The rainy neon street by default; the Phase 1 grid pad with ramps via ?pad.
    const track = new URLSearchParams(location.search).has("pad")
      ? new TestTrack(scene, physics, renderer)
      : new NeonCity(scene, physics, renderer);
    if (track instanceof NeonCity) scene.add(createRain());
    physics.step(FIXED_STEP); // scene queries (suspension casts) only see colliders after a step
    const car = new PlayerCar(scene, physics, parseVehicleRig(gltf.scene), track.spawn);
    return new Game(renderer, scene, physics, track, car, new Hud(container));
  }

  private readonly pipeline: RenderPipeline;

  private constructor(
    private readonly renderer: WebGPURenderer,
    scene: Scene,
    private readonly physics: PhysicsWorld,
    private readonly track: TestTrack | NeonCity,
    private readonly car: PlayerCar,
    private readonly hud: Hud,
  ) {
    this.chase.setAspect(window.innerWidth / window.innerHeight);
    this.fx = new VehicleFX(scene);
    this.pipeline = new RenderPipeline(renderer);
    const colour = pass(scene, this.chase.camera).getTextureNode("output");
    this.pipeline.outputNode = colour.add(bloom(colour, 0.6, 0.25, 1));

    window.addEventListener("resize", () => {
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.chase.setAspect(window.innerWidth / window.innerHeight);
    });
    window.addEventListener("blur", () => this.haptics.stop(this.input.gamepad.active));
    window.addEventListener("gamepadconnected", (e) => this.hud.toast(`Controller connected: ${e.gamepad.id.split("(")[0]!.trim()}`, 3));
    window.addEventListener("gamepaddisconnected", () => this.hud.toast("Controller disconnected", 3));

    if (import.meta.env.DEV) Object.assign(window, { __cyberdrift: this }); // for automated browser checks
  }

  start(): void {
    this.lastTime = performance.now();
    void this.renderer.setAnimationLoop(this.frame);
  }

  /** Read-only state for tooling and tests. */
  get debug() {
    const t = this.car.vehicle.telemetry;
    return {
      telemetry: { ...t },
      position: this.car.position.toArray(),
      cameraMode: this.chase.mode,
      fov: this.chase.camera.fov,
      rumble: { ...this.haptics.levels },
    };
  }

  private readonly frame = (): void => {
    const now = performance.now();
    const dt = Math.min((now - this.lastTime) / 1000, 0.1);
    this.lastTime = now;

    const input = this.input.update(dt, now);
    if (input.cameraPressed) this.hud.toast(`Camera: ${this.chase.cycleMode()}`);
    if (input.resetPressed) this.resetCar();
    if (input.helpPressed) this.hud.toggleHelp();
    if (input.rumbleTogglePressed) {
      this.haptics.enabled = !this.haptics.enabled;
      if (!this.haptics.enabled) this.haptics.stop(this.input.gamepad.active);
      this.hud.toast(`Rumble ${this.haptics.enabled ? "on" : "off"}`);
    }

    const { car, physics } = this;
    const alpha = this.loop.advance(dt, (step) => {
      car.fixedUpdate(step, input.drive);
      physics.step(step);
      car.afterPhysics();
    });
    this.recoverIfFlipped(dt);

    car.render(alpha, dt);
    this.track.update();
    this.track.followSun(car.position);
    this.fx.update(dt, car.vehicle);

    const t = car.vehicle.telemetry;
    const events = car.vehicle.consumeEvents();
    this.chase.addShake(Math.max(events.impact, events.landing * 0.6));
    this.chase.update(dt, {
      position: car.position,
      quaternion: car.quaternion,
      velocity: car.velocity,
      speed: t.speed,
      forwardSpeed: t.forwardSpeed,
      accel: t.accel,
      throttle: t.throttle,
      drifting: t.drifting,
    }, input.look);

    this.haptics.update(this.input.gamepad.active, {
      throttle: t.throttle,
      accel: t.accel,
      grounded: t.groundedWheels > 0,
      rearSlip: t.rearSlip,
      wheelspin: t.wheelspin,
      brakeLock: t.brakeLock,
      impact: events.impact,
      landing: events.landing,
    }, dt, now);

    this.hud.update({
      speedKmh: t.speed * 3.6,
      gear: t.gear,
      drifting: t.drifting,
      driftAngleDeg: Math.abs(t.slipAngle) / DEG,
      driftTime: t.driftTime,
      input: input.drive,
      device: input.activeDevice,
      gamepadName: input.gamepadName,
      rumble: this.haptics.levels,
      rumbleEnabled: this.haptics.enabled,
      cameraMode: this.chase.mode,
    }, dt);

    this.pipeline.render();
  };

  private resetCar(): void {
    this.car.reset(this.track.spawn);
    this.track.resetProps();
    this.fx.reset();
    this.chase.reset();
    this.hud.toast("Car reset");
  }

  /** Roof or side landing: after a moment, put the car back on its wheels where it is. */
  private recoverIfFlipped(dt: number): void {
    const t = this.car.vehicle.telemetry;
    this.flippedFor = t.uprightness < 0.3 && t.speed < 3 ? this.flippedFor + dt : 0;
    if (this.flippedFor < FLIP_RECOVERY_TIME) return;
    this.flippedFor = 0;
    const p = this.car.position;
    const forward = new Vector3(0, 0, 1).applyQuaternion(this.car.quaternion);
    this.car.reset({ position: p.clone().setY(p.y + 1), yaw: Math.atan2(forward.x, forward.z) });
    this.chase.reset();
    this.hud.toast("Back on your wheels");
  }
}
