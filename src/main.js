import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CarBody } from './physics.js';
import { collide, nearestRoad, SPAWN, BLOCKS, SOLID_BLOCKS, HALF, PILLARS, PLAZA_AREA } from './world.js';
import { WetReflections, LAYER_MAIN_ONLY, LAYER_WET } from './wet.js';
import { buildCity } from './city.js';
import { buildCar, makeCarEnvironment, PAINTS } from './car.js';
import { Particles, SkidMarks, makeRain } from './fx.js';
import { Sound } from './audio.js';
import { Input } from './input.js';
import { DriftScore } from './drift.js';
import { Profile, carById, buildSpec } from './garage.js';
import { GarageUI } from './garageUI.js';

const $ = (id) => document.getElementById(id);
const isTouch = matchMedia('(pointer: coarse)').matches;
if (isTouch) document.body.classList.add('is-touch');

// ---------- renderer ----------
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
let pixelRatio = Math.min(devicePixelRatio || 1, isTouch ? 1.25 : 1.75);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0d0718);
scene.fog = new THREE.FogExp2(0x1a0b24, 0.0068);

const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 2000);
camera.layers.enable(LAYER_MAIN_ONLY);
camera.layers.enable(LAYER_WET);

const hemi = new THREE.HemisphereLight(0x6f5cff, 0x2a1030, 0.9);
scene.add(hemi);
const moon = new THREE.DirectionalLight(0x9fb4ff, 0.35);
moon.position.set(-60, 120, 40);
scene.add(moon);

const refl = new WetReflections();
refl.scale = isTouch ? 0.35 : 0.5;
const city = buildCity(scene, refl);

const sound = new Sound();
const profile = new Profile();
const car = new CarBody(profile.spec());
car.reset(SPAWN.x, SPAWN.z, SPAWN.heading);
const carEnv = makeCarEnvironment(renderer);
let carView = null;

// Builds the 3D car and physics for a car id: your saved style if you own it, the showroom look if not.
function showCar(id) {
  const def = carById(id);
  const style = profile.owns(id) ? profile.car(id) : def.look;
  carView?.dispose();
  carView = buildCar(carEnv, city.radial, { ...def.look, paint: style.paint, neon: style.neon, rims: style.rims });
  carView.onBackfire = () => sound.pop();
  scene.add(carView.root);
  car.spec = profile.owns(id) ? profile.spec(id) : buildSpec(id);
  sound.setVoice(def.voice);
  carView.update(car, 0);
}
showCar(profile.current);

const particles = new Particles(isTouch ? 900 : 2000);
scene.add(particles.points);
const rain = makeRain(isTouch ? 4500 : 10000);
scene.add(rain);
const skids = new SkidMarks(isTouch ? 1400 : 2400);
scene.add(skids.mesh);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.85, 0.55, 0.82);
composer.addPass(bloom);
composer.addPass(new OutputPass());

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(w, h, false);
  composer.setPixelRatio(pixelRatio);
  composer.setSize(w, h);
  refl.setSize(w * pixelRatio, h * pixelRatio);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  particles.material.uniforms.uScale.value = (h * pixelRatio) / 2;
}
addEventListener('resize', resize);
resize();

// ---------- game state ----------
const input = new Input();
input.bindTouch($('touch'));
const score = new DriftScore();
const ASSISTS = [['Off', 0], ['Low', 0.35], ['Medium', 0.75], ['High', 1]];
let assistIndex = 2;
car.assist = ASSISTS[assistIndex][1];
let cameraMode = 0;
const CAMERAS = ['Chase', 'Far chase', 'Bumper'];
let playing = false;
let started = false;
let shake = 0;
let flash = 0;
let nextLightning = 12 + Math.random() * 20;
let clock = 0;
let rumbleTimer = 0;

try { assistIndex = Math.min(3, Math.max(0, Number(localStorage.getItem('cd.assist2') ?? 2))); } catch { /* storage blocked */ }
car.assist = ASSISTS[assistIndex][1];

// ---------- HUD ----------
const hud = {
  total: $('total'), best: $('best'), chain: $('chain'), grade: $('grade'), points: $('points'), mult: $('mult'),
  angle: $('angle'), grace: $('grace'), speed: $('speed'), gear: $('gear'), banner: $('banner'), toast: $('toast'),
  chipGear: $('chip-gear'), chipAssist: $('chip-assist'), credits: $('credits'),
};
const fmt = new Intl.NumberFormat('en-US');
const last = {};
function setText(key, el, text) {
  if (last[key] !== text) { el.textContent = text; last[key] = text; }
}

// Tachometer drawn once in SVG; the live arc is a dash along a unit-length path.
const TACH = { cx: 95, cy: 95, r: 82, a0: 135, sweep: 270, max: 8000 };
function arcPath(fromFrac, toFrac, r = TACH.r) {
  const ang = (f) => ((TACH.a0 + TACH.sweep * f) * Math.PI) / 180;
  const p = (f) => [TACH.cx + r * Math.cos(ang(f)), TACH.cy + r * Math.sin(ang(f))];
  const [x0, y0] = p(fromFrac), [x1, y1] = p(toFrac);
  const large = (toFrac - fromFrac) * TACH.sweep > 180 ? 1 : 0;
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}
(function drawTach() {
  let svg = `<path class="dash__track" d="${arcPath(0, 1)}"/>`;
  svg += `<path class="dash__red" d="${arcPath(7000 / TACH.max, 1)}"/>`;
  svg += `<path class="dash__rpm" id="rpm" pathLength="1" stroke-dasharray="0 1" d="${arcPath(0, 1)}"/>`;
  for (let k = 0; k <= 8; k++) {
    const a = ((TACH.a0 + (TACH.sweep * k) / 8) * Math.PI) / 180;
    const c = Math.cos(a), s = Math.sin(a);
    svg += `<line class="dash__tick" x1="${95 + c * 70}" y1="${95 + s * 70}" x2="${95 + c * 76}" y2="${95 + s * 76}"/>`;
    svg += `<text class="dash__num" x="${95 + c * 60}" y="${95 + s * 60}">${k}</text>`;
  }
  $('tach').innerHTML = svg;
})();
const rpmArc = $('rpm');

let toastTimer = 0;
function toast(text) {
  hud.toast.textContent = text;
  hud.toast.classList.add('is-shown');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => hud.toast.classList.remove('is-shown'), 1600);
}
function banner(text, kind) {
  const b = hud.banner;
  b.textContent = text;
  b.className = `banner banner--${kind}`;
  void b.offsetWidth;
  b.classList.add('is-shown');
}

// Minimap: the city pre-drawn once at 1 px per metre, then rotated so the car always points up.
const mapImg = document.createElement('canvas');
const MAP_OFF = HALF + 30;
mapImg.width = mapImg.height = Math.ceil(MAP_OFF * 2);
(function drawMap() {
  const g = mapImg.getContext('2d');
  g.fillStyle = '#1a1030';
  g.fillRect(0, 0, mapImg.width, mapImg.height);
  g.fillStyle = '#5b5680';
  g.fillRect(30, 30, HALF * 2, HALF * 2);
  for (const b of BLOCKS) {
    g.fillStyle = b.plaza ? '#4a2350' : '#120c22';
    if (b.plaza) continue;
    g.fillRect(b.x0 + MAP_OFF, b.z0 + MAP_OFF, b.x1 - b.x0, b.z1 - b.z0);
  }
  g.strokeStyle = '#ff3fb4';
  g.lineWidth = 2;
  g.strokeRect(PLAZA_AREA.x0 + MAP_OFF + 2, PLAZA_AREA.z0 + MAP_OFF + 2, PLAZA_AREA.x1 - PLAZA_AREA.x0 - 4, PLAZA_AREA.z1 - PLAZA_AREA.z0 - 4);
  g.fillStyle = '#ff3fb4';
  for (const p of PILLARS) { g.beginPath(); g.arc(p.x + MAP_OFF, p.z + MAP_OFF, p.r + 1, 0, Math.PI * 2); g.fill(); }
})();
const mini = $('minimap').getContext('2d');
function drawMinimap() {
  const W = 336, s = W / 2 / 150;
  const ch = Math.cos(car.h), sh = Math.sin(car.h);
  const a = -s * ch, b = -s * sh, c = s * sh, d = -s * ch;
  const px = car.x + MAP_OFF, pz = car.z + MAP_OFF;
  mini.setTransform(1, 0, 0, 1, 0, 0);
  mini.fillStyle = '#0c0818';
  mini.fillRect(0, 0, W, W);
  mini.setTransform(a, b, c, d, W / 2 - a * px - c * pz, W / 2 - b * px - d * pz);
  mini.drawImage(mapImg, 0, 0);
  mini.setTransform(1, 0, 0, 1, 0, 0);
  mini.fillStyle = '#33f0ff';
  mini.shadowColor = '#33f0ff';
  mini.shadowBlur = 12;
  mini.beginPath();
  mini.moveTo(W / 2, W / 2 - 13);
  mini.lineTo(W / 2 + 8, W / 2 + 9);
  mini.lineTo(W / 2, W / 2 + 4);
  mini.lineTo(W / 2 - 8, W / 2 + 9);
  mini.closePath();
  mini.fill();
  mini.shadowBlur = 0;
}

function updateHud() {
  setText('total', hud.total, fmt.format(Math.round(score.total)));
  setText('best', hud.best, fmt.format(Math.round(score.best)));
  setText('credits', hud.credits, `${fmt.format(profile.credits)} CR`);
  const showChain = score.chain > 0;
  hud.chain.classList.toggle('is-idle', !showChain);
  if (showChain) {
    setText('grade', hud.grade, score.grade);
    setText('points', hud.points, fmt.format(Math.round(score.chain)));
    setText('mult', hud.mult, `×${score.mult.toFixed(1)}`);
    setText('angle', hud.angle, `${Math.round(score.angle)}°`);
    hud.grace.style.transform = `scaleX(${score.graceLeft.toFixed(3)})`;
  }
  setText('speed', hud.speed, String(Math.round(car.speed * 3.6)));
  setText('gear', hud.gear, car.gear === -1 ? 'R' : String(car.gear));
  const frac = Math.min(1, car.rpm / TACH.max);
  rpmArc.setAttribute('stroke-dasharray', `${frac.toFixed(3)} 1`);
  rpmArc.classList.toggle('is-hot', car.rpm > 7000);
  setText('chipGear', hud.chipGear, car.autoGear ? 'AUTO' : 'MANUAL');
  setText('chipAssist', hud.chipAssist, `ASSIST ${ASSISTS[assistIndex][0].toUpperCase()}`);
  drawMinimap();
}

// ---------- menu ----------
const menu = $('menu');
function syncOptions() {
  $('opt-assist').textContent = `Assist: ${ASSISTS[assistIndex][0]}`;
  $('opt-gearbox').textContent = `Gearbox: ${car.autoGear ? 'Auto' : 'Manual'}`;
  $('menu-car').textContent = `Car: ${carById(profile.current).name} · ${fmt.format(profile.credits)} CR`;
}
function cycleAssist() {
  assistIndex = (assistIndex + 1) % ASSISTS.length;
  car.assist = ASSISTS[assistIndex][1];
  try { localStorage.setItem('cd.assist2', String(assistIndex)); } catch { /* storage blocked */ }
  syncOptions();
  return `Drift assist ${ASSISTS[assistIndex][0]}`;
}
function toggleGearbox() {
  car.autoGear = !car.autoGear;
  syncOptions();
  return car.autoGear ? 'Automatic gearbox' : 'Manual gearbox · E / Q to shift';
}
function nextPaint() {
  const i = (profile.car().paint + 1) % PAINTS.length;
  profile.setStyle(profile.current, 'paint', i);
  return carView.setPaint(i);
}
$('opt-assist').addEventListener('click', cycleAssist);
$('opt-gearbox').addEventListener('click', toggleGearbox);
$('opt-garage').addEventListener('click', () => {
  menu.hidden = true;
  garage.open();
});
$('go').addEventListener('click', () => setPlaying(true));
$('btn-menu').addEventListener('click', () => setPlaying(false));
$('btn-sound').addEventListener('click', (e) => {
  sound.setMuted(!sound.muted);
  e.currentTarget.textContent = sound.muted ? 'Sound off' : 'Sound on';
  e.currentTarget.blur();
});

function setPlaying(on) {
  playing = on;
  menu.hidden = on;
  $('hud').hidden = !on && !started;
  $('touch').hidden = !(on && isTouch);
  if (on) {
    started = true;
    $('go').textContent = 'Resume';
    sound.start();
    sound.setMuted(sound.muted);
    canvas.focus?.();
  } else if (sound.ctx) sound.ctx.suspend();
  syncOptions();
}

// ---------- garage ----------
const garage = new GarageUI($('garage'), profile, {
  onPreview: (id) => showCar(id),
  onChange: (id, what) => {
    const style = profile.car(id);
    if (what === 'select') {
      showCar(id);
      car.reset(car.x, car.z, car.h);
      score.chain = 0;
      score.mult = 1;
    } else if (what === 'spec') car.spec = profile.spec(id);
    else if (what === 'paint') carView.setPaint(style.paint);
    else if (what === 'neon') carView.setNeon(style.neon);
    else if (what === 'rims') carView.setRims(style.rims);
  },
  onClose: () => {
    menu.hidden = false;
    syncOptions();
    $('opt-garage').focus({ preventScroll: true });
  },
  onToast: (text) => toast(text),
});

function handleAction(a) {
  if (garage.isOpen) {
    if (a === 'help') garage.close();
    return;
  }
  if (a === 'help') { setPlaying(!playing); return; }
  if (a === 'confirm') { if (!playing) setPlaying(true); return; }
  if (!playing) return;
  if (a === 'shiftUp') { car.shift(1); if (car.autoGear) toast('Manual gearbox'); car.autoGear = false; }
  if (a === 'shiftDown') { car.shift(-1); if (car.autoGear) toast('Manual gearbox'); car.autoGear = false; }
  if (a === 'camera') { cameraMode = (cameraMode + 1) % CAMERAS.length; toast(`Camera: ${CAMERAS[cameraMode]}`); }
  if (a === 'reset') {
    const p = nearestRoad(car.x, car.z, car.h);
    car.reset(p.x, p.z, p.heading);
    score.chain = 0;
    score.mult = 1;
    toast('Back on the road');
  }
  if (a === 'gearbox') toast(toggleGearbox());
  if (a === 'assist') toast(cycleAssist());
  if (a === 'paint') toast(nextPaint());
  if (a === 'mute') $('btn-sound').click();
}

// ---------- camera ----------
const camPos = new THREE.Vector3();
const camLook = new THREE.Vector3();
let camYaw = 0;
let camLean = 0;

// Keeps the camera out of buildings: walks from the car toward the camera and stops before the first block.
// Returns how far along it got (1 = clear).
function inBlock(x, z, m) {
  if (Math.abs(x) > HALF - m || Math.abs(z) > HALF - m) return true;
  for (const b of SOLID_BLOCKS) if (x > b.x0 - m && x < b.x1 + m && z > b.z0 - m && z < b.z1 + m) return true;
  return false;
}
function avoidWalls(pos) {
  const dx = pos.x - car.x, dz = pos.z - car.z;
  let t = 1;
  for (let k = 1; k <= 16; k++) {
    if (inBlock(car.x + (dx * k) / 16, car.z + (dz * k) / 16, 0.6)) { t = Math.max(0.2, (k - 1) / 16); break; }
  }
  pos.x = car.x + dx * t;
  pos.z = car.z + dz * t;
  return t;
}

function updateCamera(dt) {
  const f = new THREE.Vector3(Math.sin(car.h), 0, Math.cos(car.h));
  const carPos = new THREE.Vector3(car.x, 0, car.z);
  // In the garage the panel covers one side, so shift the framing to centre the car in what is left.
  if (garage.isOpen) {
    const w = innerWidth, h = innerHeight;
    if (w > 700) camera.setViewOffset(w, h, Math.min(420, w) / 2, 0, w, h);
    else camera.setViewOffset(w, h, 0, (h * 0.62) / 2, w, h);
  } else if (camera.view?.enabled) camera.clearViewOffset();
  if (garage.isOpen || (!playing && !started)) {
    // Showroom / attract mode: slow orbit around the parked car.
    const near = garage.isOpen;
    const a = clock * (near ? 0.25 : 0.18) + (window.__cdOrbit || 0);
    const r = near ? (camera.aspect < 1 ? 10 : 6.2) : 9;
    camera.position.set(car.x + Math.sin(a) * r, near ? 1.5 : 2.2, car.z + Math.cos(a) * r);
    avoidWalls(camera.position);
    camera.lookAt(car.x, near ? 0.6 : 0.9, car.z);
    camera.fov = 50;
    camera.updateProjectionMatrix();
    camPos.set(0, 0, 0);
    return;
  }
  if (cameraMode === 2) {
    camera.position.copy(carPos).addScaledVector(f, 0.6).setY(1.05);
    camera.lookAt(carPos.clone().addScaledVector(f, 20).setY(0.9));
  } else {
    // Swing toward the direction of travel so the car is framed side-on in a drift.
    const velYaw = car.speed > 3 ? Math.atan2(car.vx, car.vz) : car.h;
    let diff = velYaw - car.h;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    const targetYaw = car.h + diff * 0.55;
    let dy = targetYaw - camYaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    camYaw += dy * Math.min(1, dt * 5);
    const far = cameraMode === 1;
    const dist = (far ? 8.8 : 6.2) + Math.min(car.speed, 50) * 0.025;
    const height = far ? 3.3 : 2.2;
    const target = new THREE.Vector3(car.x - Math.sin(camYaw) * dist, height, car.z - Math.cos(camYaw) * dist);
    // Backed against a wall: pull in and rise so the car stays in view instead of the camera entering a building.
    const clear = avoidWalls(target);
    target.y += (1 - clear) * 1.6;
    if (camPos.lengthSq() === 0) camPos.copy(target);
    camPos.lerp(target, 1 - Math.exp(-dt * 10));
    avoidWalls(camPos);
    camera.position.copy(camPos);
    camLook.set(car.x + Math.sin(camYaw) * 3, 1.0, car.z + Math.cos(camYaw) * 3);
    camera.lookAt(camLook);
    // A slight lean against cornering load.
    camLean = THREE.MathUtils.damp(camLean, THREE.MathUtils.clamp(-car.r * car.u * 0.0018, -0.035, 0.035), 4, dt);
    camera.rotateZ(camLean);
  }
  // Fine high-speed buzz above 150 km/h.
  const fast = Math.max(0, car.speed * 3.6 - 150) / 100;
  if (fast > 0 && playing) {
    camera.position.x += (Math.random() - 0.5) * 0.02 * fast;
    camera.position.y += (Math.random() - 0.5) * 0.02 * fast;
  }
  if (shake > 0) {
    camera.position.x += (Math.random() - 0.5) * shake;
    camera.position.y += (Math.random() - 0.5) * shake;
    shake = Math.max(0, shake - dt * 2.5);
  }
  const fov = 62 + Math.min(car.speed * 3.6, 220) * 0.07;
  camera.fov += (fov - camera.fov) * Math.min(1, dt * 3);
  camera.updateProjectionMatrix();
}

// ---------- effects ----------
const tmp = new THREE.Vector3();
const smokeAcc = [0, 0];
function emitEffects(dt) {
  const sh = Math.sin(car.h), ch = Math.cos(car.h);
  const track = carView.rearTrack, back = -carView.rearZ;
  for (const side of [-1, 1]) {
    // Each rear tyre smokes and marks from its own sliding speed (index 2 is rear left, 3 rear right).
    const slip = Math.max(0, Math.min(1, (car.slip[side > 0 ? 2 : 3] - 2) / 9)) * Math.min(1, car.speed / 4);
    const wx = car.x + ch * side * track - sh * back;
    const wz = car.z - sh * side * track - ch * back;
    skids.mark(side, wx, wz, slip > 0.08 ? 0.22 + slip * 0.45 : 0, clock);
    // Thick billowing smoke: up to ~80 puffs a second per tyre, carried along with the car a little.
    smokeAcc[side > 0 ? 1 : 0] += slip * slip * dt * 80;
    while (smokeAcc[side > 0 ? 1 : 0] >= 1) {
      smokeAcc[side > 0 ? 1 : 0] -= 1;
      const j = Math.random();
      particles.emit(wx - sh * j * 0.4, 0.3, wz - ch * j * 0.4, car.vx * 0.3 + (Math.random() - 0.5) * 2.4, 0.4 + Math.random() * 0.6,
        car.vz * 0.3 + (Math.random() - 0.5) * 2.4, 1.0 + Math.random() * 0.4, 2.6, 2.2 + Math.random() * 1.4, 0.3);
    }
    // Wet road spray behind the tyres.
    if (car.speed > 10 && Math.random() < Math.min(1, car.speed / 40) * dt * 40) {
      particles.emit(wx, 0.25, wz, car.vx * 0.5 + (Math.random() - 0.5) * 3, 1.2, car.vz * 0.5 + (Math.random() - 0.5) * 3, 0.5, 1.6, 0.6, 0.22);
    }
  }
}

function updateWeather(dt) {
  nextLightning -= dt;
  if (nextLightning <= 0) {
    flash = 1;
    nextLightning = 15 + Math.random() * 30;
    sound.thunder(0.6 + Math.random() * 1.5);
  }
  const flicker = flash > 0 ? flash * (0.6 + 0.4 * Math.sin(clock * 60)) : 0;
  flash = Math.max(0, flash - dt * 2.2);
  hemi.intensity = 0.9 + flicker * 3;
  rain.material.uniforms.uFlash.value = flicker;
  rain.material.uniforms.uTime.value = clock;
  rain.material.uniforms.uCam.value.copy(camera.position);
  refl.uniforms.uTime.value = clock;
  city.update(clock, camera, flicker);
}

// ---------- loop ----------
const STEP = 1 / 120;
let acc = 0;
let prev = performance.now();
let perfTime = 0, perfFrames = 0;
const idleInput = { throttle: 0, brake: 0, steer: 0, handbrake: false };

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - prev) / 1000);
  prev = now;
  clock += dt;

  const controls = input.poll(dt);
  for (const a of input.takeActions()) handleAction(a);

  if (playing) {
    acc += dt;
    let impact = 0;
    while (acc >= STEP) {
      car.step(STEP, controls);
      impact = Math.max(impact, collide(car));
      acc -= STEP;
    }
    if (impact > 3) {
      sound.crash(impact);
      shake = Math.min(0.6, impact * 0.05);
      input.rumble(Math.min(1, impact * 0.12), 0.6, 220);
    }
    // Light tyre buzz through the controller while sideways.
    rumbleTimer -= dt;
    if (score.angle > 0 && rumbleTimer <= 0) {
      input.rumble(0, Math.min(0.5, 0.12 + score.angle / 180), 120);
      rumbleTimer = 0.1;
    }
    score.update(dt, car, impact);
    for (const e of score.takeEvents()) {
      if (e.type === 'bank') {
        const cr = profile.earn(e.points);
        banner(`+${fmt.format(e.points)}${e.record ? ' · NEW BEST' : ''}  +${fmt.format(cr)} CR`, 'bank');
      }
      else banner(`CRASHED  −${fmt.format(Math.round(e.points))}`, 'crash');
    }
    sound.update(car, dt);
    emitEffects(dt);
  } else if (!started) {
    car.step(STEP, idleInput);
  }

  carView.update(car, dt);
  particles.update(dt);
  skids.update(clock);
  updateCamera(dt);
  updateWeather(dt);
  if (started) updateHud();

  refl.render(renderer, scene, camera);
  composer.render();

  // Drop resolution if the device cannot keep up.
  perfTime += dt;
  perfFrames++;
  if (perfTime > 3) {
    const fps = perfFrames / perfTime;
    if (fps < 38 && pixelRatio > 0.75) {
      pixelRatio = Math.max(0.75, pixelRatio - 0.25);
      resize();
    }
    perfTime = 0;
    perfFrames = 0;
  }
}

input.onPadStatus = (status, id = '') => {
  const name = id.replace(/\s*\(.*$/, '').slice(0, 40) || 'Controller';
  const line = $('pad-status');
  if (status === 'connected') {
    line.textContent = `${name} connected · press A to drive`;
    toast(`${name} connected`);
  } else if (status === 'disconnected') {
    line.textContent = 'Controller disconnected';
    toast('Controller disconnected');
  } else {
    line.textContent = 'This view blocks controllers. Open the game in its own browser tab to use one.';
  }
};
window.__cd = { car, score, input, profile, garage, skids }; // handy from the console
$('boot').remove();
menu.hidden = false;
syncOptions();
requestAnimationFrame(frame);
