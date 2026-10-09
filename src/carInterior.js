// The cockpit: instrument cluster with live tach and speedo needles, a shift-light strip that fills toward
// the redline and flashes on the limiter, a centre screen, the gear lever moving through its H-pattern, and
// a driver whose gloved hands hold the wheel, turn with it, and reach for the lever on every shift.
import * as THREE from 'three';

function dialTexture(kind, max) {
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  const c = S / 2;
  g.fillStyle = '#060608';
  g.beginPath(); g.arc(c, c, c - 2, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#3a3a40'; g.lineWidth = 6; g.stroke();
  const a0 = Math.PI * 0.75, sweep = Math.PI * 1.5;
  const n = kind === 'tach' ? max : max / 20;
  // Red zone on the tach.
  if (kind === 'tach') {
    g.strokeStyle = '#d4141e'; g.lineWidth = 16;
    g.beginPath(); g.arc(c, c, c - 22, a0 + sweep * ((max - 1.2) / max), a0 + sweep); g.stroke();
  }
  for (let k = 0; k <= n * 2; k++) {
    const a = a0 + (sweep * k) / (n * 2);
    const major = k % 2 === 0;
    const r1 = c - 14, r0 = major ? c - 34 : c - 24;
    g.strokeStyle = major ? '#f2f2f2' : '#9a9aa2'; g.lineWidth = major ? 4 : 2;
    g.beginPath(); g.moveTo(c + Math.cos(a) * r0, c + Math.sin(a) * r0); g.lineTo(c + Math.cos(a) * r1, c + Math.sin(a) * r1); g.stroke();
    if (major && (kind === 'tach' || (k / 2) % 2 === 0)) {
      g.fillStyle = '#f2f2f2'; g.font = 'bold 26px Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(String(kind === 'tach' ? k / 2 : (k / 2) * 20), c + Math.cos(a) * (c - 54), c + Math.sin(a) * (c - 54));
    }
  }
  g.fillStyle = '#8a8a92'; g.font = '16px Arial, sans-serif'; g.textAlign = 'center';
  g.fillText(kind === 'tach' ? 'x1000 r/min' : 'km/h', c, c + 52);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// A tapered limb from a to b, recomputed each frame.
function limb(mesh, a, b) {
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  const d = new THREE.Vector3().subVectors(b, a);
  mesh.scale.set(1, d.length(), 1);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
}

export function addInterior(body, { driverX, dashY, wheel, wheelR = 0.17, knob, eye, envMap, suit = 0x24407a, accent = 0xd8203f }) {
  const group = new THREE.Group();
  body.add(group);
  const dark = new THREE.MeshStandardMaterial({ color: 0x0c0c10, roughness: 0.7 });
  const trim = new THREE.MeshStandardMaterial({ color: 0x2a2a30, roughness: 0.45, metalness: 0.5, envMap });

  // ---------- cluster ----------
  const clusterZ = 0.2, clusterY = dashY + 0.035;
  const hood = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.4, 16, 1, true, -Math.PI / 2, Math.PI).rotateZ(Math.PI / 2).rotateY(Math.PI / 2), dark);
  hood.material = new THREE.MeshStandardMaterial({ color: 0x0c0c10, roughness: 0.7, side: THREE.DoubleSide });
  hood.scale.set(1, 0.5, 0.6);
  hood.position.set(driverX, clusterY + 0.02, clusterZ + 0.02);
  group.add(hood);
  const panel = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.13, 0.02), dark);
  panel.position.set(driverX, clusterY, clusterZ + 0.015);
  panel.rotation.x = -0.25;
  group.add(panel);
  let tachMax = 0;
  const tachMat = new THREE.MeshBasicMaterial({ color: 0x9a9aa0 });
  const speedMat = new THREE.MeshBasicMaterial({ map: dialTexture('speed', 300), color: 0x9a9aa0 });
  const dial = (x, mat) => {
    const m = new THREE.Mesh(new THREE.CircleGeometry(0.058, 32), mat);
    m.position.set(x, clusterY, clusterZ);
    m.rotation.set(-0.25, Math.PI, 0);
    group.add(m);
    return m;
  };
  dial(driverX - 0.075, tachMat);
  dial(driverX + 0.075, speedMat);
  const needleMat = new THREE.MeshBasicMaterial({ color: 0xff5a1a });
  const needle = (x) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, clusterY, clusterZ - 0.002);
    pivot.rotation.set(-0.25, Math.PI, 0);
    const n = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.05, 0.002).translate(0, 0.02, -0.002), needleMat);
    const cap = new THREE.Mesh(new THREE.CircleGeometry(0.008, 12), dark);
    cap.position.z = -0.004;
    pivot.add(n, cap);
    group.add(pivot);
    return pivot;
  };
  const tachNeedle = needle(driverX - 0.075), speedNeedle = needle(driverX + 0.075);
  // Shift lights above the cluster.
  const leds = [];
  const ledColors = [0x2aff5a, 0x2aff5a, 0x2aff5a, 0xffd21a, 0xffd21a, 0xff2a2a, 0xff2a2a];
  ledColors.forEach((c, k) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.01, 0.006), new THREE.MeshBasicMaterial({ color: 0x111111 }));
    m.position.set(driverX - 0.075 + k * 0.025, clusterY + 0.078, clusterZ + 0.005);
    m.rotation.x = -0.25;
    m.userData.on = new THREE.Color(c).multiplyScalar(1.5);
    group.add(m);
    leds.push(m);
  });
  // Centre screen and vents.
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.11), new THREE.MeshBasicMaterial({ color: 0x0a2a4a }));
  screen.position.set(0, dashY - 0.03, 0.27);
  screen.rotation.set(-0.3, Math.PI, 0);
  group.add(screen);
  for (const x of [-0.12, 0.12]) {
    const v = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.035, 0.01), trim);
    v.position.set(x, dashY + 0.035, 0.27);
    group.add(v);
  }

  // ---------- gear lever (H-pattern: 1 3 5 forward, 2 4 6 back; columns left to right) ----------
  const lever = new THREE.Group();
  lever.position.set(knob.x, knob.y - 0.22, knob.z);
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.01, 0.22, 6).translate(0, 0.11, 0), trim);
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.022, 12, 8), new THREE.MeshStandardMaterial({ color: accent, roughness: 0.4 }));
  ball.position.y = 0.23;
  const boot = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.07, 10), dark);
  boot.position.y = 0.02;
  lever.add(stick, ball, boot);
  group.add(lever);
  const gate = (gear) => {
    if (gear <= 0) return { x: 0.08, z: -0.05 }; // reverse: far right, back
    const col = Math.floor((gear - 1) / 2), fwd = (gear - 1) % 2 === 0;
    return { x: (col - 1) * 0.06, z: fwd ? 0.05 : -0.05 };
  };

  // ---------- driver ----------
  const suitMat = new THREE.MeshStandardMaterial({ color: suit, roughness: 0.8 });
  const glove = new THREE.MeshStandardMaterial({ color: 0xe6e0d4, roughness: 0.6 });
  const helmetMat = new THREE.MeshStandardMaterial({ color: 0xe8e8ec, roughness: 0.25, metalness: 0.2, envMap });
  const visor = new THREE.MeshStandardMaterial({ color: 0x0a0a10, roughness: 0.05, metalness: 0.8, envMap });
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.3, 4, 10), suitMat);
  torso.scale.set(1.15, 1, 0.75);
  torso.position.set(driverX, eye.y - 0.3, -0.76);
  torso.rotation.x = -0.22;
  const helmet = new THREE.Group();
  const shell = new THREE.Mesh(new THREE.SphereGeometry(0.13, 18, 14), helmetMat);
  shell.scale.set(0.95, 1.05, 1.1);
  const shield = new THREE.Mesh(new THREE.SphereGeometry(0.132, 18, 10, -Math.PI * 0.35, Math.PI * 0.7, Math.PI * 0.35, Math.PI * 0.22), visor);
  shield.scale.set(0.95, 1.05, 1.1);
  const stripe = new THREE.Mesh(new THREE.TorusGeometry(0.128, 0.012, 6, 24, Math.PI), new THREE.MeshStandardMaterial({ color: accent, roughness: 0.4 }));
  stripe.rotation.y = Math.PI / 2;
  helmet.add(shell, shield, stripe);
  helmet.position.set(driverX, eye.y + 0.03, eye.z - 0.06);
  group.add(torso, helmet);
  const armGeo = new THREE.CylinderGeometry(0.036, 0.044, 1, 8);
  const foreGeo = new THREE.CylinderGeometry(0.028, 0.036, 1, 8);
  const handGeo = new THREE.SphereGeometry(0.04, 10, 8);
  const arms = [-1, 1].map((s) => {
    const upper = new THREE.Mesh(armGeo, suitMat), fore = new THREE.Mesh(foreGeo, suitMat), hand = new THREE.Mesh(handGeo, glove);
    hand.scale.set(1, 0.8, 1.3);
    group.add(upper, fore, hand);
    return { s, upper, fore, hand, shoulder: new THREE.Vector3(driverX + s * 0.19, eye.y - 0.2, eye.z - 0.1) };
  });
  // The hand nearer the middle of the car does the shifting.
  const shiftSide = driverX > 0 ? -1 : 1;

  let lastGear = 1, shiftT = 1, fromGate = gate(1), toGate = gate(1);
  let tachA = 0, speedA = 0;
  const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), elbow = new THREE.Vector3(), knobW = new THREE.Vector3();
  const A0 = Math.PI * 0.75, SWEEP = Math.PI * 1.5;
  return {
    setFirstPerson(on) { helmet.visible = !on; torso.visible = !on; },
    update(car, dt) {
      const s = car.spec;
      const max = Math.ceil((s.redline + 600) / 1000);
      if (max !== tachMax) { tachMax = max; tachMat.map?.dispose(); tachMat.map = dialTexture('tach', max); tachMat.needsUpdate = true; }
      // Needles: quick but not instant, so they flick and bounce off the limiter like the real thing.
      const tachTarget = A0 + SWEEP * Math.min(1, car.rpm / (tachMax * 1000));
      tachA += (tachTarget - tachA) * Math.min(1, dt * 22);
      tachNeedle.rotation.z = -(tachA - Math.PI / 2) - Math.PI;
      const speedTarget = A0 + SWEEP * Math.min(1, (car.speed * 3.6) / 300);
      speedA += (speedTarget - speedA) * Math.min(1, dt * 10);
      speedNeedle.rotation.z = -(speedA - Math.PI / 2) - Math.PI;
      // Shift lights fill over the last 25% of the revs and flash on the limiter.
      const frac = (car.rpm - s.redline * 0.75) / (s.redline * 0.25);
      const flash = car.rpm > s.redline - 120 && Math.floor(performance.now() / 70) % 2 === 0;
      leds.forEach((m, k) => {
        const on = car.rpm > s.redline - 120 ? flash : frac > k / leds.length;
        m.material.color.copy(on ? m.userData.on : new THREE.Color(0x111111));
      });
      // Gear changes: the inner hand leaves the wheel, the lever moves across the gate, the hand comes back.
      if (car.gear !== lastGear) { fromGate = gate(lastGear); toGate = gate(car.gear); lastGear = car.gear; shiftT = 0; }
      shiftT = Math.min(1, shiftT + dt / 0.45);
      const leverMix = Math.min(1, Math.max(0, (shiftT - 0.2) / 0.3));
      const ease = leverMix * leverMix * (3 - 2 * leverMix);
      const gx = fromGate.x + (toGate.x - fromGate.x) * ease, gz = fromGate.z + (toGate.z - fromGate.z) * ease;
      lever.rotation.set(gz * 3.2, 0, -gx * 3.2);
      const reach = shiftT < 0.25 ? shiftT / 0.25 : shiftT < 0.6 ? 1 : 1 - (shiftT - 0.6) / 0.4;
      // Arms: shoulder to elbow to hand, with the elbow dropped and pushed out.
      wheel.updateMatrix();
      lever.updateMatrix();
      ball.updateMatrix();
      knobW.copy(ball.position).applyMatrix4(lever.matrix);
      for (const a of arms) {
        v1.set(a.s * wheelR, 0, 0.015).applyMatrix4(wheel.matrix); // grip at 9 and 3 o'clock, turning with the wheel
        if (a.s === shiftSide && reach > 0) v1.lerp(knobW, Math.min(1, reach));
        a.hand.position.copy(v1);
        a.hand.quaternion.copy(wheel.quaternion);
        elbow.copy(a.shoulder).lerp(v1, 0.5);
        elbow.y -= 0.12;
        elbow.x += a.s * 0.07;
        limb(a.upper, a.shoulder, elbow);
        limb(a.fore, elbow, v2.copy(v1));
      }
    },
  };
}
