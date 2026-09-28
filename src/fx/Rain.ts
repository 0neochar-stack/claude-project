import {
  AdditiveBlending, BufferGeometry, Float32BufferAttribute, Group, InstancedMesh, MeshBasicNodeMaterial, RingGeometry,
} from "three/webgpu";
import { cameraPosition, float, fract, hash, instanceIndex, mix, positionLocal, smoothstep, step, time, vec3 } from "three/tsl";

/**
 * GPU rain: every drop is positioned in the vertex shader from its instance index
 * and time, wrapped in a box that follows the camera, so it costs no CPU per frame.
 * Drops are world-stable (they don't slide with the camera) and splash on the road.
 */
export function createRain(drops = 16_000, splashes = 1_800): Group {
  const group = new Group();
  group.add(createStreaks(drops), createSplashes(splashes));
  return group;
}

function createStreaks(count: number): InstancedMesh {
  // Two crossed quads per drop so streaks read from any angle.
  const w = 0.009;
  const h = 0.62;
  const quad = (ax: number, az: number) => [
    -ax, -h / 2, -az, ax, -h / 2, az, ax, h / 2, az, -ax, -h / 2, -az, ax, h / 2, az, -ax, h / 2, -az,
  ];
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute([...quad(w, 0), ...quad(0, w)], 3));

  const seed = float(instanceIndex);
  const box = vec3(70, 34, 70);
  const speed = mix(float(19), float(27), hash(seed.add(0.4)));
  const wrap = (r: ReturnType<typeof hash>, cam: typeof cameraPosition.x, size: typeof box.x) =>
    cam.add(fract(r.sub(cam.div(size))).sub(0.5).mul(size));
  const fall = fract(hash(seed.add(0.3)).sub(time.mul(speed).div(box.y))).sub(0.5).mul(box.y);
  const y = cameraPosition.y.add(fall);
  const x = wrap(hash(seed.add(0.1)), cameraPosition.x, box.x).add(fall.mul(0.12)); // wind slant
  const z = wrap(hash(seed.add(0.2)), cameraPosition.z, box.z);

  const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending });
  material.positionNode = positionLocal.add(vec3(x, y, z));
  material.colorNode = vec3(0.62, 0.72, 0.95);
  const near = smoothstep(2, 7, vec3(x, y, z).sub(cameraPosition).length()); // no giant streaks across the lens
  material.opacityNode = mix(float(0.1), float(0.28), hash(seed.add(0.7))).mul(step(0, y)).mul(near); // nothing below the road
  const mesh = new InstancedMesh(geometry, material, count);
  mesh.frustumCulled = false;
  return mesh;
}

function createSplashes(count: number): InstancedMesh {
  const geometry = new RingGeometry(0.8, 1, 16).rotateX(-Math.PI / 2);
  const seed = float(instanceIndex);
  const rate = mix(float(1.4), float(2.6), hash(seed.add(0.9)));
  const cycle = time.mul(rate).add(hash(seed.add(0.5)));
  const phase = fract(cycle);
  const generation = cycle.floor(); // a new spot every splash
  const size = 38;
  const px = hash(seed.add(generation.mul(0.37)).add(0.1)).sub(0.5).mul(size).add(cameraPosition.x);
  const pz = hash(seed.add(generation.mul(0.53)).add(0.2)).sub(0.5).mul(size).add(cameraPosition.z);
  const scale = mix(float(0.03), float(0.32), phase);

  const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending });
  material.positionNode = positionLocal.mul(scale).add(vec3(px, 0.025, pz));
  material.colorNode = vec3(0.7, 0.8, 1);
  material.opacityNode = float(1).sub(phase).pow(2).mul(0.25);
  const mesh = new InstancedMesh(geometry, material, count);
  mesh.frustumCulled = false;
  return mesh;
}
