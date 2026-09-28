import { CanvasTexture, MeshStandardMaterial, SRGBColorSpace } from "three/webgpu";

/** LA overhead guide signs: [route shields, destination lines, footer]. */
export const GUIDE_SIGNS: { shields: Shield[]; lines: string[]; footer?: string; exit?: string }[] = [
  { shields: [{ type: "interstate", number: "10" }], lines: ["WEST", "Santa Monica"], footer: "↓" },
  { shields: [{ type: "us", number: "101" }], lines: ["NORTH", "Hollywood"], exit: "EXIT 3A", footer: "↓  ↓" },
  { shields: [{ type: "interstate", number: "110" }], lines: ["SOUTH", "San Pedro"], footer: "↓" },
  { shields: [], lines: ["Downtown", "Los Angeles"], exit: "EXIT 22", footer: "1/2 MILE" },
  { shields: [{ type: "interstate", number: "5" }], lines: ["NORTH", "Sacramento"], footer: "↓  ↓" },
  { shields: [], lines: ["Wilshire Blvd", "Koreatown"], exit: "EXIT 9", footer: "1 MILE" },
  { shields: [{ type: "interstate", number: "405" }], lines: ["SOUTH", "LAX Airport"], footer: "↓" },
  { shields: [], lines: ["Sunset Blvd"], exit: "EXIT 4B", footer: "EXIT ONLY" },
];

export interface Shield {
  type: "interstate" | "us";
  number: string;
}

const FONT = `"Roboto Condensed", "Arial Narrow", "Helvetica Neue", Arial, sans-serif`;

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")!];
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}

function drawShield(g: CanvasRenderingContext2D, s: Shield, cx: number, cy: number, size: number): void {
  g.save();
  g.translate(cx, cy);
  if (s.type === "interstate") {
    const w = size;
    const h = size * 1.05;
    const shape = () => {
      g.beginPath();
      g.moveTo(-w / 2, -h / 2 + h * 0.06);
      g.quadraticCurveTo(-w / 4, -h / 2 - h * 0.05, 0, -h / 2 + h * 0.04);
      g.quadraticCurveTo(w / 4, -h / 2 - h * 0.05, w / 2, -h / 2 + h * 0.06);
      g.bezierCurveTo(w / 2 + w * 0.06, h * 0.1, w * 0.25, h * 0.38, 0, h / 2);
      g.bezierCurveTo(-w * 0.25, h * 0.38, -w / 2 - w * 0.06, h * 0.1, -w / 2, -h / 2 + h * 0.06);
      g.closePath();
    };
    shape();
    g.fillStyle = "#fff";
    g.fill();
    g.save();
    g.scale(0.9, 0.9);
    shape();
    g.clip();
    g.fillStyle = "#1a3f95";
    g.fillRect(-w, -h, w * 2, h * 2);
    g.fillStyle = "#c8102e";
    g.fillRect(-w, -h, w * 2, h * 0.72);
    g.fillStyle = "#fff";
    g.fillRect(-w, -h / 2 + h * 0.2, w * 2, h * 0.035);
    g.font = `bold ${h * 0.13}px ${FONT}`;
    g.textAlign = "center";
    g.fillText("INTERSTATE", 0, -h / 2 + h * 0.18);
    g.restore();
    g.fillStyle = "#fff";
    g.font = `bold ${h * (s.number.length > 2 ? 0.42 : 0.52)}px ${FONT}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(s.number, 0, h * 0.12);
  } else {
    const w = size * 0.95;
    const h = size;
    g.fillStyle = "#000";
    roundRect(g, -w / 2, -h / 2, w, h, 10);
    g.fill();
    g.beginPath();
    g.moveTo(-w * 0.42, -h * 0.44);
    g.lineTo(w * 0.42, -h * 0.44);
    g.bezierCurveTo(w * 0.46, -h * 0.1, w * 0.4, h * 0.25, 0, h * 0.44);
    g.bezierCurveTo(-w * 0.4, h * 0.25, -w * 0.46, -h * 0.1, -w * 0.42, -h * 0.44);
    g.closePath();
    g.fillStyle = "#fff";
    g.fill();
    g.fillStyle = "#000";
    g.font = `bold ${h * (s.number.length > 2 ? 0.42 : 0.5)}px ${FONT}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(s.number, 0, -h * 0.02);
  }
  g.restore();
}

function finish(c: HTMLCanvasElement, emissive = 0.28): MeshStandardMaterial {
  const map = new CanvasTexture(c);
  map.colorSpace = SRGBColorSpace;
  map.anisotropy = 8;
  return new MeshStandardMaterial({
    map, emissiveMap: map, emissive: 0xffffff, emissiveIntensity: emissive, roughness: 0.35, metalness: 0.1,
  });
}

/** Retroreflective green guide sign (2:1). */
export function guideSignMaterial(sign: (typeof GUIDE_SIGNS)[number]): MeshStandardMaterial {
  const [c, g] = canvas(1024, 512);
  g.fillStyle = "#006b3f";
  g.fillRect(0, 0, 1024, 512);
  // Subtle panel seams and grime, as on real aluminium panels.
  for (let x = 256; x < 1024; x += 256) {
    g.fillStyle = "rgba(0,0,0,0.12)";
    g.fillRect(x - 1, 0, 2, 512);
  }
  const grime = g.createLinearGradient(0, 0, 0, 512);
  grime.addColorStop(0, "rgba(255,255,255,0.05)");
  grime.addColorStop(1, "rgba(0,0,0,0.18)");
  g.fillStyle = grime;
  g.fillRect(0, 0, 1024, 512);
  g.strokeStyle = "#f4f4f0";
  g.lineWidth = 10;
  roundRect(g, 14, 14, 996, 484, 26);
  g.stroke();

  let textX = 512;
  if (sign.shields.length) {
    sign.shields.forEach((s, i) => drawShield(g, s, 170 + i * 190, 210, 190));
    textX = 640;
  }
  g.fillStyle = "#f4f4f0";
  g.textAlign = "center";
  g.textBaseline = "middle";
  sign.lines.forEach((line, i) => {
    const size = line === line.toUpperCase() && line.length < 7 ? 78 : 92;
    g.font = `bold ${size}px ${FONT}`;
    g.fillText(line, textX, 150 + i * 118, sign.shields.length ? 700 : 940);
  });
  if (sign.footer) {
    g.font = `bold 84px ${FONT}`;
    g.fillText(sign.footer, 512, 430);
  }
  if (sign.exit) {
    g.fillStyle = "#006b3f";
    g.strokeStyle = "#f4f4f0";
    g.lineWidth = 8;
    roundRect(g, 690, -20, 320, 96, 16);
    g.fill();
    g.stroke();
    g.fillStyle = "#f4f4f0";
    g.font = `bold 58px ${FONT}`;
    g.fillText(sign.exit, 850, 38);
  }
  return finish(c);
}

export function speedLimitMaterial(): MeshStandardMaterial {
  const [c, g] = canvas(256, 320);
  g.fillStyle = "#f2f2ee";
  g.fillRect(0, 0, 256, 320);
  g.strokeStyle = "#111";
  g.lineWidth = 8;
  roundRect(g, 10, 10, 236, 300, 16);
  g.stroke();
  g.fillStyle = "#111";
  g.textAlign = "center";
  g.font = `bold 48px ${FONT}`;
  g.fillText("SPEED", 128, 72);
  g.fillText("LIMIT", 128, 124);
  g.font = `bold 138px ${FONT}`;
  g.fillText("65", 128, 268);
  return finish(c, 0.18);
}

export function exitGoreMaterial(): MeshStandardMaterial {
  const [c, g] = canvas(512, 256);
  g.fillStyle = "#006b3f";
  g.fillRect(0, 0, 512, 256);
  g.strokeStyle = "#f4f4f0";
  g.lineWidth = 8;
  roundRect(g, 10, 10, 492, 236, 16);
  g.stroke();
  g.fillStyle = "#f4f4f0";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.font = `bold 96px ${FONT}`;
  g.fillText("EXIT", 256, 90);
  g.beginPath();
  g.moveTo(180, 150);
  g.lineTo(330, 150);
  g.lineTo(330, 120);
  g.lineTo(400, 180);
  g.lineTo(330, 240);
  g.lineTo(330, 210);
  g.lineTo(180, 210);
  g.closePath();
  g.fill();
  return finish(c);
}
