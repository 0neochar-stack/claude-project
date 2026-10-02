// Procedural texture atlases for signs, ads and street furniture. Everything is drawn on canvases at startup
// (and redrawn once the web fonts load), so there are no image files. Brands are invented.
import * as THREE from 'three';

const DISPLAY = '"Chakra Petch", "Arial Narrow", "Helvetica Neue", Arial, sans-serif';
const JP = '"Hiragino Sans", "Noto Sans JP", "Yu Gothic", "Meiryo", sans-serif';
const NEONS = ['#ff3fd0', '#35eaff', '#ffb040', '#b07bff', '#44ffae', '#ff4d6d', '#fff36b', '#6fa8ff'];

// First-fit packer over a grid of cells.
function packer(cols, rows) {
  const used = new Uint8Array(cols * rows);
  return (w, h) => {
    for (let y = 0; y <= rows - h; y++) {
      for (let x = 0; x <= cols - w; x++) {
        let free = true;
        for (let j = 0; j < h && free; j++) for (let i = 0; i < w && free; i++) if (used[(y + j) * cols + x + i]) free = false;
        if (!free) continue;
        for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) used[(y + j) * cols + x + i] = 1;
        return [x, y];
      }
    }
    throw new Error('atlas full');
  };
}

class Atlas {
  constructor(width, height, cell) {
    this.cv = document.createElement('canvas');
    this.cv.width = width;
    this.cv.height = height;
    this.g = this.cv.getContext('2d');
    this.cell = cell;
    this.place = packer(width / cell, height / cell);
    this.items = new Map();
    this.draws = [];
    this.tex = new THREE.CanvasTexture(this.cv);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 8;
  }

  // Reserve w x h cells for `name` and remember how to draw it.
  add(name, w, h, draw) {
    const [x, y] = this.place(w, h);
    const c = this.cell, W = this.cv.width, H = this.cv.height;
    const rect = { x: x * c, y: y * c, w: w * c, h: h * c };
    // Inset half a texel so mipmaps do not bleed the neighbours in.
    this.items.set(name, [(rect.x + 2) / W, 1 - (rect.y + rect.h - 2) / H, (rect.x + rect.w - 2) / W, 1 - (rect.y + 2) / H]);
    this.draws.push([rect, draw]);
    return name;
  }

  uv(name) {
    return this.items.get(name);
  }

  paint() {
    const g = this.g;
    g.clearRect(0, 0, this.cv.width, this.cv.height);
    for (const [r, draw] of this.draws) {
      g.save();
      g.beginPath();
      g.rect(r.x, r.y, r.w, r.h);
      g.clip();
      g.translate(r.x, r.y);
      draw(g, r.w, r.h);
      g.restore();
    }
    this.tex.needsUpdate = true;
  }
}

// ---------- drawing helpers ----------
function glowText(g, text, x, y, color, size, font = DISPLAY, weight = 800, core = 0.6) {
  g.font = `${weight} ${size}px ${font}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = color;
  g.shadowBlur = size * 0.4;
  g.fillStyle = color;
  g.fillText(text, x, y);
  g.shadowBlur = size * 0.15;
  g.fillText(text, x, y);
  g.shadowBlur = 0;
  g.fillStyle = '#fff';
  g.globalAlpha = core;
  g.fillText(text, x, y);
  g.globalAlpha = 1;
}
function fitText(g, text, maxW, size, font = DISPLAY, weight = 800) {
  g.font = `${weight} ${size}px ${font}`;
  const w = g.measureText(text).width;
  return w > maxW ? Math.floor((size * maxW) / w) : size;
}
function neonFrame(g, w, h, color, inset = 10, lw = 6, radius = 10) {
  g.fillStyle = '#08050f';
  g.fillRect(0, 0, w, h);
  g.strokeStyle = color;
  g.lineWidth = lw;
  g.shadowColor = color;
  g.shadowBlur = 16;
  g.beginPath();
  g.roundRect(inset, inset, w - inset * 2, h - inset * 2, radius);
  g.stroke();
  g.shadowBlur = 0;
}
function lightbox(g, w, h, bg, edge) {
  const grd = g.createLinearGradient(0, 0, 0, h);
  grd.addColorStop(0, bg);
  grd.addColorStop(1, shade(bg, -0.18));
  g.fillStyle = grd;
  g.fillRect(0, 0, w, h);
  g.strokeStyle = edge;
  g.lineWidth = 8;
  g.strokeRect(4, 4, w - 8, h - 8);
}
function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.max(0, Math.min(255, Math.round(v + (k > 0 ? (255 - v) * k : v * k))));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}
const rngFrom = (seed) => {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
};

// ---------- the glowing atlas: signs, posters, billboards ----------
export const VERTICAL = ['ドリフト', 'ラーメン', '居酒屋', 'カラオケ', '電脳街', 'ホテル', '寿司', '焼肉', '薬局', '雀荘', '喫茶', '雨夜'];
export const HORIZONTAL = ['DRIFT', 'RAMEN 24H', 'KARAOKE', 'ARCADE', 'TUNE SHOP', 'NOODLES', 'PACHI-PARA', 'BAR KITSUNE', 'CAFE 2077', 'SUSHI', 'GAME CENTER', 'PHARMACY', 'IZAKAYA', 'CYBER CAFE', 'JAZZ BAR', 'KOMBINI'];
export const BOXES = ['bowl', 'cocktail', 'arrow', '24', '¥', '酒', '湯', '食'];
export const POSTERS = [
  ['NEO COLA', 'Taste the static', '#ff2e63', '#2a0010', 'can'],
  ['KAIJU', 'ENERGY · 500% MORE ROAR', '#7dff3a', '#062005', 'bolt'],
  ['HIKARI 9G', 'Faster than thought', '#35eaff', '#021624', 'waves'],
  ['ZEN AIR', 'Breathe premium', '#b8f3ff', '#0b1a2e', 'circle'],
  ['OKAMI', 'RAMEN · since 2041', '#ffb040', '#2a1200', 'bowl'],
  ['DRIFT CUP', 'NEO-SHINJUKU · NIGHT 3', '#ff3fd0', '#1a0322', 'chevrons'],
  ['SAKURA', 'BANK · your yen, safer', '#ff9ecb', '#26101c', 'flower'],
  ['MECHA', 'NOODLE · robot made', '#fff36b', '#1f1a02', 'gear'],
];
export const BILLBOARDS = [
  ['HIKARI 9G', 'NOW IN EVERY DISTRICT', '#35eaff', '#08203a', '#ff3fd0'],
  ['NEO COLA ZERO', 'ZERO SUGAR · ALL STATIC', '#ff2e63', '#1d0010', '#ffd166'],
  ['DRIFT CUP 2077', 'FINAL TONIGHT · PLAZA LOT', '#ff3fd0', '#12051e', '#35eaff'],
  ['KAIJU ENERGY', 'UNLEASH THE BEAST WITHIN', '#7dff3a', '#041604', '#fff36b'],
  ['OKAMI RAMEN', 'OPEN 24H · 3 MIN FROM HERE', '#ffb040', '#1f0d00', '#ff4d6d'],
  ['SYNTH-AI', 'YOUR NEW BEST FRIEND?', '#b07bff', '#10061f', '#35eaff'],
];

function drawIcon(g, kind, cx, cy, s, color) {
  g.strokeStyle = color;
  g.fillStyle = color;
  g.lineWidth = s * 0.07;
  g.lineCap = 'round';
  g.shadowColor = color;
  g.shadowBlur = s * 0.2;
  g.beginPath();
  if (kind === 'bowl') {
    g.arc(cx, cy - s * 0.05, s * 0.38, 0, Math.PI);
    g.closePath();
    g.stroke();
    for (const k of [-0.15, 0, 0.15]) { g.moveTo(cx + k * s, cy - s * 0.2); g.quadraticCurveTo(cx + k * s + s * 0.08, cy - s * 0.35, cx + k * s, cy - s * 0.48); }
    g.stroke();
    g.beginPath(); g.moveTo(cx - s * 0.3, cy - s * 0.45); g.lineTo(cx + s * 0.38, cy - s * 0.2); g.stroke();
  } else if (kind === 'cocktail') {
    g.moveTo(cx - s * 0.32, cy - s * 0.35); g.lineTo(cx + s * 0.32, cy - s * 0.35); g.lineTo(cx, cy + s * 0.05); g.closePath(); g.stroke();
    g.beginPath(); g.moveTo(cx, cy + s * 0.05); g.lineTo(cx, cy + s * 0.35); g.moveTo(cx - s * 0.18, cy + s * 0.37); g.lineTo(cx + s * 0.18, cy + s * 0.37); g.stroke();
    g.beginPath(); g.arc(cx + s * 0.18, cy - s * 0.42, s * 0.08, 0, Math.PI * 2); g.fill();
  } else if (kind === 'arrow') {
    g.moveTo(cx - s * 0.35, cy); g.lineTo(cx + s * 0.3, cy); g.moveTo(cx + s * 0.1, cy - s * 0.22); g.lineTo(cx + s * 0.35, cy); g.lineTo(cx + s * 0.1, cy + s * 0.22); g.stroke();
  } else if (kind === 'can') {
    g.roundRect(cx - s * 0.18, cy - s * 0.38, s * 0.36, s * 0.76, s * 0.06); g.stroke();
    g.beginPath(); g.moveTo(cx - s * 0.18, cy - s * 0.1); g.lineTo(cx + s * 0.18, cy + s * 0.05); g.stroke();
  } else if (kind === 'bolt') {
    g.moveTo(cx + s * 0.08, cy - s * 0.42); g.lineTo(cx - s * 0.2, cy + s * 0.05); g.lineTo(cx, cy + s * 0.05); g.lineTo(cx - s * 0.08, cy + s * 0.42); g.lineTo(cx + s * 0.22, cy - s * 0.08); g.lineTo(cx + s * 0.02, cy - s * 0.08); g.closePath(); g.fill();
  } else if (kind === 'waves') {
    for (const r of [0.15, 0.28, 0.41]) { g.beginPath(); g.arc(cx - s * 0.2, cy + s * 0.2, r * s, -Math.PI / 2, 0); g.stroke(); }
  } else if (kind === 'circle') {
    g.arc(cx, cy, s * 0.36, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.arc(cx, cy, s * 0.2, 0.4, Math.PI * 1.6); g.stroke();
  } else if (kind === 'chevrons') {
    for (const k of [-0.25, 0, 0.25]) { g.moveTo(cx + k * s - s * 0.1, cy - s * 0.3); g.lineTo(cx + k * s + s * 0.12, cy); g.lineTo(cx + k * s - s * 0.1, cy + s * 0.3); }
    g.stroke();
  } else if (kind === 'flower') {
    for (let k = 0; k < 5; k++) { const a = (k / 5) * Math.PI * 2 - Math.PI / 2; g.beginPath(); g.ellipse(cx + Math.cos(a) * s * 0.18, cy + Math.sin(a) * s * 0.18, s * 0.14, s * 0.09, a, 0, Math.PI * 2); g.fill(); }
  } else if (kind === 'gear') {
    for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; g.moveTo(cx + Math.cos(a) * s * 0.26, cy + Math.sin(a) * s * 0.26); g.lineTo(cx + Math.cos(a) * s * 0.4, cy + Math.sin(a) * s * 0.4); }
    g.stroke(); g.beginPath(); g.arc(cx, cy, s * 0.26, 0, Math.PI * 2); g.stroke();
  } else {
    g.shadowBlur = 0;
    glowText(g, kind, cx, cy, color, s * (kind.length > 1 ? 0.5 : 0.7), kind.length === 1 && kind !== '¥' ? JP : DISPLAY);
  }
  g.shadowBlur = 0;
}

export function buildGlowAtlas() {
  const A = new Atlas(2048, 2048, 128);
  VERTICAL.forEach((word, i) => {
    const color = NEONS[i % NEONS.length];
    A.add(`v${i}`, 1, 4, (g, w, h) => {
      // Three styles: neon tube on black, white lightbox with coloured characters, and a coloured lightbox.
      const style = i % 3;
      if (style === 0) neonFrame(g, w, h, color);
      else if (style === 1) lightbox(g, w, h, '#f4f1ea', color);
      else lightbox(g, w, h, color, '#ffffff');
      const chars = [...word];
      const step = Math.min(96, (h - 70) / chars.length);
      chars.forEach((ch, k) => {
        const y = h / 2 + (k - (chars.length - 1) / 2) * step;
        if (style === 0) glowText(g, ch, w / 2, y, color, Math.min(84, step * 0.9), JP);
        else {
          g.font = `900 ${Math.min(84, step * 0.88)}px ${JP}`;
          g.textAlign = 'center'; g.textBaseline = 'middle';
          g.fillStyle = style === 1 ? color : '#ffffff';
          g.fillText(ch, w / 2, y);
        }
      });
    });
  });
  HORIZONTAL.forEach((word, i) => {
    const color = NEONS[(i + 3) % NEONS.length];
    A.add(`h${i}`, 4, 1, (g, w, h) => {
      const style = i % 4;
      if (style === 0 || style === 3) {
        neonFrame(g, w, h, color, 10, 5, 22);
        const size = fitText(g, word, w - 70, 76);
        glowText(g, word, w / 2, h / 2 + 4, color, size);
        if (style === 3) { g.strokeStyle = NEONS[(i + 5) % 8]; g.lineWidth = 3; g.shadowColor = g.strokeStyle; g.shadowBlur = 10; g.beginPath(); g.moveTo(40, h - 26); g.lineTo(w - 40, h - 26); g.stroke(); g.shadowBlur = 0; }
      } else if (style === 1) {
        lightbox(g, w, h, '#101018', color);
        const size = fitText(g, word, w - 70, 72, DISPLAY, 900);
        g.font = `italic 900 ${size}px ${DISPLAY}`;
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillStyle = color;
        g.fillText(word, w / 2, h / 2 + 3);
      } else {
        lightbox(g, w, h, color, '#ffffff');
        const size = fitText(g, word, w - 70, 72, DISPLAY, 900);
        g.font = `900 ${size}px ${DISPLAY}`;
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillStyle = '#0b0710';
        g.fillText(word, w / 2, h / 2 + 3);
      }
    });
  });
  BOXES.forEach((kind, i) => {
    const color = NEONS[(i * 3 + 1) % NEONS.length];
    A.add(`b${i}`, 2, 2, (g, w, h) => {
      neonFrame(g, w, h, color, 14, 6, w / 2 - 14);
      drawIcon(g, kind, w / 2, h / 2, w * 0.7, color);
    });
  });
  POSTERS.forEach(([title, line, color, bg, icon], i) => {
    A.add(`p${i}`, 2, 3, (g, w, h) => {
      const grd = g.createLinearGradient(0, 0, w, h);
      grd.addColorStop(0, bg);
      grd.addColorStop(1, shade(color, -0.55));
      g.fillStyle = grd;
      g.fillRect(0, 0, w, h);
      // Halftone dots and a big icon behind the type.
      const r = rngFrom(i + 11);
      g.fillStyle = color;
      for (let k = 0; k < 140; k++) { g.globalAlpha = 0.08 + r() * 0.12; g.beginPath(); g.arc(r() * w, r() * h, 1 + r() * 3, 0, Math.PI * 2); g.fill(); }
      g.globalAlpha = 1;
      drawIcon(g, icon, w / 2, h * 0.38, w * 0.8, color);
      const size = fitText(g, title, w - 30, 54, DISPLAY, 900);
      g.font = `italic 900 ${size}px ${DISPLAY}`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = '#ffffff';
      g.fillText(title, w / 2, h * 0.75);
      g.font = `600 ${fitText(g, line, w - 30, 17, DISPLAY, 600)}px ${DISPLAY}`;
      g.fillStyle = color;
      g.fillText(line, w / 2, h * 0.84);
      g.fillStyle = color;
      g.fillRect(16, h - 22, w - 32, 6);
    });
  });
  BILLBOARDS.forEach(([title, line, color, bg, accent], i) => {
    A.add(`bb${i}`, 4, 2, (g, w, h) => {
      const grd = g.createLinearGradient(0, 0, w, 0);
      grd.addColorStop(0, bg);
      grd.addColorStop(1, shade(color, -0.6));
      g.fillStyle = grd;
      g.fillRect(0, 0, w, h);
      g.strokeStyle = accent;
      g.globalAlpha = 0.5;
      g.lineWidth = 3;
      for (let k = -h; k < w; k += 26) { g.beginPath(); g.moveTo(k, h); g.lineTo(k + h, 0); g.stroke(); }
      g.globalAlpha = 1;
      g.fillStyle = 'rgba(0,0,0,0.45)';
      g.fillRect(0, h * 0.18, w, h * 0.62);
      const size = fitText(g, title, w - 60, 80, DISPLAY, 900);
      g.font = `italic 900 ${size}px ${DISPLAY}`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.shadowColor = color; g.shadowBlur = 18;
      g.fillStyle = color;
      g.fillText(title, w / 2, h * 0.43);
      g.shadowBlur = 0;
      g.font = `700 ${fitText(g, line, w - 80, 26, DISPLAY, 700)}px ${DISPLAY}`;
      g.fillStyle = '#ffffff';
      g.fillText(line, w / 2, h * 0.68);
      g.fillStyle = accent;
      g.fillRect(0, h - 14, w, 14);
    });
  });
  // A wide strip for the scrolling LED screens: one tile of a ticker that repeats.
  A.add('ticker', 8, 1, (g, w, h) => {
    g.fillStyle = '#05030a';
    g.fillRect(0, 0, w, h);
    const words = ['DRIFT CUP 2077 FINAL TONIGHT', '雨 RAIN 92%', 'NEO COLA ZERO', 'HIKARI 9G', '¥ 1,284.20 ▲', 'OKAMI RAMEN 24H'];
    let x = 20;
    words.forEach((t, k) => {
      const color = NEONS[(k * 2) % NEONS.length];
      g.font = `800 64px ${DISPLAY}`;
      const tw = g.measureText(t).width;
      glowText(g, t, x + tw / 2, h / 2 + 4, color, 64);
      x += tw + 60;
    });
    // LED pixel grid.
    g.fillStyle = 'rgba(0,0,0,0.35)';
    for (let y = 0; y < h; y += 4) g.fillRect(0, y, w, 1);
    for (let xx = 0; xx < w; xx += 4) g.fillRect(xx, 0, 1, h);
  });
  A.paint();
  document.fonts?.ready?.then(() => A.paint());
  return A;
}

// ---------- the lit atlas: street signage and surfaces lit by the scene ----------
export function buildPropAtlas() {
  const A = new Atlas(2048, 1024, 128);
  const roundSign = (name, draw) => A.add(name, 1, 1, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    draw(g, w, h);
  });
  roundSign('speed', (g, w) => {
    g.fillStyle = '#d8262e'; g.beginPath(); g.arc(w / 2, w / 2, w / 2 - 4, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ffffff'; g.beginPath(); g.arc(w / 2, w / 2, w / 2 - 18, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#1b3b8f'; g.font = `800 54px ${DISPLAY}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('40', w / 2, w / 2 + 2);
  });
  roundSign('noparking', (g, w) => {
    g.fillStyle = '#d8262e'; g.beginPath(); g.arc(w / 2, w / 2, w / 2 - 4, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#1f58c9'; g.beginPath(); g.arc(w / 2, w / 2, w / 2 - 16, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#d8262e'; g.lineWidth = 12; g.beginPath(); g.moveTo(26, 26); g.lineTo(w - 26, w - 26); g.stroke();
  });
  roundSign('crossing', (g, w) => {
    g.fillStyle = '#1f58c9'; g.fillRect(6, 6, w - 12, w - 12);
    g.fillStyle = '#ffffff'; g.beginPath(); g.moveTo(w / 2, 18); g.lineTo(w - 18, w - 22); g.lineTo(18, w - 22); g.closePath(); g.fill();
    g.fillStyle = '#111'; g.beginPath(); g.arc(w / 2 + 4, 48, 7, 0, Math.PI * 2); g.fill();
    g.lineWidth = 6; g.strokeStyle = '#111'; g.beginPath(); g.moveTo(w / 2 + 2, 56); g.lineTo(w / 2 - 6, 80); g.lineTo(w / 2 - 16, 96); g.moveTo(w / 2 - 6, 80); g.lineTo(w / 2 + 8, 96); g.stroke();
  });
  roundSign('stop', (g, w) => {
    g.fillStyle = '#d8262e'; g.beginPath(); g.moveTo(8, 14); g.lineTo(w - 8, 14); g.lineTo(w / 2, w - 8); g.closePath(); g.fill();
    g.fillStyle = '#fff'; g.font = `900 30px ${JP}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('止まれ', w / 2, 46);
  });
  roundSign('bus', (g, w) => {
    g.fillStyle = '#0b6e4f'; g.beginPath(); g.arc(w / 2, w / 2, w / 2 - 4, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff'; g.font = `800 34px ${DISPLAY}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('BUS', w / 2, w / 2 - 14);
    g.font = `700 22px ${DISPLAY}`; g.fillText('N-07', w / 2, w / 2 + 22);
  });
  roundSign('mirror', (g, w) => {
    const grd = g.createRadialGradient(w * 0.4, w * 0.4, 4, w / 2, w / 2, w / 2);
    grd.addColorStop(0, '#e9eef8'); grd.addColorStop(0.6, '#6a7894'); grd.addColorStop(1, '#2a3040');
    g.fillStyle = '#f06a1a'; g.beginPath(); g.arc(w / 2, w / 2, w / 2 - 2, 0, Math.PI * 2); g.fill();
    g.fillStyle = grd; g.beginPath(); g.arc(w / 2, w / 2, w / 2 - 12, 0, Math.PI * 2); g.fill();
  });
  roundSign('lantern', (g, w, h) => {
    const grd = g.createRadialGradient(w / 2, h / 2, 4, w / 2, h / 2, w * 0.6);
    grd.addColorStop(0, '#ffd27a'); grd.addColorStop(1, '#d4231d');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(80,0,0,0.5)'; g.lineWidth = 2;
    for (let y = 8; y < h; y += 11) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    g.fillStyle = '#1a0606'; g.font = `900 64px ${JP}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('祭', w / 2, h / 2 + 4);
  });
  roundSign('drain', (g, w, h) => {
    g.fillStyle = '#1b1a20'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#050508'; for (let x = 10; x < w - 6; x += 14) g.fillRect(x, 10, 7, h - 20);
  });
  ['CHUO-DORI', 'SAKURA-DORI', 'KASUMI ST', 'NEON ALLEY'].forEach((name, i) => A.add(`street${i}`, 2, 1, (g, w, h) => {
    g.fillStyle = '#1f58c9'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#fff'; g.lineWidth = 4; g.strokeRect(6, 6, w - 12, h - 12);
    g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `800 ${fitText(g, name, w - 40, 38)}px ${DISPLAY}`; g.fillText(name, w / 2, h * 0.38);
    g.font = `700 26px ${JP}`; g.fillText(['中央通り', '桜通り', '霞通り', 'ネオン横丁'][i], w / 2, h * 0.74);
  }));
  [['← SHINJUKU 3', '↑ PORT 12', 'AIRPORT 28 →'], ['← HARBOR 6', '↑ DOWNTOWN 2', 'RING RD →']].forEach((lines, i) => A.add(`gantry${i}`, 6, 2, (g, w, h) => {
    g.fillStyle = '#0d4d9c'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#ffffff'; g.lineWidth = 6; g.strokeRect(10, 10, w - 20, h - 20);
    g.fillStyle = '#fff'; g.textBaseline = 'middle'; g.textAlign = 'left';
    g.font = `800 52px ${DISPLAY}`;
    lines.forEach((t, k) => g.fillText(t, 40, 52 + k * 76));
  }));
  A.add('timetable', 1, 2, (g, w, h) => {
    g.fillStyle = '#f2f2ec'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#0b6e4f'; g.fillRect(0, 0, w, 34);
    g.fillStyle = '#fff'; g.font = `800 20px ${DISPLAY}`; g.textAlign = 'center'; g.fillText('N-07  NIGHT', w / 2, 24);
    g.fillStyle = '#222'; g.font = `600 14px ${DISPLAY}`; g.textAlign = 'left';
    for (let k = 0; k < 12; k++) g.fillText(`${(22 + Math.floor(k / 4)) % 24}:${String((k % 4) * 15 + 4).padStart(2, '0')}   ${['HARBOR', 'PORT', 'RING'][k % 3]}`, 12, 56 + k * 16);
  });
  [['#c8102e', '#ffffff'], ['#1f58c9', '#ffffff'], ['#f2f2ec', '#c8102e']].forEach(([bg, fg], i) => A.add(`vend${i}`, 2, 3, (g, w, h) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    // Three shelves of drinks behind glass, prices under each.
    const r = rngFrom(i + 4);
    g.fillStyle = '#0b0d14'; g.fillRect(14, 14, w - 28, h * 0.62);
    for (let row = 0; row < 3; row++) {
      for (let k = 0; k < 6; k++) {
        const x = 24 + k * ((w - 48) / 6), y = 24 + row * (h * 0.2);
        g.fillStyle = ['#ff4d6d', '#35eaff', '#ffb040', '#7dff3a', '#ffffff', '#b07bff'][Math.floor(r() * 6)];
        g.fillRect(x + 4, y + 8, (w - 48) / 6 - 10, h * 0.13);
        g.fillStyle = '#e8e8e8'; g.font = `600 10px ${DISPLAY}`; g.textAlign = 'center';
        g.fillText(`¥${[120, 150, 160, 180][Math.floor(r() * 4)]}`, x + (w - 48) / 12, y + h * 0.17);
      }
    }
    g.fillStyle = fg; g.font = `italic 900 30px ${DISPLAY}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(['NEO COLA', 'HIKARI', 'KAIJU'][i], w / 2, h * 0.73);
    g.fillStyle = '#111'; g.fillRect(w * 0.62, h * 0.82, w * 0.25, h * 0.1);
    g.fillStyle = '#333'; g.fillRect(w * 0.12, h * 0.86, w * 0.36, h * 0.06);
  }));
  ['本日のおすすめ', 'HAPPY HOUR'].forEach((title, i) => A.add(`menu${i}`, 1, 2, (g, w, h) => {
    g.fillStyle = '#1d2621'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#7a5a36'; g.lineWidth = 10; g.strokeRect(0, 0, w, h);
    g.fillStyle = '#f1ede0'; g.textAlign = 'center';
    g.font = `700 ${i ? 18 : 16}px ${i ? DISPLAY : JP}`; g.fillText(title, w / 2, 34);
    g.font = `500 13px ${DISPLAY}`;
    ['RAMEN ¥980', 'GYOZA ¥450', 'BEER ¥600', 'HIGHBALL ¥500', 'EDAMAME ¥300'].forEach((t, k) => g.fillText(t, w / 2, 70 + k * 30));
  }));
  A.add('noren', 2, 1, (g, w, h) => {
    g.fillStyle = '#1b2b4f'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#0a0a12'; for (let x = w / 4; x < w; x += w / 4) g.fillRect(x - 2, h * 0.35, 4, h);
    g.fillStyle = '#f4efe2'; g.font = `900 52px ${JP}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('らーめん', w / 2, h * 0.45);
  });
  for (let i = 0; i < 2; i++) A.add(`shutter${i}`, 2, 2, (g, w, h) => {
    g.fillStyle = '#8b8d94'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 8) { g.fillStyle = y % 16 ? '#9a9ca3' : '#74767d'; g.fillRect(0, y, w, 4); }
    // Graffiti tags.
    const r = rngFrom(31 + i);
    g.lineCap = 'round';
    for (let k = 0; k < 3; k++) {
      g.strokeStyle = NEONS[Math.floor(r() * NEONS.length)]; g.lineWidth = 6 + r() * 6;
      g.beginPath(); let x = 20 + r() * 60, y = 60 + r() * 130; g.moveTo(x, y);
      for (let s = 0; s < 7; s++) { x += 20 + r() * 20; y += (r() - 0.5) * 60; g.lineTo(x, y); }
      g.stroke();
    }
    g.fillStyle = '#fff'; g.font = `italic 900 36px ${DISPLAY}`; g.textAlign = 'center'; g.fillText(['RONIN', 'KAZE!'][i], w / 2, h * 0.82);
  });
  A.add('hoarding', 8, 1, (g, w, h) => {
    g.fillStyle = '#e8c21a'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#121212';
    for (let x = -h; x < w; x += 60) { g.beginPath(); g.moveTo(x, h); g.lineTo(x + 30, h); g.lineTo(x + 30 + h * 0.3, h * 0.7); g.lineTo(x + h * 0.3, h * 0.7); g.fill(); }
    g.fillStyle = '#f4f4f0'; g.fillRect(0, 0, w, h * 0.66);
    const t = 'SAFETY FIRST · NEO-SHINJUKU TOWER III · 2078';
    g.fillStyle = '#121212'; g.font = `800 ${fitText(g, t, w - 60, 46)}px ${DISPLAY}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(t, w / 2, h * 0.34);
  });
  A.add('helipad', 2, 2, (g, w, h) => {
    g.fillStyle = '#2b2b33'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#f3f3f3'; g.lineWidth = 10; g.beginPath(); g.arc(w / 2, h / 2, w / 2 - 14, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#f3f3f3'; g.font = `900 140px ${DISPLAY}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('H', w / 2, h / 2 + 6);
  });
  A.add('cabinet', 1, 2, (g, w, h) => {
    g.fillStyle = '#9ea3a8'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#6b7075'; g.lineWidth = 3; g.strokeRect(8, 8, w - 16, h - 16);
    g.fillStyle = '#ffd400'; g.beginPath(); g.moveTo(w / 2, 40); g.lineTo(w / 2 + 22, 80); g.lineTo(w / 2 - 22, 80); g.closePath(); g.fill();
    g.fillStyle = '#111'; g.font = `900 26px ${DISPLAY}`; g.textAlign = 'center'; g.fillText('!', w / 2, 76);
    const r = rngFrom(77);
    for (let k = 0; k < 4; k++) { g.fillStyle = NEONS[Math.floor(r() * 8)]; g.fillRect(14 + r() * 70, 110 + r() * 120, 30, 20); }
  });
  A.paint();
  document.fonts?.ready?.then(() => A.paint());
  return A;
}
