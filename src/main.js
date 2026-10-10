// Game shell: renderer, menus, the player's car, and whichever world is loaded. Worlds are built when first
// chosen and freed when another is picked; the showroom behind the menus is always there and cheap.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { CarBody } from './physics.js';
import { LAYER_MAIN_ONLY, LAYER_WET } from './wet.js';
import { buildCar, makeCarEnvironment, PAINTS } from './car.js';
import { Particles, SkidMarks, radialTexture } from './fx.js';
import { Sound } from './audio.js';
import { Input } from './input.js';
import { DriftScore } from './drift.js';
import { Profile, carById, buildSpec, engineSound, specStats } from './garage.js';
import { Settings, QUALITY_ORDER } from './settings.js';
import { Screens } from './ui.js';
import { Hud } from './hud.js';
import { CameraRig, CAMERAS } from './camera.js';
import { Customize } from './customize.js';
import { createShowroom } from './worlds/showroom.js';
import { createNeonWorld } from './worlds/neon.js';
import { createOpenWorld } from './worlds/open.js';
import { MODEL_CREDITS } from './modelList.js';
import { Phone } from './phone.js';
import { SKIES } from './skies.js';

const $ = (id) => document.getElementById(id);
const isTouch = matchMedia('(pointer: coarse)').matches;
if (isTouch) document.body.classList.add('is-touch');
const fmt = new Intl.NumberFormat('en-US');
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

// ---------- settings and renderer ----------
const settings = new Settings();
let preset = settings.preset;
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.type = THREE.PCFShadowMap; // the soft variant costs several times more per pixel
renderer.info.autoReset = false; // counted per frame across all passes
// What graphics chip this is, so "auto" quality can start lower on integrated graphics.
{
  const gl = renderer.getContext();
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  settings.gpu = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
  preset = settings.preset;
}
// Resolution: the preset's pixel ratio, or supersampled for a 4K-sharp image on strong GPUs. "Auto" drops it
// when the frame rate sags and climbs back when it recovers.
const targetRatio = () => (settings.resolution === 'supersample' ? Math.min(3, (devicePixelRatio || 1) * 1.5) : Math.min(devicePixelRatio || 1, preset.pixelRatio));
let pixelRatio = targetRatio();
const MAX_ANISO = renderer.capabilities.getMaxAnisotropy();
// Every texture gets full anisotropic filtering, so road lines and ground stay crisp far away.
function sharpen(root) {
  root.traverse((o) => {
    for (const m of [].concat(o.material || [])) for (const v of Object.values(m)) if (v && v.isTexture && v.anisotropy !== MAX_ANISO) { v.anisotropy = MAX_ANISO; v.needsUpdate = true; }
  });
}

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 2000);
camera.layers.enable(LAYER_MAIN_ONLY);
camera.layers.enable(LAYER_WET);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.8, 0.5, 0.85);
composer.addPass(bloom);
composer.addPass(new OutputPass());
// Edge smoothing after tone mapping: SMAA on high presets, FXAA on the lighter ones.
const smaa = new SMAAPass(innerWidth, innerHeight);
const fxaa = new ShaderPass(FXAAShader);
composer.addPass(smaa);
composer.addPass(fxaa);
function applyAA() { smaa.enabled = preset.aa === 'smaa'; fxaa.enabled = preset.aa !== 'smaa'; }
applyAA();

// ---------- car, sound, effects ----------
const sound = new Sound();
sound.setVolume(settings.volume);
const profile = new Profile();
const car = new CarBody(profile.spec());
const neonEnv = makeCarEnvironment(renderer);
let carView = null;
let particles = new Particles(preset.particles);
scene.add(particles.points);
let skids = new SkidMarks(isTouch ? 1400 : 2400);
scene.add(skids.mesh);
const score = new DriftScore();
const input = new Input();
input.bindTouch($('touch'));
const hud = new Hud();
const rig = new CameraRig(camera);
rig.set(settings.camera);
const ASSISTS = [['Off', 0], ['Low', 0.35], ['Medium', 0.75], ['High', 1]];
car.assist = ASSISTS[settings.assist][1];

const showroom = createShowroom();
scene.add(showroom.root);
sharpen(showroom.root);
let world = null; // the drivable world, once one is loaded
let worldId = null;
let state = 'boot'; // boot | menu | customize | loading | drive | pause
let clock = 0;
let frameNo = 0;
let saved = null; // where the car was when you left a world for the garage
let ground = null;
let revTimer = 0;

// Builds the 3D car for a car id: your saved style if you own it, the showroom look if not.
function showCar(id) {
  const def = carById(id);
  const st = profile.owns(id) ? profile.car(id) : def.look;
  carView?.dispose();
  carView = buildCar(neonEnv, radialTexture(), {
    ...def.look, paint: st.paint, neon: st.neon, rims: st.rims, wheels: st.wheels || def.look.wheels, wing: st.wing || def.look.wing,
  });
  carView.onBackfire = () => sound.pop();
  scene.add(carView.root);
  sharpen(carView.root);
  const active = activeWorld();
  if (active.env.carEnv) carView.setEnvMap(active.env.carEnv);
  carView.setLights(active.env.headlights !== false);
  carView.setStance(profile.owns(id) ? profile.car(id).tune : null);
  car.spec = profile.owns(id) ? profile.spec(id) : buildSpec(id);
  sound.setEngine(profile.owns(id) ? engineSound(id, profile.car(id).tune) : def.engine);
  carView.update(car, 0, ground);
}

// ---------- split screen: player two ----------
// Player two drives a second car (another one you own, or an S15) with the second controller, in the
// bottom half of the screen. Their points are not saved.
let p2 = null;
const camera2 = new THREE.PerspectiveCamera(62, 1, 0.1, 2000);
camera2.layers.enable(LAYER_MAIN_ONLY);
camera2.layers.enable(LAYER_WET);
const splitOn = () => settings.players === 2;
function makeP2() {
  const owned = Object.keys(profile.cars).filter((id) => id !== profile.current);
  const id = owned[0] || 's15';
  const def = carById(id);
  const st = profile.owns(id) ? profile.car(id) : def.look;
  const view = buildCar(neonEnv, radialTexture(), {
    ...def.look, paint: profile.owns(id) ? st.paint : (def.look.paint + 4) % PAINTS.length, neon: st.neon, rims: st.rims, wheels: st.wheels || def.look.wheels, wing: st.wing || def.look.wing,
  });
  if (profile.owns(id)) view.setStance(profile.car(id).tune);
  scene.add(view.root);
  sharpen(view.root);
  const body = new CarBody(profile.owns(id) ? profile.spec(id) : buildSpec(id));
  body.assist = car.assist;
  body.autoGear = true;
  const r = new CameraRig(camera2);
  r.set('chase');
  return { id, car: body, view, rig: r, score: new DriftScore(false), ground: null, acc: 0, smoke: [0, 0] };
}
function dropP2() {
  if (!p2) return;
  p2.view.dispose();
  p2 = null;
  document.body.classList.remove('is-split');
  $('hud2').hidden = true;
  input.split = false;
  resize();
}
function startSplit(at) {
  if (!p2) p2 = makeP2();
  document.body.classList.add('is-split');
  $('hud2').hidden = false;
  input.split = true;
  placeP2(at);
  resize();
}
// Put player two alongside player one.
function placeP2(at) {
  if (!p2) return;
  const rx = -Math.cos(at.heading), rz = Math.sin(at.heading); // the driver's right
  p2.car.reset(at.x + rx * 4.2, at.z + rz * 4.2, at.heading);
  p2.score.chain = 0;
  p2.rig.snap(p2.car);
  p2.view.setEnvMap(world?.env.carEnv || neonEnv);
  p2.view.setLights(world?.env.headlights !== false);
}

const activeWorld = () => (state === 'drive' || state === 'pause' || state === 'loading' ? world || showroom : showroom);

// ---------- world environment ----------
function applyEnv(w) {
  const env = w.env;
  w.setLoad?.(GOVERN_LOAD[govern.level]);
  scene.background = env.background;
  scene.fog = env.fog;
  scene.environment = env.sceneEnv || null;
  renderer.toneMappingExposure = env.exposure;
  bloom.enabled = preset.bloom && !!env.bloom && govern.level < 3;
  // Glow is kept subtle: half of what each world asks for.
  if (env.bloom) { bloom.strength = env.bloom.strength * 0.5; bloom.radius = env.bloom.radius; bloom.threshold = env.bloom.threshold; }
  const far = Math.min(env.far, preset.far);
  if (camera.far !== far) { camera.far = far; camera.updateProjectionMatrix(); }
  renderer.shadowMap.enabled = !!(preset.shadows && env.shadows) && govern.level < 2;
}

function setWorldVisible() {
  const inWorld = state === 'drive' || state === 'pause';
  showroom.root.visible = !inWorld;
  if (world) world.root.visible = inWorld;
  skids.mesh.visible = inWorld;
  const w = inWorld && world ? world : showroom;
  applyEnv(w);
  if (carView) {
    carView.setEnvMap(w.env.carEnv || neonEnv);
    carView.setLights(w.env.headlights !== false);
  }
  sound.setAmbience({ rain: inWorld ? w.env.rain ?? 0 : 0, wet: inWorld ? w.env.wet ?? 0 : 0, wind: 0, water: 0, siren: 0 });
}

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(w, h, false);
  composer.setPixelRatio(pixelRatio);
  composer.setSize(w, h);
  fxaa.material.uniforms.resolution.value.set(1 / (w * pixelRatio), 1 / (h * pixelRatio));
  world?.resize?.(w * pixelRatio, h * pixelRatio);
  const split = !!p2 && (state === 'drive' || state === 'pause');
  camera.aspect = w / (split ? h / 2 : h);
  camera.updateProjectionMatrix();
  camera2.aspect = w / (h / 2);
  camera2.updateProjectionMatrix();
  particles.material.uniforms.uScale.value = (h * pixelRatio) / 2;
}
addEventListener('resize', resize);

// ---------- loading worlds ----------
const WORLDS = {
  neon: { name: 'Neon Tokyo', title: 'Neon <em>Tokyo</em>', tip: 'Wet roads grip less. Clutch-kick with Shift to snap the rear loose.', create: createNeonWorld },
  open: { name: 'Open World', title: 'Open <em>World</em>', tip: 'Big drift chains at night get the police interested. Lose them to cool off.', create: createOpenWorld },
};

function setLoader(title, tip, frac) {
  $('loader').hidden = false;
  if (title !== null) $('loader-title').innerHTML = title;
  if (tip !== null) $('loader-tip').textContent = tip;
  $('loader-bar').style.transform = `scaleX(${frac.toFixed(3)})`;
}

async function loadWorld(id) {
  const def = WORLDS[id];
  if (!def) return;
  if (worldId !== id) {
    state = 'loading';
    screens.set(null);
    setLoader(def.title, def.tip, 0.05);
    await nextFrame();
    await nextFrame();
    if (world) { world.dispose(); world = null; worldId = null; }
    skids.mesh.removeFromParent();
    skids = new SkidMarks(isTouch ? 1400 : 2400);
    scene.add(skids.mesh);
    world = await def.create({ preset, sound, particles, settings, renderer, scene, camera, profile, progress: async (f, tip) => { setLoader(null, tip ?? null, 0.05 + f * 0.9); await nextFrame(); } });
    worldId = id;
    world.root.visible = false;
    scene.add(world.root);
    sharpen(world.root);
    setLoader(null, null, 1);
    resize();
    // Compile shaders now rather than stuttering on the first frames of driving.
    state = 'drive';
    setWorldVisible();
    renderer.compile(scene, camera);
    await nextFrame();
  }
  startDriving(world.spawn);
  $('loader').hidden = true;
}

function startDriving(at) {
  state = 'drive';
  screens.set(null);
  car.reset(at.x, at.z, at.heading);
  if (splitOn()) {
    startSplit(at);
    if (!input.hasPlayer2) hud.toast('Player 2: press A on the second controller');
  } else dropP2();
  car.spec = profile.spec();
  score.chain = 0;
  score.mult = 1;
  rig.snap(car);
  world.onReset?.('start');
  enterDrive();
}

function enterDrive() {
  state = 'drive';
  screens.set(null);
  if (p2) { p2.view.root.visible = true; $('hud2').hidden = false; document.body.classList.add('is-split'); resize(); }
  setWorldVisible();
  $('hud').hidden = false;
  $('touch').hidden = !isTouch;
  sound.start();
  sound.setMuted(sound.muted);
  canvas.focus?.({ preventScroll: true });
  input.menuMode = false;
}

function pause() {
  if (state !== 'drive') return;
  if (document.pointerLockElement) document.exitPointerLock();
  state = 'pause';
  $('touch').hidden = true;
  $('pause-place').textContent = world.placeInfo(car);
  $('pause-cam').textContent = rig.name;
  $('pause-time-row').hidden = !world.setTimeOfDay;
  $('pause-time').textContent = TIMES.find((t) => t[0] === settings.timeOfDay)?.[1] || 'Cycle';
  screens.set('pause');
  sound.setAmbience({ siren: 0 });
  if (sound.ctx) sound.ctx.suspend();
}

function resume() {
  if (state !== 'pause') return;
  if (sound.ctx) sound.ctx.resume();
  enterDrive();
}

function quitToMenu() {
  dropP2();
  state = 'menu';
  $('hud').hidden = true;
  $('touch').hidden = true;
  if (sound.ctx) sound.ctx.resume();
  toShowroom();
  screens.set('main');
  renderMain();
}

// The garage and menus happen in the showroom: park the car on the turntable.
function toShowroom() {
  if (p2) { p2.view.root.visible = false; document.body.classList.remove('is-split'); $('hud2').hidden = true; resize(); }
  setWorldVisible();
  car.reset(0, 0, showroom.spawn.heading);
  ground = null;
  rig.snap(car);
}

// ---------- garage orbit camera ----------
const orbit = { yaw: 0.8, pitch: 0, zoom: 1, idle: 10, drag: null };
// Drag anywhere that is not a control (the canvas, or empty space around the menu panels).
addEventListener('pointerdown', (e) => {
  if (state !== 'menu' && state !== 'customize') return;
  if (e.target !== canvas && e.target.closest('button, input, .cust__panel, .carcard, .modes, .main__foot, .brand, .card')) return;
  orbit.drag = { x: e.clientX, y: e.clientY, id: e.pointerId };
  orbit.idle = 0;
});
addEventListener('pointermove', (e) => {
  if (!orbit.drag || e.pointerId !== orbit.drag.id) return;
  orbit.yaw -= (e.clientX - orbit.drag.x) * 0.008;
  orbit.pitch = Math.max(-0.1, Math.min(0.95, orbit.pitch + (e.clientY - orbit.drag.y) * 0.005));
  orbit.drag.x = e.clientX; orbit.drag.y = e.clientY;
  orbit.idle = 0;
});
addEventListener('pointerup', () => { orbit.drag = null; });
addEventListener('pointercancel', () => { orbit.drag = null; });
addEventListener('wheel', (e) => {
  if (state !== 'menu' && state !== 'customize') return;
  if (e.target !== canvas && e.target.closest('.cust__panel, .modes, .card')) return;
  orbit.zoom = Math.max(0.55, Math.min(1.6, orbit.zoom * (1 + Math.sign(e.deltaY) * 0.08)));
  orbit.idle = 0;
}, { passive: true });

// ---------- free look while driving ----------
// Drag on the game with the mouse, or click it to capture the mouse (Esc releases) and just move it.
let lookDrag = null;
canvas.addEventListener('pointerdown', (e) => {
  if (state !== 'drive') return;
  lookDrag = { x: e.clientX, y: e.clientY, id: e.pointerId };
  if (e.pointerType === 'mouse' && !document.pointerLockElement) canvas.requestPointerLock?.()?.catch?.(() => {});
});
addEventListener('pointermove', (e) => {
  if (state !== 'drive') return;
  if (document.pointerLockElement === canvas) { rig.addLook(-e.movementX * 0.0045, -e.movementY * 0.003); return; }
  if (!lookDrag || e.pointerId !== lookDrag.id) return;
  rig.addLook(-(e.clientX - lookDrag.x) * 0.006, -(e.clientY - lookDrag.y) * 0.004);
  lookDrag.x = e.clientX; lookDrag.y = e.clientY;
});
addEventListener('pointerup', () => { lookDrag = null; });

// ---------- menus ----------
const screens = new Screens();
const customize = new Customize($('cust'), profile, {
  onPreview: (id) => showCar(id),
  onSelect: (id) => { showCar(id); renderMain(); },
  onStyle: (id, key) => {
    const st = profile.car(id);
    if (key === 'paint') carView.setPaint(st.paint);
    else if (key === 'neon') carView.setNeon(st.neon);
    else if (key === 'rims') carView.setRims(st.rims);
    else showCar(id); // wheels, wing or everything: rebuild the body
  },
  onTune: (id, what) => {
    car.spec = profile.spec(id);
    carView.setStance(profile.car(id).tune);
    if (what === 'engine' || what === 'all') sound.setEngine(engineSound(id, profile.car(id).tune));
  },
  onDrive: () => {
    customize.close();
    if (saved && world) {
      state = 'drive';
      startDriving(saved);
      saved = null;
    } else loadWorld(lastMode);
  },
  onBack: () => leaveCustomize(),
  onToast: (t) => hud.toast(t),
  onRev: () => { sound.start(); revTimer = 0.7; },
});

function leaveCustomize() {
  customize.close();
  if (saved && world) {
    // Back to the pause menu, in the world, where you left.
    state = 'pause';
    setWorldVisible();
    car.reset(saved.x, saved.z, saved.heading);
    ground = world.flat ? null : groundPose(car.x, car.z, car.h);
    car.spec = profile.spec();
    saved = null;
    $('hud').hidden = false;
    if (p2) { p2.view.root.visible = true; $('hud2').hidden = false; document.body.classList.add('is-split'); resize(); }
    screens.set('pause');
    return;
  }
  state = 'menu';
  screens.set('main');
  renderMain();
}

function openCustomize(fromPause) {
  if (fromPause) saved = { x: car.x, z: car.z, heading: car.h };
  state = 'customize';
  $('hud').hidden = true;
  toShowroom();
  customize.open(fromPause);
  screens.set('customize');
}

let lastMode = 'open';
function renderMain() {
  const id = profile.current, def = carById(id);
  const s = specStats(profile.spec(id));
  $('main-car').textContent = def.name;
  $('main-tag').textContent = def.tagline;
  $('main-chips').innerHTML = [
    [`${s.hp}`, 'hp'], [fmt.format(s.mass), 'kg'], [def.spec.awd ? 'AWD' : 'RWD', ''], [engineSound(id, profile.car(id).tune).toUpperCase(), ''],
  ].map(([v, u]) => `<span class="chip">${v}${u ? ` <i>${u}</i>` : ''}</span>`).join('');
  $('main-credits').textContent = `${fmt.format(profile.credits)} CR`;
  $('btn-mute').textContent = sound.muted ? 'Sound off' : 'Sound on';
  $('btn-players').textContent = splitOn() ? '2 Players · split' : '1 Player';
}

document.querySelector('.modes').addEventListener('click', (e) => {
  const b = e.target.closest('[data-mode]');
  if (!b) return;
  sound.start();
  const m = b.dataset.mode;
  if (b.dataset.soon !== undefined) { hud.toast(`${b.querySelector('.mode__name').firstChild.textContent.trim()} is coming soon`); return; }
  if (m === 'customize') openCustomize(false);
  else { lastMode = m; loadWorld(m); }
});
document.addEventListener('click', (e) => {
  const o = e.target.closest('[data-open]');
  if (o) { screens.push(o.dataset.open); return; }
  const a = e.target.closest('[data-act]');
  if (!a) return;
  const act = a.dataset.act;
  if (act === 'resume') resume();
  else if (act === 'camera') { $('pause-cam').textContent = rig.cycle(); settings.set('camera', rig.id); }
  else if (act === 'time') cycleTime();
  else if (act === 'customize') openCustomize(true);
  else if (act === 'respawn') { resume(); respawn(); }
  else if (act === 'quit') quitToMenu();
  else if (act === 'mute') toggleMute();
  else if (act === 'players') {
    settings.set('players', splitOn() ? 1 : 2);
    renderMain();
    hud.toast(splitOn() ? `Split screen on · ${input.hasPlayer2 ? 'player 2 is ready' : 'player 2: press A on the second controller'}` : 'Single player');
  }
  else if (act === 'close-settings') screens.back();
});
$('btn-pause').addEventListener('click', () => pause());
screens.on('pause', { onBack: () => resume() });
screens.on('customize', { onBack: () => leaveCustomize() });
screens.on('main', { onBack: () => {} });
screens.on('settings', { onShow: () => renderSettings() });
screens.onExtra = (a) => {
  if (screens.current === 'customize' && (a === 'tabPrev' || a === 'tabNext')) customize.stepTab(a === 'tabNext' ? 1 : -1);
};

function toggleMute() {
  sound.start();
  sound.setMuted(!sound.muted);
  $('btn-mute').textContent = sound.muted ? 'Sound off' : 'Sound on';
  return sound.muted ? 'Sound off' : 'Sound on';
}

const TIMES = [['cycle', 'Cycle'], ['day', 'Day'], ['dusk', 'Sunset'], ['night', 'Night']];
function cycleTime(dir = 1) {
  const i = TIMES.findIndex((t) => t[0] === settings.timeOfDay);
  const next = TIMES[(i + dir + TIMES.length) % TIMES.length];
  settings.set('timeOfDay', next[0]);
  world?.setTimeOfDay?.(next[0]);
  $('pause-time').textContent = next[1];
  return next[1];
}

// Settings rows: each is a cycler (left/right or click) or a slider.
const SETTINGS = [
  { key: 'quality', label: 'Graphics', note: 'Auto picks for your device', opts: [['auto', 'Auto'], ...QUALITY_ORDER.map((q) => [q, q[0].toUpperCase() + q.slice(1)])] },
  { key: 'resolution', label: 'Resolution', note: 'Supersample is the sharpest (needs a strong GPU)', opts: [['auto', 'Auto'], ['native', 'Native'], ['supersample', 'Supersample 4K']] },
  { key: 'camera', label: 'Camera', opts: CAMERAS.map((c) => [c.id, c.name]) },
  { key: 'assist', label: 'Drift assist', note: 'Counter-steer and angle help', opts: ASSISTS.map(([n], i) => [i, n]) },
  { key: 'gearbox', label: 'Gearbox', opts: [['auto', 'Automatic'], ['manual', 'Manual']] },
  { key: 'players', label: 'Players', note: 'Two players split the screen; player 2 uses the second controller', opts: [[1, '1 Player'], [2, '2 Players']] },
  { key: 'units', label: 'Speed units', opts: [['kmh', 'km/h'], ['mph', 'mph']] },
  { key: 'timeOfDay', label: 'Time of day', note: 'Open World', opts: TIMES },
  { key: 'showFps', label: 'Show FPS', opts: [[false, 'Off'], [true, 'On']] },
  { key: 'volume', label: 'Volume', range: [0, 1, 0.05] },
];
function settingValue(key) { return key === 'gearbox' ? (car.autoGear ? 'auto' : 'manual') : settings[key]; }
$('model-credits').innerHTML = MODEL_CREDITS.map(([what, who]) => `<div><b>${who}</b>${what}</div>`).join('');
function renderSettings() {
  $('settings-rows').innerHTML = SETTINGS.map((s) => {
    const label = `<div class="row__label"><b>${s.label}</b>${s.note ? `<span>${s.note}</span>` : ''}</div>`;
    if (s.range) return `<div class="row">${label}<input type="range" data-nav data-setting="${s.key}" min="${s.range[0]}" max="${s.range[1]}" step="${s.range[2]}" value="${settingValue(s.key)}" style="--pct:${settingValue(s.key) * 100}%" aria-label="${s.label}"></div>`;
    const cur = s.opts.find((o) => o[0] === settingValue(s.key)) || s.opts[0];
    return `<div class="row">${label}<button class="cycler" type="button" data-nav data-setting="${s.key}" aria-label="${s.label}: ${cur[1]}"><i>◀</i><b>${cur[1]}</b><i>▶</i></button></div>`;
  }).join('');
}
function changeSetting(key, dir) {
  const s = SETTINGS.find((x) => x.key === key);
  const i = s.opts.findIndex((o) => o[0] === settingValue(key));
  const v = s.opts[(i + dir + s.opts.length) % s.opts.length][0];
  if (key === 'gearbox') car.autoGear = v === 'auto';
  else settings.set(key, v);
  if (key === 'camera') rig.set(v);
  if (key === 'assist') car.assist = ASSISTS[v][1];
  if (key === 'timeOfDay') world?.setTimeOfDay?.(v);
  if (key === 'quality' || key === 'resolution') applyQuality();
  if (key === 'players') renderMain();
  const btn = $('settings-rows').querySelector(`[data-setting="${key}"]`);
  btn.querySelector('b').textContent = s.opts.find((o) => o[0] === settingValue(key))[1];
}
$('settings-rows').addEventListener('click', (e) => {
  const b = e.target.closest('.cycler');
  if (b) changeSetting(b.dataset.setting, 1);
});
$('settings-rows').addEventListener('cycle', (e) => changeSetting(e.target.dataset.setting, e.detail));
$('settings-rows').addEventListener('input', (e) => {
  const r = e.target;
  if (r.dataset.setting !== 'volume') return;
  settings.set('volume', Number(r.value));
  sound.setVolume(Number(r.value));
  r.style.setProperty('--pct', `${Number(r.value) * 100}%`);
});

// A new graphics preset takes effect on the next world load; resolution and bloom change now.
function applyQuality() {
  preset = settings.preset;
  pixelRatio = targetRatio();
  applyAA();
  resize();
  applyEnv(activeWorld());
  hud.toast(`Graphics: ${preset.label}${world ? ' · full effect on next load' : ''}`);
}

// ---------- driving actions ----------
function respawn() {
  const p = world.nearestRoad(car.x, car.z, car.h);
  car.reset(p.x, p.z, p.heading);
  score.chain = 0;
  score.mult = 1;
  rig.snap(car);
  world.onReset?.('respawn');
  hud.toast('Back on the road');
}

// ---------- the phone ----------
const PHONE_TIMES = [{ id: 'cycle', name: 'Real cycle', note: 'One game hour a minute' }, { id: 'day', name: 'Midday' }, { id: 'dusk', name: 'Golden hour' }, { id: 'night', name: 'Midnight' }];
const pickOne = (a) => a[Math.floor(Math.random() * a.length)];
const phone = new Phone({
  call(id) {
    if (id === 'lester') {
      const had = world?.callOffPolice?.();
      return had ? 'Lester: "Done. I scrubbed you off every camera from here to the coast. They\'ve lost you."' : 'Lester: "Nobody\'s looking for you. Yet. Call me when they are."';
    }
    if (id === 'mechanic') { setTimeout(() => respawn(), 400); return 'Mechanic: "Sit tight… there. Back on the road, good as new."'; }
    if (id === 'hao') return pickOne(['Hao: "Clutch-kick into the slide, then feather the throttle. Don\'t just mash it."', 'Hao: "More angle needs more speed. Carry it in."', 'Hao: "Stiffen the rear, soften the front. Trust me."', 'Hao: "The touge at night. That\'s where the real ones go."']);
    return pickOne(['Lamar: "You drive like my grandma, homie."', 'Lamar: "Yo, that last slide? Weak. Do it again."', 'Lamar: "I seen you on the news, dog. Respect."']);
  },
  skies: () => SKIES,
  sky: () => settings.sky || 'earth',
  setSky(id) { settings.set('sky', id); world?.setSky?.(id); },
  times: () => PHONE_TIMES,
  time: () => settings.timeOfDay,
  setTime(id) { settings.set('timeOfDay', id); world?.setTimeOfDay?.(id); },
  photo() { document.body.classList.add('is-photo'); hud.toast('Photo mode · F or D-pad up to exit'); },
  stats: () => [['Best chain', fmt.format(Math.round(score.best))], ['Lifetime points', fmt.format(Math.round(score.total))], ['Credits', `${fmt.format(profile.credits)} CR`], ['Top speed now', `${Math.round(car.speed * 3.6)} km/h`]],
  mute: () => toggleMute(),
});

function handleAction(a) {
  if (a === 'phone') {
    if (document.body.classList.contains('is-photo')) { document.body.classList.remove('is-photo'); return; }
    if (state === 'drive' && !screens.current) phone.toggle();
    return;
  }
  if (phone.open && state === 'drive' && phone.action(a)) return;
  if (screens.current) {
    if (a === 'help' && screens.current === 'pause') { resume(); return; }
    screens.action(a);
    return;
  }
  if (state !== 'drive') return;
  if (a === 'help') { pause(); return; }
  if (a === 'shiftUp' || a === 'shiftDown') {
    car.shift(a === 'shiftUp' ? 1 : -1);
    if (car.autoGear) hud.toast('Manual gearbox · E / Q to shift');
    car.autoGear = false;
  }
  if (a === 'camera') { hud.toast(`Camera: ${rig.cycle()}`); settings.set('camera', rig.id); }
  if (a === 'view') { hud.toast(rig.toggleView()); settings.set('camera', rig.id); }
  if (a === 'reset') respawn();
  if (a === 'gearbox') { car.autoGear = !car.autoGear; hud.toast(car.autoGear ? 'Automatic gearbox' : 'Manual gearbox · E / Q to shift'); }
  if (a === 'assist') {
    settings.set('assist', (settings.assist + 1) % ASSISTS.length);
    car.assist = ASSISTS[settings.assist][1];
    hud.toast(`Drift assist ${ASSISTS[settings.assist][0]}`);
  }
  if (a === 'mute') hud.toast(toggleMute());
}

// ---------- ground ----------
// Height, pitch and roll of the ground under the car, and gravity's pull down the slope.
const G = 9.81;
function groundPose(x, z, h) {
  const gh = (px, pz) => world.groundAt(px, pz);
  const s = Math.sin(h), c = Math.cos(h);
  const fx = x + s * 1.3, fz = z + c * 1.3, bx = x - s * 1.3, bz = z - c * 1.3;
  const lx = x + c * 0.8, lz = z - s * 0.8, rx = x - c * 0.8, rz = z + s * 0.8;
  const yF = gh(fx, fz), yB = gh(bx, bz), yL = gh(lx, lz), yR = gh(rx, rz);
  // Never below the ground right under the middle of the car (crests and cambered bends).
  const y = Math.max((yF + yB + yL + yR) / 4, gh(x, z) - 0.02);
  const pitch = -Math.atan2(yF - yB, 2.6);
  const roll = Math.atan2(yL - yR, 1.6);
  return { y, pitch, roll, dX: (gh(x + 1, z) - gh(x - 1, z)) / 2, dZ: (gh(x, z + 1) - gh(x, z - 1)) / 2 };
}

// ---------- effects ----------
const smokeAccP1 = [0, 0];
function emitEffects(dt, car = window.__p1car, carView = window.__p1view, ground = window.__p1ground, smokeAcc = smokeAccP1, keyBase = 0) {
  const sh = Math.sin(car.h), ch = Math.cos(car.h);
  const track = carView.rearTrack, back = -carView.rearZ;
  const env = world.env;
  const gy = ground ? ground.y : 0;
  for (const side of [-1, 1]) {
    const slip = Math.max(0, Math.min(1, (car.slip[side > 0 ? 2 : 3] - 2) / 9)) * Math.min(1, car.speed / 4);
    const wx = car.x + ch * side * track - sh * back;
    const wz = car.z - sh * side * track - ch * back;
    const offroad = car.grip < 0.9;
    skids.mark(keyBase + side, wx, wz, slip > 0.08 && !offroad ? 0.22 + slip * 0.45 : 0, clock, 0.25, gy + 0.03);
    // Thick billowing smoke (dust off the road), carried along with the car a little.
    const k = side > 0 ? 1 : 0;
    smokeAcc[k] += slip * slip * dt * (preset.particles / 25);
    while (smokeAcc[k] >= 1) {
      smokeAcc[k] -= 1;
      const j = Math.random();
      particles.emit(wx - sh * j * 0.4, gy + 0.3, wz - ch * j * 0.4, car.vx * 0.3 + (Math.random() - 0.5) * 2.4, 0.4 + Math.random() * 0.6,
        car.vz * 0.3 + (Math.random() - 0.5) * 2.4, 1.0 + Math.random() * 0.4, 2.6, 2.2 + Math.random() * 1.4, offroad ? 0.22 : 0.3);
    }
    // Road spray when it is wet.
    if (env.wet && car.speed > 10 && Math.random() < Math.min(1, car.speed / 40) * dt * 40 * env.wet) {
      particles.emit(wx, gy + 0.25, wz, car.vx * 0.5 + (Math.random() - 0.5) * 3, 1.2, car.vz * 0.5 + (Math.random() - 0.5) * 3, 0.5, 1.6, 0.6, 0.22);
    }
  }
}

// ---------- loop ----------
const STEP = 1 / 120;
let acc = 0;
let prev = performance.now();
let perfTime = 0, perfFrames = 0, fpsShown = 0;
const idleInput = { throttle: 0, brake: 0, steer: 0, handbrake: true, clutch: true };
let rumbleTimer = 0;

function stepDrive(dt, controls) {
  acc += dt;
  let impact = 0;
  while (acc >= STEP) {
    if (!world.flat) {
      ground = groundPose(car.x, car.z, car.h);
      // Gravity along the slope: g·sinθ·cosθ in the direction the ground falls away.
      const k = G / (1 + ground.dX * ground.dX + ground.dZ * ground.dZ);
      car.gx = -ground.dX * k;
      car.gz = -ground.dZ * k;
    }
    world.surface?.(car);
    car.step(STEP, controls);
    impact = Math.max(impact, world.collide(car));
    acc -= STEP;
  }
  if (impact > 3) {
    sound.crash(impact);
    rig.shake = Math.min(0.6, impact * 0.05);
    input.rumble(Math.min(1, impact * 0.12), 0.6, 220);
  }
  rumbleTimer -= dt;
  if (score.angle > 0 && rumbleTimer <= 0) {
    input.rumble(0, Math.min(0.5, 0.12 + score.angle / 180), 120);
    rumbleTimer = 0.1;
  }
  score.update(dt, car, impact);
  for (const e of score.takeEvents()) {
    if (e.type === 'bank') {
      const cr = profile.earn(e.points);
      hud.banner(`+${fmt.format(e.points)}${e.record ? ' · new best' : ''}  +${fmt.format(cr)} CR`, 'bank');
      world.onBank?.(e.points);
    } else hud.banner(`Crashed  −${fmt.format(Math.round(e.points))}`, 'crash');
  }
  sound.update(car, dt);
  emitEffects(dt, car, carView, ground, smokeAccP1, 0);
}

// Two cars against each other: two circles each, an even shove both ways.
function carVsCar(a, b) {
  let impact = 0;
  if (Math.abs(a.x - b.x) > 7 || Math.abs(a.z - b.z) > 7) return 0;
  const s1 = Math.sin(a.h), c1 = Math.cos(a.h), s2 = Math.sin(b.h), c2 = Math.cos(b.h);
  for (const o1 of [1.3, -1.3]) for (const o2 of [1.3, -1.3]) {
    const p1x = s1 * o1, p1z = c1 * o1, p2x = s2 * o2, p2z = c2 * o2;
    const dx = a.x + p1x - b.x - p2x, dz = a.z + p1z - b.z - p2z, d = Math.hypot(dx, dz);
    if (d >= 2 || d < 1e-4) continue;
    const nx = dx / d, nz = dz / d, pen = 2 - d;
    a.x += (nx * pen) / 2; a.z += (nz * pen) / 2; b.x -= (nx * pen) / 2; b.z -= (nz * pen) / 2;
    const vn = (a.vx + a.r * p1z - b.vx - b.r * p2z) * nx + (a.vz - a.r * p1x - b.vz + b.r * p2x) * nz;
    if (vn >= 0) continue;
    impact = Math.max(impact, -vn);
    const ra = p1z * nx - p1x * nz, rb = p2z * nx - p2x * nz;
    const j = (-1.25 * vn) / (1 / a.spec.mass + 1 / b.spec.mass + (ra * ra) / a.spec.inertia + (rb * rb) / b.spec.inertia);
    a.applyImpulse(p1x, p1z, nx * j, nz * j);
    b.applyImpulse(p2x, p2z, -nx * j, -nz * j);
  }
  return impact;
}

// Player two's physics, score and effects.
function stepP2(dt, controls) {
  const c = p2.car;
  p2.acc += dt;
  let impact = 0;
  while (p2.acc >= STEP) {
    if (!world.flat) {
      p2.ground = groundPose(c.x, c.z, c.h);
      const k = G / (1 + p2.ground.dX * p2.ground.dX + p2.ground.dZ * p2.ground.dZ);
      c.gx = -p2.ground.dX * k;
      c.gz = -p2.ground.dZ * k;
    }
    world.surface?.(c);
    c.step(STEP, controls);
    impact = Math.max(impact, world.collide(c), carVsCar(car, c));
    p2.acc -= STEP;
  }
  if (impact > 3) { sound.crash(impact * 0.6); p2.rig.shake = Math.min(0.6, impact * 0.05); }
  p2.score.update(dt, c, impact);
  for (const e of p2.score.takeEvents()) if (e.type === 'bank') hud.banner(`P2 +${fmt.format(e.points)}`, 'bank');
  emitEffects(dt, c, p2.view, p2.ground, p2.smoke, 10);
}

function handleActionP2(a) {
  if (state !== 'drive' || !p2) return;
  if (a === 'help') { pause(); return; }
  if (a === 'shiftUp' || a === 'shiftDown') { p2.car.shift(a === 'shiftUp' ? 1 : -1); p2.car.autoGear = false; }
  if (a === 'camera') p2.rig.cycle();
  if (a === 'view') p2.rig.toggleView();
  if (a === 'reset') { const p = world.nearestRoad(p2.car.x, p2.car.z, p2.car.h); p2.car.reset(p.x, p.z, p.heading); p2.rig.snap(p2.car); }
}

const p2el = {};
function updateHud2() {
  const e = (id) => (p2el[id] ||= $(id));
  const sc = p2.score, c = p2.car;
  e('p2-chain').classList.toggle('is-idle', sc.chain <= 0);
  if (sc.chain > 0) { e('p2-grade').textContent = sc.grade; e('p2-points').textContent = fmt.format(Math.round(sc.chain)); e('p2-mult').textContent = `×${sc.mult.toFixed(1)}`; }
  const mph = settings.units === 'mph';
  e('p2-speed').textContent = String(Math.round(c.speed * (mph ? 2.237 : 3.6)));
  e('p2-units').textContent = mph ? 'mph' : 'km/h';
  e('p2-gear').textContent = c.gear === -1 ? 'R' : String(c.gear);
  e('p2-total').textContent = fmt.format(Math.round(sc.total));
  // Until a second controller has taken the seat, tell player two how to join.
  e('p2-join').hidden = input.slots[1] !== null;
}

// ---------- frame-rate governor ----------
// Levels: 0 full, 1 lighter grass and shorter detail ranges, 2 also no shadows, 3 also no glow and no grass.
const govern = { level: 0, slow: 0, fast: 0 };
const GOVERN_LOAD = [1, 0.7, 0.5, 0.35];
function applyGovern() {
  if (world) applyEnv(world);
}
function governDetail(fps, resAtFloor) {
  if (fps < 32 && resAtFloor) { govern.slow++; govern.fast = 0; } else if (fps > 55) { govern.fast++; govern.slow = 0; } else { govern.slow = 0; govern.fast = 0; }
  if (govern.slow >= 2 && govern.level < 3) { govern.level++; govern.slow = 0; applyGovern(); }
  else if (govern.fast >= 6 && govern.level > 0) { govern.level--; govern.fast = 0; applyGovern(); }
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - prev) / 1000);
  prev = now;
  clock += dt;
  frameNo++;

  input.menuMode = !!screens.current;
  if (phone.open && state !== 'drive') phone.close();
  input.phoneMode = phone.open;
  const controls = input.poll(dt);
  for (const a of input.takeActions()) handleAction(a);

  const driving = state === 'drive';
  const controls2 = p2 ? input.poll2() : null;
  for (const a of input.takeActions2()) handleActionP2(a);
  if (driving) {
    stepDrive(dt, controls);
    if (p2) stepP2(dt, controls2);
  }
  else if (state === 'menu' || state === 'customize') {
    // In the showroom the car idles in neutral; "Rev it" blips the throttle.
    revTimer -= dt;
    idleInput.throttle = revTimer > 0 ? 1 : 0;
    acc += dt;
    while (acc >= STEP) { car.step(STEP, idleInput); acc -= STEP; }
    car.x = 0; car.z = 0; car.vx = 0; car.vz = 0; car.r = 0; car.h = showroom.spawn.heading;
    sound.update(car, dt);
  }

  if (carView) {
    carView.setFirstPerson((driving || state === 'pause') && rig.id === 'cockpit');
    carView.update(car, dt, driving || state === 'pause' ? ground : null);
  }
  const inWorld = (driving || state === 'pause') && world;
  if (inWorld) {
    world.update(clock, dt, { camera, car, playing: driving, carView, hud, score, profile, sound, scene, renderer, skids, applyEnv: () => applyEnv(world) });
    particles.update(dt);
    skids.update(clock);
    // Free look: right stick per player, plus the mouse for player one.
    const lk = input.look(0);
    if (lk.x || lk.y) rig.addLook(-lk.x * dt * 2.6, -lk.y * dt * 1.4);
    if (p2) { const l2 = input.look(1); if (l2.x || l2.y) p2.rig.addLook(-l2.x * dt * 2.6, -l2.y * dt * 1.4); }
    rig.update(dt, car, carView, world, ground, driving);
    if (driving) hud.update(dt, { car, score, profile, settings, world });
    if (p2) {
      p2.view.setFirstPerson(p2.rig.id === 'cockpit');
      p2.view.update(p2.car, dt, p2.ground);
      p2.rig.update(dt, p2.car, p2.view, world, p2.ground, driving);
      camera2.far = camera.far;
      if (driving) updateHud2();
    }
  } else {
    showroom.update(clock);
    particles.update(dt);
    if (camera.view?.enabled) camera.clearViewOffset();
    // Orbit: drifts slowly by itself, or follows a drag, the mouse wheel and the right stick.
    const look = input.look();
    if (look.x || look.y) { orbit.yaw -= look.x * dt * 2.2; orbit.pitch = Math.max(-0.1, Math.min(0.95, orbit.pitch - look.y * dt * 1.2)); orbit.idle = 0; }
    orbit.idle += dt;
    if (orbit.idle > 4 && !orbit.drag) orbit.yaw += dt * (state === 'customize' ? 0.14 : 0.1) * Math.min(1, (orbit.idle - 4) / 2);
    showroom.camera(clock, state === 'customize' ? 'customize' : 'menu', camera, orbit);
    // Frame the car in the space the panel leaves.
    if (state === 'customize') {
      const w = innerWidth, h = innerHeight;
      if (w > 700) camera.setViewOffset(w, h, Math.min(480, w) / 2, 0, w, h);
      else camera.setViewOffset(w, h, 0, (h * 0.64) / 2, w, h);
    } else if (state === 'menu' && innerWidth > 860) camera.setViewOffset(innerWidth, innerHeight, -innerWidth * 0.14, 0, innerWidth, innerHeight);
    camera.fov = 42;
    camera.near = 0.1;
    camera.up.set(0, 1, 0);
    camera.updateProjectionMatrix();
  }
  if (inWorld && camera.view?.enabled) { camera.clearViewOffset(); camera.updateProjectionMatrix(); }

  renderer.info.reset();
  if (inWorld && p2) {
    // Split screen: draw each player's view into their half (no post effects, to keep two views fast).
    const w = innerWidth, h = innerHeight;
    renderer.setScissorTest(true);
    for (const [cam, y] of [[camera, h / 2], [camera2, 0]]) {
      world.render?.(renderer, scene, cam, frameNo, [camera, camera2]);
      renderer.setViewport(0, y, w, h / 2);
      renderer.setScissor(0, y, w, h / 2);
      renderer.render(scene, cam);
    }
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, w, h);
  } else {
    if (inWorld) world.render?.(renderer, scene, camera, frameNo);
    composer.render();
  }

  // Resolution follows the frame rate: drop when the device cannot keep up, recover when it can. Once the
  // resolution is as low as it goes, detail goes next (grass, detail ranges, shadows, glow), in steps.
  perfTime += dt;
  perfFrames++;
  if (perfTime > 2) {
    const fps = perfFrames / perfTime;
    fpsShown = fps;
    const top = targetRatio(), floor = Math.max(0.6, Math.min(top, devicePixelRatio || 1) * 0.55);
    // "Auto" keeps it near 60. Native and supersample hold their resolution unless the game is really
    // struggling (under ~24 fps), then they give way too rather than stay unplayable.
    const auto = settings.resolution === 'auto';
    const struggling = fps < 24;
    if ((auto && fps < 40) || struggling) {
      if (pixelRatio > floor) {
        pixelRatio = Math.max(floor, pixelRatio - (struggling ? 0.25 : 0.15));
        resize();
        if (struggling && !govern.warned && driving) { govern.warned = true; hud.toast('Running slow · lowering resolution and detail'); }
      }
    } else if (fps > 57 && pixelRatio < top && govern.level === 0) { pixelRatio = Math.min(top, pixelRatio + 0.1); resize(); }
    if (inWorld && driving && !window.__cdNoGovern) governDetail(fps, pixelRatio <= floor + 1e-3 || !auto);
    perfTime = 0;
    perfFrames = 0;
  }
  hud.fps(settings.showFps && driving ? `${Math.round(fpsShown)} fps · ${pixelRatio.toFixed(2)}x · ${renderer.info.render.calls} draws · ${Math.round(renderer.info.render.triangles / 1000)}k tris` : '');
}

input.onPadStatus = (status, id = '') => {
  const name = id.replace(/\s*\(.*$/, '').slice(0, 40) || 'Controller';
  const line = $('pad-status');
  if (status === 'connected') { line.textContent = `${name} connected`; hud.toast(`${name} connected`); }
  else if (status === 'disconnected') { line.textContent = 'Controller disconnected'; hud.toast('Controller disconnected'); }
  else { line.textContent = 'This view blocks controllers. Open the game in its own browser tab to use one.'; $('pad-note').hidden = false; }
};
// A second controller pressing A or Start joins as player two: straight into split screen if driving.
input.onJoin = (id) => {
  const name = id.replace(/\s*\(.*$/, '').slice(0, 30) || 'Controller';
  settings.set('players', 2);
  renderMain();
  if (state === 'drive' && world && !p2) {
    startSplit({ x: car.x, z: car.z, heading: car.h });
    hud.toast(`Player 2 joined (${name})`);
  } else hud.toast(`Player 2 ready (${name}) · pick a world`);
};
addEventListener('pointerdown', () => sound.start(), { once: true });
addEventListener('keydown', () => sound.start(), { once: true });
car.autoGear = settings.gearbox !== 'manual';

window.__cd = { get p2() { return p2; }, get carView() { return carView; }, camera, composer, bloom, car, score, input, profile, renderer, scene, settings, get world() { return world; }, loadWorld, showroom, rig, screens, customize };

// Boot straight into the main menu in the showroom.
state = 'menu';
showCar(profile.current);
toShowroom();
resize();
renderMain();
$('loader').hidden = true;
screens.set('main');
requestAnimationFrame(frame);
