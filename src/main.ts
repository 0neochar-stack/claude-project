/**
 * Phase 0 smoke test: proves the Blender -> glTF -> three.js pipeline end to end.
 * Shows the generated player car on an orbit camera with bloom.
 * Replaced by `core/Game.ts` in Phase 1 (see docs/ROADMAP.md).
 */
import * as THREE from "three/webgpu";
import { pass } from "three/tsl";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

const renderer = new THREE.WebGPURenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.AgXToneMapping;
document.body.append(renderer.domElement);
await renderer.init();

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05060a);
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.08;

const cyan = new THREE.PointLight(0x27d8ff, 60, 20);
cyan.position.set(4, 3, 5);
const magenta = new THREE.PointLight(0xff2bd6, 60, 20);
magenta.position.set(-4, 3, -5);
scene.add(cyan, magenta);

const ground = new THREE.Mesh(
  new THREE.CircleGeometry(12, 64).rotateX(-Math.PI / 2),
  new THREE.MeshStandardMaterial({ color: 0x050508, roughness: 0.35, metalness: 0.0 }),
);
scene.add(ground);

const camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.1, 200);
camera.position.set(5.5, 1.8, 6.5); // front-left three-quarter view (car faces +Z)
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.5, 0);
controls.enableDamping = true;
controls.autoRotate = true;
controls.autoRotateSpeed = 0.6;

const gltf = await new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}models/cars/player_car.glb`);
const car = gltf.scene;
car.traverse((node) => {
  if (node.name.startsWith("COL_")) node.visible = false; // collision hull is physics-only
});
scene.add(car);

const pipeline = new THREE.RenderPipeline(renderer);
const color = pass(scene, camera).getTextureNode("output");
pipeline.outputNode = color.add(bloom(color, 0.8, 0.35, 1.0));

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

renderer.setAnimationLoop(() => {
  controls.update();
  pipeline.render();
});
