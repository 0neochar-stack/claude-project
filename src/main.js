// Game shell: renderer, menus, the player's car, and whichever world is loaded. Worlds are built when first
// chosen and freed when another is picked; the showroom behind the menus is always there and cheap.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CarBody } from './physics.js';
import { LAYER_MAIN_ONLY, LAYER_WET } from './wet.js';
import { buildCar, makeCarEnvironment } from './car.js';
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
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
let pixelRatio = Math.min(devicePixelRatio || 1, preset.pixelRatio);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 2000);
camera.layers.enable(LAYER_MAIN_ONLY);
camera.layers.enable(LAYER_WET);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.8, 0.5, 0.85);
composer.addPass(bloom);
composer.addPass(new OutputPass());

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
  const active = activeWorld();
  if (active.env.carEnv) carView.setEnvMap(active.env.carEnv);
  carView.setLights(active.env.headlights !== false);
  carView.setStance(profile.owns(id) ? profile.car(id).tune : null);
  car.spec = profile.owns(id) ? profile.spec(id) : buildSpec(id);
  sound.setEngine(profile.owns(id) ? engineSound(id, profile.car(id).tune) : def.engine);
  carView.update(car, 0, ground);
}

const activeWorld = () => (state === 'drive' || state === 'pause' || state === 'loading' ? world || showroom : showroom);

// ---------- world environment ----------
function applyEnv(w) {
  const env = w.env;
  scene.background = env.background;
  scene.fog = env.fog;
  renderer.toneMappingExposure = env.exposure;
  bloom.enabled = preset.bloom && !!env.bloom;
  if (env.bloom) { bloom.strength = env.bloom.strength; bloom.radius = env.bloom.radius; bloom.threshold = env.bloom.threshold; }
  const far = Math.min(env.far, preset.far);
  if (camera.far !== far) { camera.far = far; camera.updateProjectionMatrix(); }
  renderer.shadowMap.enabled = !!(preset.shadows && env.shadows);
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
  world?.resize?.(w * pixelRatio, h * pixelRatio);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
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
  car.spec = profile.spec();
  score.chain = 0;
  score.mult = 1;
  rig.snap(car);
  world.onReset?.();
  enterDrive();
}

function enterDrive() {
  state = 'drive';
  screens.set(null);
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
  setWorldVisible();
  car.reset(0, 0, showroom.spawn.heading);
  ground = null;
  rig.snap(car);
}

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
  { key: 'camera', label: 'Camera', opts: CAMERAS.map((c) => [c.id, c.name]) },
  { key: 'assist', label: 'Drift assist', note: 'Counter-steer and angle help', opts: ASSISTS.map(([n], i) => [i, n]) },
  { key: 'gearbox', label: 'Gearbox', opts: [['auto', 'Automatic'], ['manual', 'Manual']] },
  { key: 'units', label: 'Speed units', opts: [['kmh', 'km/h'], ['mph', 'mph']] },
  { key: 'timeOfDay', label: 'Time of day', note: 'Open World', opts: TIMES },
  { key: 'showFps', label: 'Show FPS', opts: [[false, 'Off'], [true, 'On']] },
  { key: 'volume', label: 'Volume', range: [0, 1, 0.05] },
];
function settingValue(key) { return key === 'gearbox' ? (car.autoGear ? 'auto' : 'manual') : settings[key]; }
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
  if (key === 'quality') applyQuality();
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
  pixelRatio = Math.min(devicePixelRatio || 1, preset.pixelRatio);
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
  world.onReset?.();
  hud.toast('Back on the road');
}

function handleAction(a) {
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
  const y = (yF + yB + yL + yR) / 4;
  const pitch = -Math.atan2(yF - yB, 2.6);
  const roll = Math.atan2(yL - yR, 1.6);
  return { y, pitch, roll, dX: (gh(x + 1, z) - gh(x - 1, z)) / 2, dZ: (gh(x, z + 1) - gh(x, z - 1)) / 2 };
}

// ---------- effects ----------
const smokeAcc = [0, 0];
function emitEffects(dt) {
  const sh = Math.sin(car.h), ch = Math.cos(car.h);
  const track = carView.rearTrack, back = -carView.rearZ;
  const env = world.env;
  const gy = ground ? ground.y : 0;
  for (const side of [-1, 1]) {
    const slip = Math.max(0, Math.min(1, (car.slip[side > 0 ? 2 : 3] - 2) / 9)) * Math.min(1, car.speed / 4);
    const wx = car.x + ch * side * track - sh * back;
    const wz = car.z - sh * side * track - ch * back;
    const offroad = car.grip < 0.9;
    skids.mark(side, wx, wz, slip > 0.08 && !offroad ? 0.22 + slip * 0.45 : 0, clock, 0.25, gy + 0.03);
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
  emitEffects(dt);
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - prev) / 1000);
  prev = now;
  clock += dt;
  frameNo++;

  input.menuMode = !!screens.current;
  const controls = input.poll(dt);
  for (const a of input.takeActions()) handleAction(a);

  const driving = state === 'drive';
  if (driving) stepDrive(dt, controls);
  else if (state === 'menu' || state === 'customize') {
    // In the showroom the car idles in neutral; "Rev it" blips the throttle.
    revTimer -= dt;
    idleInput.throttle = revTimer > 0 ? 1 : 0;
    acc += dt;
    while (acc >= STEP) { car.step(STEP, idleInput); acc -= STEP; }
    car.x = 0; car.z = 0; car.vx = 0; car.vz = 0; car.r = 0; car.h = showroom.spawn.heading;
    sound.update(car, dt);
  }

  if (carView) carView.update(car, dt, driving || state === 'pause' ? ground : null);
  const inWorld = (driving || state === 'pause') && world;
  if (inWorld) {
    world.update(clock, dt, { camera, car, playing: driving, carView, hud, score, profile, sound, scene, renderer, applyEnv: () => applyEnv(world) });
    particles.update(dt);
    skids.update(clock);
    rig.update(dt, car, carView, world, ground, driving);
    if (driving) hud.update(dt, { car, score, profile, settings, world });
  } else {
    showroom.update(clock);
    particles.update(dt);
    if (camera.view?.enabled) camera.clearViewOffset();
    showroom.camera(clock, state === 'customize' ? 'customize' : 'menu', camera);
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

  if (inWorld) world.render?.(renderer, scene, camera, frameNo);
  if (bloom.enabled) composer.render();
  else renderer.render(scene, camera);

  // Resolution follows the frame rate: drop when the device cannot keep up, recover when it can.
  perfTime += dt;
  perfFrames++;
  if (perfTime > 2) {
    const fps = perfFrames / perfTime;
    fpsShown = fps;
    const top = Math.min(devicePixelRatio || 1, preset.pixelRatio);
    if (fps < 40 && pixelRatio > 0.6) { pixelRatio = Math.max(0.6, pixelRatio - 0.15); resize(); }
    else if (fps > 57 && pixelRatio < top) { pixelRatio = Math.min(top, pixelRatio + 0.1); resize(); }
    perfTime = 0;
    perfFrames = 0;
  }
  hud.fps(settings.showFps && driving ? `${Math.round(fpsShown)} fps · ${pixelRatio.toFixed(2)}x · ${renderer.info.render.calls} draws` : '');
}

input.onPadStatus = (status, id = '') => {
  const name = id.replace(/\s*\(.*$/, '').slice(0, 40) || 'Controller';
  const line = $('pad-status');
  if (status === 'connected') { line.textContent = `${name} connected`; hud.toast(`${name} connected`); }
  else if (status === 'disconnected') { line.textContent = 'Controller disconnected'; hud.toast('Controller disconnected'); }
  else line.textContent = 'This view blocks controllers. Open the game in its own browser tab to use one.';
};
addEventListener('pointerdown', () => sound.start(), { once: true });
addEventListener('keydown', () => sound.start(), { once: true });
car.autoGear = settings.gearbox !== 'manual';

window.__cd = { get carView() { return carView; }, camera, composer, bloom, car, score, input, profile, renderer, scene, settings, get world() { return world; }, loadWorld, showroom, rig, screens, customize };

// Boot straight into the main menu in the showroom.
state = 'menu';
showCar(profile.current);
toShowroom();
resize();
renderMain();
$('loader').hidden = true;
screens.set('main');
requestAnimationFrame(frame);
