/**
 * HYDRO HOLO — GLSL ES 3.00 shader sources.
 *
 * The core is fully analytic: a stack of concentric arc bands plus a signed
 * distance field head with topographic contour lines and a dot lattice. Nothing
 * is raymarched, so the per-pixel cost is a handful of `length()` calls and the
 * output stays crisp at any resolution — which is what keeps the frame budget
 * free for the rest of the interface.
 */

export const FULLSCREEN_VS = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

export const CORE_FS = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform vec2  uRes;
uniform float uTime;
uniform vec2  uPointer;
uniform float uAmp;
uniform float uHue;
uniform float uRing;
uniform float uAudio;

/* camera-derived signals (all zero when the camera is off) */
uniform vec2  uGaze;      /* −1…1 attention target in screen space */
uniform float uAttention; /* 0…1 how confident the face tracking is */
uniform float uBlink;     /* 0 eyes open … 1 eyes closed */
uniform float uMouth;     /* 0 jaw closed … 1 jaw open */
uniform float uPresence;  /* 0 nobody … 1 a person is detected */
uniform float uScan;      /* 0…1 observation sweep, only while analysing a frame */
uniform float uEnergy;    /* 0…1 recent interface activity, e.g. the user typing */

/* Expressive rig, written every frame by the interaction controller.
   Channels are FACS-inspired action-unit weights, all clamped 0…1. */
uniform vec4 uFace;      /* browRaise (AU1/2), browLower (AU4), lidWide (AU5), squint (AU6/7) */
uniform vec4 uMouthTone; /* smile (AU12), frown (AU15), noseWrinkle (AU9), mouthPress (AU24) */
uniform vec4 uMouthForm; /* lipStretch (AU20), pucker (AU18), teeth, cheek (AU6) */
uniform vec4 uPosture;   /* head pitch (nod), head roll (tilt), lateral sway, breath */

const vec3 GOLD  = vec3(1.000, 0.812, 0.372);
const vec3 GOLD2 = vec3(1.000, 0.604, 0.176);
const vec3 HOT   = vec3(1.000, 0.392, 0.140);
const vec3 WHITE = vec3(1.000, 0.962, 0.880);

/* ── primitives ─────────────────────────────────────────────────────────── */

float thinLine(float d, float w) { return exp(-abs(d) / max(w, 1e-5)); }

/* arc band: count sectors, lit for duty of each sector, rotating by phase */
float arcMask(float a01, float count, float duty, float phase, float soft) {
  float f = fract(a01 * count + phase);
  return smoothstep(0.0, soft, f) * (1.0 - smoothstep(duty - soft, duty, f));
}

float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

/* ── head silhouette ────────────────────────────────────────────────────── */

/* Cranium ellipse, tapered jaw and small chin cap, smooth-unioned into one
   field. Local units: y = +0.260 crown, -0.280 chin, half width ~0.212. */
float sdHead(vec2 p) {
  vec2 c = (p - vec2(0.0, 0.082)) / vec2(0.204, 0.178);
  float cranium = (length(c) - 1.0) * 0.178;

  float jt = clamp((p.y + 0.195) / 0.280, 0.0, 1.0);
  float jw = 0.072 + 0.118 * pow(jt, 0.55);
  float jaw = max(abs(p.x) - jw, max(p.y - 0.085, -0.195 - p.y));

  /* a small cap that rounds the chin without widening the jaw line */
  vec2 q = (p - vec2(0.0, -0.198)) / vec2(0.066, 0.048);
  float chin = (length(q) - 1.0) * 0.048;

  return smin(smin(cranium, jaw, 0.024), chin, 0.020);
}

/* Returns premultiplied light in rgb and the silhouette mask in a, so the
   caller can recess the core and add the wireframe on top. */
vec4 head(vec2 uv, float t, vec3 gold) {
  /* head tracking: pointer for ambient curiosity, camera for real attention */
  vec2 p = (uv - vec2(uPointer.x * 0.010, -0.010 + uPointer.y * 0.008)) * 0.94;

  /* breathing and a slow idle sway — the bust is never perfectly still, and
     both widen while the interface is in use so typing or a tracked person
     reaches the bust itself */
  float live = 1.0 + uEnergy * 0.9 + uPresence * 0.35;
  float breathAmp = 0.55 + 0.90 * clamp(uPosture.w, 0.0, 1.0);
  p.y += sin(t * 0.85) * 0.0024 * live * breathAmp + sin(t * 0.37 + 1.7) * 0.0013 * live;
  p.x += sin(t * 0.29) * 0.0016 * live;

  /* nobody tracked: the head drifts on its own instead of holding a pose */
  float drift = 1.0 - clamp(uAttention, 0.0, 1.0);
  p.x += sin(t * 0.41 + 0.6) * 0.0040 * drift;
  p.y += sin(t * 0.53 + 2.1) * 0.0026 * drift;

  /* turn the whole head toward the detected person, with a natural limit so
     tracking never looks like a snapped neck */
  vec2 look = clamp(uGaze, vec2(-1.0), vec2(1.0)) * uAttention;
  float yaw = look.x * 0.075;
  p = mat2(cos(yaw), sin(yaw), -sin(yaw), cos(yaw)) * p;
  p -= vec2(look.x * 0.011, -look.y * 0.009);

  /* posture: a nod, a head tilt and a slow sway, already damped by the
     controller, so the bust moves as one piece instead of sliding features */
  float roll = clamp(uPosture.y, -1.0, 1.0) * 0.055;
  p = mat2(cos(roll), sin(roll), -sin(roll), cos(roll)) * p;
  float nod = clamp(uPosture.x, -1.0, 1.0);
  p += vec2(clamp(uPosture.z, -1.0, 1.0) * 0.0035, nod * 0.0085);
  p.y *= 1.0 - nod * 0.012;

  float d = sdHead(p);
  float inside = smoothstep(0.0035, -0.0035, d);
  if (inside <= 0.002) return vec4(0.0);

  /* radial height field: contours are concentric and tighten toward the edge,
     which is what makes the surface read as a scanned volume */
  float rad = length((p - vec2(0.0, 0.006)) / vec2(0.208, 0.252));
  float hgt = clamp(1.0 - rad, 0.0, 1.0);
  float body = pow(hgt, 0.62);

  float cb = fract(hgt * 16.0 - t * 0.02);
  float bands = 1.0 - smoothstep(0.0, 0.048, min(cb, 1.0 - cb));

  /* fine reconstruction mesh */
  vec2 cell = fract(p * 104.0) - 0.5;
  float mesh = 1.0 - smoothstep(0.15, 0.32, length(cell));

  /* rim light at the silhouette */
  float rim = exp(-max(-d, 0.0) / 0.009);

  float lum = body * 0.14 + bands * 0.34 + mesh * 0.11 + rim * 1.35;
  vec3 col = mix(gold * 0.55, gold, body) * lum;

  /* forehead node */
  float nr = length(p - vec2(0.0, 0.138));
  col += WHITE * smoothstep(0.0115, 0.0075, nr) * 2.2;
  col += gold * thinLine(nr - 0.0255, 0.0016) * 1.05;
  col += gold * exp(-max(nr - 0.019, 0.0) * 52.0) * 0.4;

  /* eye sockets — recess first so the aperture does not bloom into the cheek */
  float sock = 0.0;
  for (int i = 0; i < 2; i++) {
    float s = i == 0 ? -1.0 : 1.0;
    vec2 e = p - vec2(0.084 * s, 0.016);
    float a = 0.17 * s;
    vec2 q = vec2(cos(a) * e.x - sin(a) * e.y, sin(a) * e.x + cos(a) * e.y);
    float ed = length(vec2(q.x * 0.94, q.y * 2.9)) - 0.038;
    sock += exp(-max(ed, 0.0) * 9.0);
  }
  col *= 1.0 - 0.34 * clamp(sock, 0.0, 1.0);

  /* eyes — slanted apertures: AU5 widens, AU6/7 squints, AU26 blink closes */
  float lidBase = mix(1.0, 0.10, clamp(uBlink, 0.0, 1.0));
  float lid = clamp(
    lidBase * (1.0 + 0.32 * clamp(uFace.z, 0.0, 1.0))
      - 0.40 * clamp(uFace.w, 0.0, 1.0)
      - 0.10 * clamp(uMouthForm.w, 0.0, 1.0),
    0.07, 1.50);
  for (int i = 0; i < 2; i++) {
    float s = i == 0 ? -1.0 : 1.0;
    vec2 e = p - vec2(0.084 * s, 0.016);
    float a = 0.17 * s;
    vec2 q = vec2(cos(a) * e.x - sin(a) * e.y, sin(a) * e.x + cos(a) * e.y);
    float ed = length(vec2(q.x * 0.94, q.y * 2.9 / max(lid, 0.05))) - 0.038;
    col += mix(WHITE, gold, 0.32) * smoothstep(0.0013, -0.0013, ed)
         * (0.95 + 0.35 * uPresence + 0.25 * uEnergy);
    col += gold * exp(-max(ed, 0.0) * 22.0) * (0.30 + 0.35 * uPresence);

    /* iris tracks the same attention vector as the head, but sooner */
    vec2 pupil = e - vec2(look.x * 0.0058, look.y * 0.0042);
    float pd = length(pupil * vec2(1.0, 1.35));
    col += mix(WHITE, gold, 0.18) * smoothstep(0.0064, 0.0026, pd)
         * (0.30 + 0.70 * uPresence) * lid;

    /* specular catchlight: the eye reads as wet only while it is open */
    vec2 hl = pupil + vec2(0.0021, 0.0017 + 0.0007 * look.y);
    float hd = length(hl * vec2(1.0, 1.4));
    col += WHITE * smoothstep(0.0022, 0.0, hd) * 0.85 * clamp(lid, 0.0, 1.0);
  }

  /* brow ridges — AU1/2 lift, AU4 pulls the inner ends down and together */
  float browLift = clamp(uFace.x, 0.0, 1.0);
  float browSink = clamp(uFace.y, 0.0, 1.0);
  float browY = 0.066 + browLift * 0.011 - browSink * 0.006;
  float browAngle = 0.52 - browSink * 0.20 + browLift * 0.05;
  for (int i = 0; i < 2; i++) {
    float s = i == 0 ? -1.0 : 1.0;
    vec2 b = p - vec2(0.090 * s, browY);
    float bl = abs(b.y + b.x * browAngle * s) - 0.0014;
    col += gold * thinLine(bl, 0.0018 + browSink * 0.0006)
         * smoothstep(0.062, 0.010, length(b)) * 0.62;
  }
  /* the vertical glabella crease AU4 produces */
  float crease = thinLine(abs(p.x) - 0.0050, 0.0011)
               * smoothstep(0.028, 0.046, p.y)
               * (1.0 - smoothstep(0.058, 0.078, p.y));
  col += gold * crease * browSink * 0.85;

  /* crown seams radiating above the forehead node */
  float sang = atan(p.y - 0.138, p.x);
  float seams = 0.0;
  for (int i = 0; i < 3; i++) {
    seams += thinLine(sang - (1.5708 + (float(i) - 1.0) * 0.72), 0.010);
  }
  col += gold * seams * smoothstep(0.144, 0.190, p.y) * 0.5;

  /* nose: bridge with a small base */
  col += gold * thinLine(abs(p.x) - 0.0019, 0.0012)
       * smoothstep(0.020, -0.010, p.y) * smoothstep(-0.060, -0.030, p.y) * 0.32;
  col += gold * thinLine(length((p - vec2(0.0, -0.050)) * vec2(1.0, 1.9)) - 0.028, 0.0016) * 0.30;

  /* AU9 — nose wrinkle: two short arcs above the nose base */
  float wrinkle = clamp(uMouthTone.z, 0.0, 1.0);
  for (int i = 0; i < 2; i++) {
    float yy = -0.016 - float(i) * 0.0085;
    float arc = exp(-abs(p.y - yy) / 0.0012) * smoothstep(0.032, 0.006, abs(p.x));
    col += gold * arc * wrinkle * 0.7;
  }

  /* mouth — a real lip rig: AU12/15 curvature, AU20/18 width, AU24 press,
     AU26 jaw opening from the viseme timeline, amplitude from real audio */
  float smile = clamp(uMouthTone.x, 0.0, 1.0);
  float frown = clamp(uMouthTone.y, 0.0, 1.0);
  float press = clamp(uMouthTone.w, 0.0, 1.0);
  float curve = 0.90 - 1.55 * smile + 1.35 * frown;
  float my = p.y + 0.112 + curve * p.x * p.x;
  float halfW = mix(0.056, 0.044, clamp(uMouthForm.y, 0.0, 1.0));
  halfW = mix(halfW, 0.074, clamp(uMouthForm.x, 0.0, 1.0));
  float openH = 0.0023 + clamp(uMouth * 0.95 + uAudio * 0.28, 0.0, 1.0) * 0.016;
  openH *= 1.0 - 0.70 * press;
  float mouthW = smoothstep(halfW, 0.014, abs(p.x));
  float gap = smoothstep(openH, 0.0, abs(my));
  col *= 1.0 - gap * mouthW * 0.58;
  col += gold * thinLine(my - openH, 0.0012) * mouthW * 0.72;
  col += gold * thinLine(my + openH, 0.0012) * mouthW * 0.58;

  /* teeth appear only while the jaw is genuinely apart */
  float teeth = smoothstep(0.28, 0.80, clamp(uMouth, 0.0, 1.0));
  col += WHITE * gap * mouthW * teeth
       * smoothstep(0.0060, 0.0, abs(my - openH * 0.55)) * 0.55;

  /* lip corners: the anchors that AU12 and AU15 actually move */
  float cornerDepth = 0.25 + 0.65 * abs(smile - frown);
  for (int i = 0; i < 2; i++) {
    float s = i == 0 ? -1.0 : 1.0;
    vec2 cp = vec2(halfW * s, -0.112 - curve * halfW * halfW);
    col += gold * exp(-length(p - cp) * 210.0) * cornerDepth;
  }

  /* cheek contour — sides only, and it lifts with AU6 (cheek raise) */
  float cheekLift = clamp(uMouthForm.w, 0.0, 1.0);
  float ck = length((p - vec2(0.0, 0.010 + cheekLift * 0.009)) * vec2(1.16, 0.94));
  col += gold * thinLine(ck - 0.150 - cheekLift * 0.004, 0.0014)
       * smoothstep(0.050, 0.120, abs(p.x)) * (0.30 + 0.28 * cheekLift);

  /* jaw plates, kept off the chin centre so the silhouette does not wrap */
  float side = smoothstep(0.012, 0.085, abs(p.x));
  col += gold * thinLine(-d - 0.019, 0.0013) * smoothstep(-0.04, -0.16, p.y) * side * 0.6;
  col += gold * thinLine(-d - 0.044, 0.0012) * smoothstep(-0.08, -0.20, p.y) * side * 0.32;

  /* observation sweep — only while a frame is genuinely being analysed */
  if (uScan > 0.001) {
    float sy = mix(0.20, -0.26, fract(t * 0.28));
    col += WHITE * exp(-abs(p.y - sy) * 90.0) * inside * 0.55 * uScan;
    col += gold * exp(-abs(p.y - sy) * 14.0) * inside * 0.12 * uScan;
  }

  return vec4(col * inside, inside);
}

/* ── neural filaments ───────────────────────────────────────────────────── */

float hash11(float n) { return fract(sin(n * 127.1) * 43758.5453); }

/* Tendrils of light leaving the crown and temples, each carrying beads of
   energy outward and ending in a bright synapse node. Analytic curves in
   polar space: a handful of trig calls per filament instead of a texture.
   They are pure decoration driven by real state — they do not represent
   measured brain activity. */
vec3 neuralWeave(vec2 uv, float t, vec3 gold) {
  vec2 c = uv - vec2(0.0, 0.026);
  float r = length(c);
  float ang = atan(c.y, c.x);

  /* keep the weave outside the skull, letting it reach past the ring stack */
  float band = smoothstep(0.150, 0.235, r) * (1.0 - smoothstep(0.660, 0.860, r));
  if (band <= 0.001) return vec3(0.0);

  vec3 acc = vec3(0.0);

  for (int i = 0; i < 14; i++) {
    float fi = float(i);
    float seed = hash11(fi + 1.0);
    float seed2 = fract(seed * 7.31 + 0.37);
    float seed3 = fract(seed * 13.70 + 0.11);
    float base = seed * 6.2831853;

    /* no tendrils under the chin: favour the crown and temple directions */
    float vert = smoothstep(-0.90, 0.12, sin(base));
    if (vert <= 0.02) continue;

    float bend = (seed2 - 0.5) * 3.2;
    float wob = 0.05 + 0.13 * seed3;
    float speed = 0.35 + seed * 0.55;

    /* the whole filament curls as it leaves the head and breathes over time */
    float th = base + bend * (r - 0.235)
             + wob * sin(r * 8.0 - t * speed + fi * 1.7);
    float da = ang - th;
    float arc = abs(atan(sin(da), cos(da))) * r;
    float width = 0.0032 + 0.0040 * seed2;
    float line = exp(-arc / width);

    /* each strand reaches a different distance, and slowly extends/retracts */
    float reach = 0.440 + 0.300 * seed3 + 0.055 * sin(t * 0.22 + fi * 2.1);
    float life = smoothstep(reach + 0.05, reach - 0.03, r)
               * smoothstep(0.165, 0.265, r);

    /* energy beads riding outward along the strand */
    float bp = fract(r * 3.2 - t * (0.18 + seed2 * 0.24) + seed * 5.0);
    float bead = pow(max(0.0, 1.0 - abs(bp * 2.0 - 1.0)), 10.0);

    /* synapse node at the end of the strand, with a small cross flare */
    float thEnd = base + bend * (reach - 0.235)
                + wob * sin(reach * 8.0 - t * speed + fi * 1.7);
    vec2 np = vec2(cos(thEnd), sin(thEnd)) * reach;
    float nd = length(c - np);
    float node = exp(-nd * 320.0);
    float halo = exp(-nd * 60.0) * 0.30;
    float flare = (exp(-abs(c.x - np.x) * 340.0)
                 + exp(-abs(c.y - np.y) * 340.0)) * exp(-nd * 90.0) * 0.70;

    vec3 tone = mix(gold, WHITE, 0.22 + 0.45 * seed3);
    float lum = line * (0.62 + 1.85 * bead) * life * vert;

    acc += tone * lum * 1.05;
    acc += WHITE * (node * 2.1 + flare) * life * vert;
    acc += gold * halo * life * vert * 1.15;
  }

  /* temple beams — the strongest horizontal strands in the reference plate */
  float beam = exp(-abs(c.y - 0.010) / 0.0035)
             * smoothstep(0.200, 0.330, abs(c.x))
             * (1.0 - smoothstep(0.560, 0.820, abs(c.x)));
  acc += mix(gold, WHITE, 0.45) * beam * (0.42 + 0.20 * sin(t * 0.55));

  return acc * band;
}

/* ── concentric ring stack ──────────────────────────────────────────────── */

vec3 ringStack(vec2 uv, float t, vec3 gold) {
  float r = length(uv);
  float a01 = atan(uv.y, uv.x) / 6.2831853 + 0.5;
  float spin = t * (0.35 + 0.65 * uRing) * (1.0 + 0.30 * uEnergy);
  vec3 acc = vec3(0.0);

  /* inner hairlines */
  acc += gold * thinLine(r - 0.264, 0.0010) * 0.40;
  acc += gold * thinLine(r - 0.282, 0.0016) * 0.85;

  /* metric tick band: 144 short graduations + 12 long ones */
  float band = smoothstep(0.290, 0.294, r) * (1.0 - smoothstep(0.318, 0.322, r));
  float tf = fract(a01 * 144.0 + spin * 0.02);
  float ticks = 1.0 - smoothstep(0.0, 0.050, min(tf, 1.0 - tf));
  acc += GOLD2 * ticks * band * 0.52;

  float lf = fract(a01 * 12.0);
  float longTick = 1.0 - smoothstep(0.0, 0.0035, min(lf, 1.0 - lf));
  acc += gold * longTick * smoothstep(0.290, 0.296, r) * (1.0 - smoothstep(0.332, 0.340, r)) * 0.8;

  /* four long arcs, counter-rotating pair */
  acc += gold * arcMask(a01, 4.0, 0.80, spin * 0.035, 0.004) * thinLine(r - 0.348, 0.0021) * 1.10;
  acc += gold * arcMask(a01, 4.0, 0.80, spin * 0.035 + 0.5, 0.004) * thinLine(r - 0.357, 0.0009) * 0.40;

  /* dashes */
  acc += GOLD2 * arcMask(a01, 108.0, 0.50, -spin * 0.09, 0.002) * thinLine(r - 0.376, 0.0015) * 0.65;

  /* hairline */
  acc += gold * thinLine(r - 0.396, 0.0009) * 0.32;

  /* eight segments */
  acc += gold * arcMask(a01, 8.0, 0.52, -spin * 0.055, 0.006) * thinLine(r - 0.420, 0.0018) * 0.80;

  /* cardinal accents */
  float card = arcMask(a01, 4.0, 0.024, 0.0, 0.002);
  acc += WHITE * card * smoothstep(0.328, 0.350, r) * (1.0 - smoothstep(0.352, 0.372, r)) * 1.5;

  /* outer bracket arcs */
  acc += GOLD2 * arcMask(a01, 3.0, 0.42, spin * 0.018 + 0.12, 0.010) * thinLine(r - 0.452, 0.0016) * 0.65;

  /* attention arc: lights up only when a person is actually being tracked */
  acc += WHITE * arcMask(a01, 2.0, 0.16, 0.25 - spin * 0.01, 0.02)
       * thinLine(r - 0.404, 0.0016) * 1.1 * uAttention;

  return acc * (1.0 - smoothstep(0.470, 0.520, r));
}

/* ── composite ──────────────────────────────────────────────────────────── */

void main() {
  float aspect = uRes.x / max(uRes.y, 1.0);
  vec2 uv = (vUv - 0.5) * vec2(aspect, 1.0);

  float t = uTime;
  float r0 = length(uv);
  vec3 gold = mix(GOLD, HOT, clamp(uHue, 0.0, 1.0) * 0.75);

  vec3 col = vec3(0.0);

  /* ambient halo */
  col += gold * exp(-r0 * r0 * 8.0) * 0.20;
  col += GOLD2 * exp(-r0 * 11.0) * 0.09;

  /* a wave leaves the core continuously, so the hologram is never a still
     image even when nobody is asking anything */
  float wave = fract(t * 0.13);
  col += gold * exp(-abs(r0 - wave * 0.50) * 44.0) * (1.0 - wave) * 0.34;

  /* speech ripple — driven by the measured TTS amplitude, not by a timer */
  col += gold * exp(-abs(r0 - (0.285 + uAudio * 0.10)) * 62.0) * uAudio * 0.55;

  /* presence halo: a genuinely tracked person warms the outer band */
  col += gold * exp(-pow((r0 - 0.415) / 0.030, 2.0)) * uPresence * 0.22;

  col += ringStack(uv, t, gold) * (0.20 + 0.80 * clamp(uRing, 0.0, 1.8)) * (0.85 + uAmp * 0.15);

  /* neural weave behind the head: brighter when someone is tracked or the
     interface is being used, never enough to wash out the face */
  col += neuralWeave(uv, t, gold)
       * (0.55 + 0.35 * clamp(uPresence, 0.0, 1.0) + 0.30 * clamp(uEnergy, 0.0, 1.0));

  /* interior glow behind the head */
  col *= 1.0 - exp(-pow(r0 / 0.30, 2.0)) * 0.34;
  col += gold * exp(-pow(r0 / 0.24, 2.0)) * 0.05 * (0.7 + uAudio * 0.7);

  /* recess the core so the wireframe reads, then lay the head on top */
  vec4 h = head(uv, t, gold);
  col *= 1.0 - h.a * 0.58;
  col += h.rgb * (1.0 + uAudio * 0.45 + uEnergy * 0.15);

  /* scanline shimmer */
  col *= 0.976 + 0.024 * sin(vUv.y * uRes.y * 1.15 - t * 5.0);

  /* vignette — starts past the neural weave so the outer strands survive */
  col *= 1.0 - smoothstep(0.62, 0.98, r0) * 0.50;

  col = min(col, vec3(1.0));
  float alpha = clamp(max(max(col.r, col.g), col.b), 0.0, 1.0);
  fragColor = vec4(col, alpha);
}`;

export const PARTICLE_VS = `#version 300 es
precision highp float;

in float aSeed;
out float vAlpha;
out float vSeed;

uniform float uTime;
uniform float uAudio;
uniform float uAmp;
uniform float uDpr;

float h(float n) { return fract(sin(n * 12.9898) * 43758.5453); }

void main() {
  float s = aSeed;
  float a = h(s) * 6.28318;
  float b = h(s + 1.7) * 3.14159;
  float rad = 0.52 + h(s + 3.3) * 0.46;
  float speed = 0.10 + h(s + 5.1) * 0.34;

  float t = uTime * speed * (0.55 + uAmp * 0.8);
  vec3 p;
  p.x = cos(a + t) * cos(b) * rad;
  p.y = sin(b) * rad * 0.66;
  p.z = sin(a + t) * cos(b) * rad;

  p += 0.030 * vec3(
    sin(uTime * 0.9 + s * 6.0),
    cos(uTime * 1.1 + s * 4.0) * 1.6,
    sin(uTime * 0.7 + s * 8.0)
  );

  float persp = 2.6;
  float depth = p.z + persp;
  vec2 sp = p.xy / depth;

  gl_Position = vec4(sp.x * 1.85, sp.y * 1.85, 0.0, 1.0);
  gl_PointSize = (1.1 + 2.0 * h(s + 7.0)) * uDpr * (1.0 + uAudio * 0.8) * clamp(1.5 / depth, 0.4, 1.5);

  vAlpha = smoothstep(0.0, 0.62, 1.0 - abs(sp.x) * 0.85) * (0.22 + 0.58 * h(s + 9.0));
  vSeed = h(s + 11.0);
}`;

export const PARTICLE_FS = `#version 300 es
precision highp float;

in float vAlpha;
in float vSeed;
out vec4 fragColor;

void main() {
  vec2 c = gl_PointCoord - vec2(0.5);
  float d = length(c);
  if (d > 0.5) discard;
  float a = smoothstep(0.5, 0.0, d) * vAlpha;
  vec3 col = mix(vec3(1.0, 0.80, 0.36), vec3(1.0, 0.58, 0.16), vSeed);
  fragColor = vec4(col * a, a);
}`;

/** Visual parameters per behaviour state. Motion communicates status. */
export interface StateParams {
  speed: number;
  amp: number;
  /** warmth of the core: 0 = pure gold, 1 = red-orange */
  hue: number;
  /** how much of the ring stack is lit / how fast it turns */
  ring: number;
  label: string;
}

export const STATES: Record<string, StateParams> = {
  GENESIS: { speed: 1.5, amp: 1, hue: 0.35, ring: 1, label: "Genesis" },
  IDLE: { speed: 0.62, amp: 1, hue: 0.12, ring: 0.70, label: "Idle" },
  LISTENING: { speed: 1.15, amp: 1.25, hue: 0.04, ring: 0.9, label: "Listening" },
  UNDERSTANDING: { speed: 0.8, amp: 0.95, hue: 0.26, ring: 0.7, label: "Understanding" },
  THINKING: { speed: 1.6, amp: 1.1, hue: 0.44, ring: 1.1, label: "Thinking" },
  COLLABORATING: { speed: 1.35, amp: 1.15, hue: 0.62, ring: 1.3, label: "Collaborating" },
  RESEARCHING: { speed: 1.1, amp: 1, hue: 0.32, ring: 1.45, label: "Researching" },
  VERIFYING: { speed: 0.9, amp: 1.05, hue: 0.50, ring: 1.7, label: "Verifying" },
  SPEAKING: { speed: 1.0, amp: 1.2, hue: 0.08, ring: 0.8, label: "Speaking" },
  GENERATING: { speed: 1.5, amp: 1.22, hue: 0.42, ring: 1.15, label: "Generating" },
  LEARNING: { speed: 1.2, amp: 1.1, hue: 0.56, ring: 1.2, label: "Learning" },
  REMEMBERING: { speed: 0.7, amp: 1, hue: 0.40, ring: 1.05, label: "Remembering" },
  CURIOUS: { speed: 1.3, amp: 1.15, hue: 0.22, ring: 1.0, label: "Curious" },
  CONFUSED: { speed: 1.8, amp: 1.3, hue: 0.72, ring: 0.45, label: "Uncertain" },
  SUCCESS: { speed: 0.85, amp: 1.05, hue: 0.0, ring: 1.4, label: "Done" },
  ERROR: { speed: 0.35, amp: 0.8, hue: 0.95, ring: 0.3, label: "Recovered" },
  UPGRADING: { speed: 1.45, amp: 1.2, hue: 0.60, ring: 1.6, label: "Upgrading" },
  SLEEPING: { speed: 0.18, amp: 0.5, hue: 0.30, ring: 0.15, label: "Standby" },
  OFFLINE: { speed: 0.1, amp: 0.35, hue: 0.45, ring: 0.0, label: "Offline" },
  RECOVERING: { speed: 0.8, amp: 0.85, hue: 0.18, ring: 0.5, label: "Recovering" },
  CONCERNED: { speed: 0.7, amp: 0.95, hue: 0.30, ring: 0.6, label: "Concerned" },
  PRESENCE: { speed: 0.72, amp: 1.05, hue: 0.06, ring: 0.85, label: "Presence detected" },
  OBSERVING: { speed: 0.95, amp: 1.1, hue: 0.2, ring: 1.25, label: "Visual observation" },
  EXECUTING: { speed: 1.4, amp: 1.15, hue: 0.5, ring: 1.35, label: "Executing task" },
  INTERRUPTED: { speed: 0.6, amp: 0.9, hue: 0.66, ring: 0.4, label: "Interrupted" },
};

export type HydroState = keyof typeof STATES;
