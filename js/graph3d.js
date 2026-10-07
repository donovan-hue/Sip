/* ═══════════════ graph3d.js — Red neuronal 3D · neón fosforescente cíclico sobre negro ═══════════════ */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/* ── Paleta fosforescente ── */
export const NEON = {
  manual:   { color: '#00e0ff', label: 'Notas' },        // azul eléctrico
  chatgpt:  { color: '#ff2d95', label: 'ChatGPT' },      // fucsia
  gemini:   { color: '#a020ff', label: 'Gemini' },       // morado eléctrico
  whatsapp: { color: '#39ff14', label: 'WhatsApp' },     // verde fosforescente
  facebook: { color: '#2f7bff', label: 'Messenger' },    // azul fuerte
  generic:  { color: '#ff5ce0', label: 'Otras IA' },     // rosa fiusha
  person:   { color: '#ff1f1f', label: 'Personas' },     // rojo fuerte concentrado
};
export const CYCLE_SECONDS = 14; // el color da una vuelta completa cada 14 s, en bucle infinito

const EDGE_SEG = 10;
const MAX_PULSES = 80;
const PULSE_EVERY = 0.05;

function makeGlowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

function makeLabelTexture(text, color) {
  const pad = 14, fs = 30;
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  g.font = `700 ${fs}px -apple-system, "Segoe UI", Roboto, sans-serif`;
  const w = Math.min(g.measureText(text).width + pad * 2, 640);
  c.width = w; c.height = fs + pad * 1.4;
  const g2 = c.getContext('2d');
  g2.font = `700 ${fs}px -apple-system, "Segoe UI", Roboto, sans-serif`;
  g2.fillStyle = 'rgba(0,0,0,.85)';
  const r = 12, W = c.width, H = c.height;
  g2.beginPath();
  g2.moveTo(r, 0); g2.arcTo(W, 0, W, H, r); g2.arcTo(W, H, 0, H, r); g2.arcTo(0, H, 0, 0, r); g2.arcTo(0, 0, W, 0, r);
  g2.closePath(); g2.fill();
  g2.strokeStyle = color; g2.lineWidth = 2; g2.stroke();
  g2.fillStyle = '#f5f5f5';
  g2.textBaseline = 'middle';
  const label = g2.measureText(text).width > w - pad * 2 ? text.slice(0, 26) + '…' : text;
  g2.fillText(label, (w - g2.measureText(label).width) / 2, H / 2 + 1);
  return new THREE.CanvasTexture(c);
}

/* Borde fresnel nítido: la esfera se ve como orbe de vidrio con el borde de color */
const SHELL_VERT = `
varying vec3 vN; varying vec3 vP;
void main(){
  vN = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vP = mv.xyz;
  gl_Position = projectionMatrix * mv;
}`;
const SHELL_FRAG = `
uniform vec3 uColor; uniform float uOpacity;
varying vec3 vN; varying vec3 vP;
void main(){
  float f = pow(1.0 - abs(dot(normalize(vN), normalize(-vP))), 2.9);
  gl_FragColor = vec4(uColor, f * uOpacity);
}`;

export class Graph3D {
  constructor(container, { tooltipEl, onOpen, onFocus, onSignal } = {}) {
    this.container = container;
    this.tooltipEl = tooltipEl;
    this.onOpen = onOpen || (() => {});
    this.onFocus = onFocus || (() => {});
    this.onSignal = onSignal || null;
    this.nodes = []; this.edges = [];
    this.nodeObjs = new Map();
    this.activeTypes = new Set(['manual', 'chatgpt', 'gemini', 'whatsapp', 'facebook', 'generic', 'person']);
    this.showMentions = true;
    this.labelsOn = false;
    this.focusId = null;
    this.hoverId = null; this.selectedId = null;
    this.pinned = false;
    this.alive = false;
    this.pulses = [];
    this._pulseTimer = 0;
    this._tmp = new THREE.Vector3();
    this._hsl = { h: 0, s: 0, l: 0 };
    this._ca = new THREE.Color(); this._cb = new THREE.Color(); this._mix = new THREE.Color();

    // ── Escena: negro puro, sin fondo ──
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000000);
    this.scene.fog = new THREE.FogExp2(0x000000, 0.0026); // profundidad: lo lejano se funde a negro
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 3000);
    this.camera.position.set(0, 60, 300);
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.minDistance = 25;
    this.controls.maxDistance = 700;
    this.controls.rotateSpeed = 0.7;
    // modo cinemática: gira sola como demo de trading; se pausa al interactuar
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.5;
    this._lastInteract = 0;
    const touch = () => { this._lastInteract = performance.now(); this.controls.autoRotate = false; };
    this.renderer.domElement.addEventListener('pointerdown', touch);
    this.renderer.domElement.addEventListener('wheel', touch, { passive: true });

    this.scene.add(new THREE.AmbientLight(0x223, 1.2));
    const pl = new THREE.PointLight(0xffffff, 1.4, 900);
    pl.position.set(80, 120, 160);
    this.scene.add(pl);

    // ── Rejilla holográfica (piso estilo trading/Tron) ──
    this.grid = new THREE.GridHelper(700, 46, 0x39ff14, 0x00e0ff);
    this.grid.material.transparent = true;
    this.grid.material.opacity = 0.13;
    this.grid.material.depthWrite = false;
    this.grid.position.y = -85;
    this.scene.add(this.grid);

    // ── Bloom sutil (sin exceso de brillo) ──
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.5, 0.55, 0.3);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    // ── Recursos ──
    this.glowTex = makeGlowTexture();
    this.sphereGeo = new THREE.SphereGeometry(1, 36, 36);
    this.ringGeo = new THREE.TorusGeometry(1, 0.018, 6, 72); // anillos orbitales
    this.pulseGroup = new THREE.Group();
    this.scene.add(this.pulseGroup);
    this.pulseMat = new THREE.SpriteMaterial({
      map: this.glowTex, color: 0xffffff,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    });

    // ── Interacción ──
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2(-2, -2);
    this._downPos = null;
    const el = this.renderer.domElement;
    el.addEventListener('pointermove', e => this._onPointerMove(e));
    el.addEventListener('pointerdown', e => { this._downPos = [e.clientX, e.clientY]; });
    el.addEventListener('pointerup', e => this._onClick(e));
    el.addEventListener('dblclick', e => this._onDblClick(e));
    el.addEventListener('pointerleave', () => { this._setHover(null); });

    this._ro = new ResizeObserver(() => this.resize());
    this._ro.observe(container);
    this.resize();

    this.clock = new THREE.Clock();
    this._loop = this._loop.bind(this);
  }

  baseColorOf(node) { return new THREE.Color((NEON[node.source] || NEON.manual).color); }

  start() { if (!this.alive) { this.alive = true; this.clock.getDelta(); this._loop(); } }
  stop() { this.alive = false; if (this._raf) cancelAnimationFrame(this._raf); }
  dispose() { this.stop(); this._ro.disconnect(); this.renderer.dispose(); }

  resize() {
    const w = this.container.clientWidth || 1, h = this.container.clientHeight || 1;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
  }

  /* ── Datos ─────────────────────────────── */
  setData({ nodes, edges }) {
    if (this.nodeGroup) this.scene.remove(this.nodeGroup);
    for (const o of this.nodeObjs.values()) {
      o.label.material.map?.dispose(); o.label.material.dispose();
      o.sphere.material.dispose(); o.shell.material.dispose(); o.wire.material.dispose();
      if (o.ring) o.ring.material.dispose();
    }
    this.nodeObjs.clear();
    this._clearPulses();

    this.nodes = nodes; this.edges = edges;
    this.nodeGroup = new THREE.Group();
    this.scene.add(this.nodeGroup);

    const clusterCenters = {};
    const srcs = [...new Set(nodes.map(n => n.source))];
    srcs.forEach((s, i) => {
      const a = (i / Math.max(srcs.length, 1)) * Math.PI * 2;
      clusterCenters[s] = new THREE.Vector3(Math.cos(a) * 46, Math.sin(a * 1.7) * 22, Math.sin(a) * 46);
    });

    for (const n of nodes) {
      const base = this.baseColorOf(n);
      base.getHSL(this._hsl);
      const baseH = this._hsl.h;
      const size = n.kind === 'person' ? 2.4 + Math.sqrt(n.degree) * 0.5 : 1.35 + Math.sqrt(n.degree) * 0.62;

      // núcleo oscuro (el color vive en el borde, no en el brillo)
      const sphere = new THREE.Mesh(this.sphereGeo, new THREE.MeshStandardMaterial({
        color: base.clone().multiplyScalar(0.25),
        emissive: base, emissiveIntensity: 0.28,
        roughness: 0.35, metalness: 0.2,
      }));
      sphere.scale.setScalar(size);
      sphere.userData.id = n.id;

      // borde de color (fresnel)
      const shell = new THREE.Mesh(this.sphereGeo, new THREE.ShaderMaterial({
        uniforms: { uColor: { value: base.clone() }, uOpacity: { value: 1.1 } },
        vertexShader: SHELL_VERT, fragmentShader: SHELL_FRAG,
        transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      shell.scale.setScalar(size * 1.62);

      // malla wireframe: definición técnica 3D
      const wire = new THREE.Mesh(this.sphereGeo, new THREE.MeshBasicMaterial({
        color: base, wireframe: true, transparent: true, opacity: 0.15,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      wire.scale.setScalar(size * 1.42);

      // etiqueta
      const label = new THREE.Sprite(new THREE.SpriteMaterial({
        map: makeLabelTexture(n.title, (NEON[n.source] || NEON.manual).color),
        transparent: true, depthWrite: false, depthTest: false, opacity: 0,
      }));
      label.scale.set(label.material.map.image.width / 26, label.material.map.image.height / 26, 1);
      label.position.y = size + 2.8;
      label.renderOrder = 10;

      const group = new THREE.Group();
      group.add(sphere); group.add(wire); group.add(shell); group.add(label);

      // anillo orbital en nodos clave: personas y muy conectados (estilo holograma)
      let ring = null;
      if (n.kind === 'person' || n.degree >= 3) {
        ring = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({
          color: base, transparent: true, opacity: 0.75,
          blending: THREE.AdditiveBlending, depthWrite: false,
        }));
        ring.scale.setScalar(size * (n.kind === 'person' ? 2.5 : 2.2));
        ring.rotation.x = Math.PI / 2 + (Math.random() - 0.5) * 0.9;
        ring.userData.spin = 0.35 + Math.random() * 0.5;
        group.add(ring);
      }
      this.nodeGroup.add(group);

      const cc = clusterCenters[n.source] || new THREE.Vector3();
      const target = {
        x: cc.x + (Math.random() - 0.5) * 60,
        y: cc.y + (Math.random() - 0.5) * 60,
        z: cc.z + (Math.random() - 0.5) * 60,
        vx: 0, vy: 0, vz: 0,
        phase: Math.random() * Math.PI * 2,
        size,
      };
      group.position.set(target.x, target.y, target.z);
      this.nodeObjs.set(n.id, { group, sphere, shell, wire, ring, label, node: n, target, baseH, hue: baseH });
    }
    this._buildEdges();
    this.temp = 1;
    this.tickCount = 0;
    this.applyFilters();
  }

  /* ── Conexiones curvas (las "llaves" de la red) ── */
  _buildEdges() {
    if (this.edgeLines) {
      this.scene.remove(this.edgeLines);
      this.edgeLines.geometry.dispose();
      this.edgeLines.material.dispose();
      this.edgeLines = null;
    }
    const vis = this._visibleEdges();
    this._visEdges = vis;
    const visSet = new Set(vis);
    this._clearPulses(p => !visSet.has(p.e));
    if (!vis.length) return;

    const verts = vis.length * EDGE_SEG * 2;
    const pos = new Float32Array(verts * 3);
    const colArr = new Float32Array(verts * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colArr, 3));
    this.edgeLines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.edgeLines.frustumCulled = false;
    this.scene.add(this.edgeLines);
    this._updateEdgeColors();
  }

  _curveAt(a, b, t, out) {
    const cx = (a.x + b.x) / 2 * 1.18, cy = (a.y + b.y) / 2 * 1.18, cz = (a.z + b.z) / 2 * 1.18;
    const mt = 1 - t;
    return out.set(
      mt * mt * a.x + 2 * mt * t * cx + t * t * b.x,
      mt * mt * a.y + 2 * mt * t * cy + t * t * b.y,
      mt * mt * a.z + 2 * mt * t * cz + t * t * b.z,
    );
  }

  _updateEdgePositions() {
    if (!this.edgeLines || !this._visEdges) return;
    const arr = this.edgeLines.geometry.attributes.position.array;
    const p0 = this._tmp, p1 = new THREE.Vector3();
    for (let i = 0; i < this._visEdges.length; i++) {
      const A = this.nodeObjs.get(this._visEdges[i].a)?.group.position;
      const B = this.nodeObjs.get(this._visEdges[i].b)?.group.position;
      if (!A || !B) continue;
      let vi = i * EDGE_SEG * 2 * 3;
      this._curveAt(A, B, 0, p1);
      for (let s = 1; s <= EDGE_SEG; s++) {
        const t = s / EDGE_SEG;
        p0.copy(p1);
        this._curveAt(A, B, t, p1);
        arr[vi++] = p0.x; arr[vi++] = p0.y; arr[vi++] = p0.z;
        arr[vi++] = p1.x; arr[vi++] = p1.y; arr[vi++] = p1.z;
      }
    }
    this.edgeLines.geometry.attributes.position.needsUpdate = true;
  }

  // degradado de color a lo largo de cada conexión, siguiendo el ciclo
  _updateEdgeColors() {
    if (!this.edgeLines || !this._visEdges) return;
    const arr = this.edgeLines.geometry.attributes.color.array;
    const { _ca: ca, _cb: cb, _mix: mix } = this;
    for (let i = 0; i < this._visEdges.length; i++) {
      const a = this.nodeObjs.get(this._visEdges[i].a);
      const b = this.nodeObjs.get(this._visEdges[i].b);
      if (!a || !b) continue;
      ca.setHSL(a.hue, 1, 0.55); cb.setHSL(b.hue, 1, 0.55);
      for (let s = 0; s < EDGE_SEG; s++) {
        const t0 = s / EDGE_SEG, t1 = (s + 1) / EDGE_SEG;
        mix.copy(ca).lerp(cb, t0);
        let vi = (i * EDGE_SEG * 2 + s * 2) * 3;
        arr[vi++] = mix.r; arr[vi++] = mix.g; arr[vi++] = mix.b;
        mix.copy(ca).lerp(cb, t1);
        arr[vi++] = mix.r; arr[vi++] = mix.g; arr[vi++] = mix.b;
      }
    }
    this.edgeLines.geometry.attributes.color.needsUpdate = true;
  }

  _visibleEdges() {
    const focusSet = this.focusId ? this._neighborSet(this.focusId) : null;
    return this.edges.filter(e => {
      if (e.type === 'mention' && !this.showMentions) return false;
      const a = this.nodeObjs.get(e.a), b = this.nodeObjs.get(e.b);
      if (!a || !b || !a.group.visible || !b.group.visible) return false;
      if (focusSet && !(focusSet.has(e.a) && focusSet.has(e.b))) return false;
      return true;
    });
  }

  _neighborSet(id) {
    const s = new Set([id]);
    for (const e of this.edges) {
      if (e.a === id) s.add(e.b);
      if (e.b === id) s.add(e.a);
    }
    return s;
  }

  /* ── Señales: la información viaja punto a punto ── */
  _clearPulses(pred) {
    this.pulses = this.pulses.filter(p => {
      if (!pred || pred(p)) {
        this.pulseGroup.remove(p.s);
        p.s.material.dispose();
        return false;
      }
      return true;
    });
  }

  _spawnPulse(fromId) {
    const vis = this._visEdges;
    if (!vis || !vis.length || this.pulses.length >= MAX_PULSES) return;
    let e, dir = 1;
    if (fromId) {
      const cand = vis.filter(x => x.a === fromId || x.b === fromId);
      if (!cand.length) return;
      e = cand[Math.floor(Math.random() * cand.length)];
      dir = e.a === fromId ? 1 : -1;
    } else {
      e = vis[Math.floor(Math.random() * vis.length)];
    }
    const s = new THREE.Sprite(this.pulseMat.clone());
    s.scale.setScalar(3.0);
    this.pulseGroup.add(s);
    this.pulses.push({
      e, dir, t: 0, s,
      speed: 1 / (1.4 + Math.random() * 1.8),
      hue: (this.nodeObjs.get(e.a)?.hue ?? 0),
    });
    if (this.onSignal) this.onSignal(e, !!fromId);
  }

  burst(id, n = 8) {
    for (let i = 0; i < n; i++) this._spawnPulse(id);
  }

  _updatePulses(dt) {
    this._pulseTimer += dt;
    while (this._pulseTimer > PULSE_EVERY) {
      this._pulseTimer -= PULSE_EVERY;
      this._spawnPulse(null);
    }
    const p = new THREE.Vector3();
    for (let i = this.pulses.length - 1; i >= 0; i--) {
      const q = this.pulses[i];
      q.t += dt * q.speed;
      const A = this.nodeObjs.get(q.e.a)?.group.position;
      const B = this.nodeObjs.get(q.e.b)?.group.position;
      if (q.t >= 1 || !A || !B) {
        this.pulseGroup.remove(q.s);
        this.pulses.splice(i, 1);
        continue;
      }
      this._curveAt(A, B, q.dir > 0 ? q.t : 1 - q.t, p);
      q.s.position.copy(p);
      q.s.material.opacity = Math.sin(Math.PI * q.t) * 0.95;
      const sc = 2.2 + Math.sin(Math.PI * q.t) * 1.4;
      q.s.scale.setScalar(sc);
      q.s.material.color.setHSL((q.hue + this.clock.elapsedTime / CYCLE_SECONDS) % 1, 0.9, 0.72);
    }
  }

  /* ── Filtros / foco ───────────────────── */
  setFilter(types, showMentions) {
    if (types) this.activeTypes = new Set(types);
    if (showMentions !== undefined) this.showMentions = showMentions;
    this.applyFilters();
  }
  setLabels(on) { this.labelsOn = on; }

  applyFilters() {
    for (const o of this.nodeObjs.values()) {
      o.group.visible = this.activeTypes.has(o.node.source);
    }
    this._buildEdges();
  }

  focusNode(id) {
    this.focusId = id;
    const o = this.nodeObjs.get(id);
    if (!o) return;
    this._hideTooltip();
    this._buildEdges();
    this.burst(id, 10);
    const p = o.group.position;
    this._camTween = {
      target: p.clone(),
      pos: p.clone().add(new THREE.Vector3(28, 16, 42)),
      t: 0,
    };
    this.onFocus(o.node);
  }
  clearFocus() {
    this.focusId = null;
    this._buildEdges();
    this._camTween = { target: new THREE.Vector3(0, 0, 0), pos: new THREE.Vector3(0, 50, 190), t: 0 };
    this.onFocus(null);
  }

  /* ── Simulación de fuerzas ────────────── */
  _forces() {
    if (this.temp <= 0.02) return;
    const objs = [...this.nodeObjs.values()].filter(o => o.group.visible);
    const n = objs.length;
    const REP = 340;
    for (let i = 0; i < n; i++) {
      const A = objs[i].target;
      for (let j = i + 1; j < n; j++) {
        const B = objs[j].target;
        let dx = A.x - B.x, dy = A.y - B.y, dz = A.z - B.z;
        let d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < 1) { dx = (Math.random() - .5); dy = (Math.random() - .5); dz = (Math.random() - .5); d2 = 1; }
        if (d2 > 40000) continue;
        const d = Math.sqrt(d2);
        const f = Math.min(REP / d2, 2.2);
        const fx = dx / d * f, fy = dy / d * f, fz = dz / d * f;
        A.vx += fx; A.vy += fy; A.vz += fz;
        B.vx -= fx; B.vy -= fy; B.vz -= fz;
      }
    }
    const K = 0.05, REST = 30;
    for (const e of this._visEdges || []) {
      const a = this.nodeObjs.get(e.a)?.target, b = this.nodeObjs.get(e.b)?.target;
      if (!a || !b) continue;
      const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      const f = (d - REST) * K * (e.type === 'mention' ? 0.4 : 1);
      const fx = dx / d * f, fy = dy / d * f, fz = dz / d * f;
      a.vx += fx; a.vy += fy; a.vz += fz;
      b.vx -= fx; b.vy -= fy; b.vz -= fz;
    }
    for (const o of objs) {
      const t = o.target;
      t.vx -= t.x * 0.004; t.vy -= t.y * 0.004; t.vz -= t.z * 0.004;
      t.vx *= 0.82; t.vy *= 0.82; t.vz *= 0.82;
      const sp = Math.sqrt(t.vx * t.vx + t.vy * t.vy + t.vz * t.vz);
      const max = 3.2;
      if (sp > max) { t.vx *= max / sp; t.vy *= max / sp; t.vz *= max / sp; }
      t.x += t.vx * this.temp; t.y += t.vy * this.temp; t.z += t.vz * this.temp;
    }
    this.temp = Math.max(this.temp * 0.995, 0.02);
    this.tickCount++;
  }

  /* ── Interacción ──────────────────────── */
  _onPointerMove(e) {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    this.pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    this._clientXY = [e.clientX - r.left, e.clientY - r.top];
  }

  _pick() {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const spheres = [...this.nodeObjs.values()].filter(o => o.group.visible).map(o => o.sphere);
    const hits = this.raycaster.intersectObjects(spheres, false);
    return hits.length ? hits[0].object.userData.id : null;
  }

  _hideTooltip() {
    this.pinned = false;
    this.selectedId = null;
    if (this.tooltipEl) { this.tooltipEl.classList.add('hidden'); this.tooltipEl.classList.remove('pinned'); }
  }
  clearSelection() { this._hideTooltip(); }

  _showTooltipAt(x, y) {
    const el = this.tooltipEl;
    if (!el) return;
    el.style.left = Math.min(x + 16, this.container.clientWidth - 270) + 'px';
    el.style.top = Math.min(y + 14, this.container.clientHeight - 130) + 'px';
    el.classList.remove('hidden');
  }

  _setHover(id) {
    if (this.hoverId === id) return;
    this.hoverId = id;
    const el = this.tooltipEl;
    if (!el) return;
    if (this.pinned) {
      this.renderer.domElement.style.cursor = id ? 'pointer' : 'grab';
      return;
    }
    if (!id) { el.classList.add('hidden'); this.renderer.domElement.style.cursor = 'grab'; return; }
    const o = this.nodeObjs.get(id);
    if (!o) return;
    const kind = o.node.kind === 'person' ? '👤 Persona' : o.node.kind === 'conversation' ? '💬 Conversación' : '📝 Nota';
    el.innerHTML = `<div class="tt-title">${o.node.title.replace(/</g, '&lt;')}</div>
      <div class="tt-sub">${kind} · ${o.node.degree} conexiones</div>`;
    this._showTooltipAt(this._clientXY?.[0] || 0, this._clientXY?.[1] || 0);
    this.renderer.domElement.style.cursor = 'pointer';
  }

  _pinTooltip(id) {
    const o = this.nodeObjs.get(id);
    const el = this.tooltipEl;
    if (!o || !el) return;
    const kind = o.node.kind === 'person' ? '👤 Persona' : o.node.kind === 'conversation' ? '💬 Conversación' : '📝 Nota';
    const canOpen = o.node.kind !== 'person';
    el.innerHTML = `
      <div class="tt-title">${o.node.title.replace(/</g, '&lt;')}</div>
      <div class="tt-sub">${kind} · ${o.node.degree} conexiones</div>
      <div class="tt-actions">
        ${canOpen ? '<button class="tt-open">📂 Abrir</button>' : ''}
        <button class="tt-focus">🔎 Enfocar vecindad</button>
      </div>`;
    el.classList.add('pinned');
    this.pinned = true;
    this._showTooltipAt(this._clientXY?.[0] || 0, this._clientXY?.[1] || 0);
    el.querySelector('.tt-open')?.addEventListener('click', () => this.onOpen(id));
    el.querySelector('.tt-focus')?.addEventListener('click', () => this.focusNode(id));
  }

  _onClick(e) {
    if (this._downPos) {
      const dx = e.clientX - this._downPos[0], dy = e.clientY - this._downPos[1];
      this._downPos = null;
      if (dx * dx + dy * dy > 36) return;
    }
    const id = this._pick();
    if (!id) { this._hideTooltip(); return; }
    this.selectedId = id;
    this._pinTooltip(id);
    this.burst(id, 6);
  }

  _onDblClick() {
    const id = this._pick();
    if (id) this.focusNode(id);
  }

  /* ── Loop ─────────────────────────────── */
  _loop() {
    if (!this.alive) return;
    this._raf = requestAnimationFrame(this._loop);
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const t = this.clock.elapsedTime;
    const cycle = (t / CYCLE_SECONDS) % 1; // bucle infinito de color

    this._forces();

    for (const o of this.nodeObjs.values()) {
      if (!o.group.visible) continue;
      const g = o.target;
      const br = 0.9;
      o.group.position.set(
        g.x + Math.sin(t * 0.5 + g.phase) * br,
        g.y + Math.cos(t * 0.4 + g.phase * 1.3) * br,
        g.z + Math.sin(t * 0.3 + g.phase * 0.7) * br,
      );
      // ── color cíclico fosforescente ──
      const h = (o.baseH + cycle + g.phase * 0.012) % 1;
      o.hue = h;
      const hot = o.node.id === this.hoverId || o.node.id === this.selectedId;
      o.sphere.material.emissive.setHSL(h, 1, 0.5);
      o.sphere.material.color.setHSL(h, 1, 0.16);
      o.shell.material.uniforms.uColor.value.setHSL(h, 1, 0.62);
      o.wire.material.color.setHSL(h, 1, 0.5);
      // tamaño / definición
      const s = g.size * (hot ? 1.5 : 1);
      o.sphere.scale.lerp(new THREE.Vector3(s, s, s), 0.15);
      o.sphere.material.emissiveIntensity += ((hot ? 0.85 : 0.28) - o.sphere.material.emissiveIntensity) * 0.12;
      o.shell.scale.setScalar(s * 1.62 * (1 + Math.sin(t * 1.6 + g.phase) * 0.04));
      o.shell.material.uniforms.uOpacity.value += ((hot ? 1.8 : 1.1) - o.shell.material.uniforms.uOpacity.value) * 0.1;
      o.wire.scale.setScalar(s * 1.42);
      o.wire.material.opacity += ((hot ? 0.4 : 0.15) - o.wire.material.opacity) * 0.1;
      // anillo orbital girando, del color del ciclo
      if (o.ring) {
        o.ring.rotation.z += dt * o.ring.userData.spin;
        o.ring.material.color.setHSL(h, 1, 0.6);
        o.ring.material.opacity = 0.55 + Math.sin(t * 2.2 + g.phase) * 0.25;
        const rs = s * (o.node.kind === 'person' ? 2.5 : 2.2);
        o.ring.scale.setScalar(rs);
      }
      // etiquetas
      const dist = this.camera.position.distanceTo(o.group.position);
      const want = this.labelsOn || hot || o.node.degree >= 5 || dist < 85;
      const op = want ? Math.max(0, Math.min(1, (260 - dist) / 120 + 0.35)) : 0;
      o.label.material.opacity += (op - o.label.material.opacity) * 0.2;
      o.label.visible = o.label.material.opacity > 0.02;
    }

    this._updateEdgePositions();
    this._updateEdgeColors();
    this._updatePulses(dt);

    if (this.pointer.x > -1.5) this._setHover(this._pick());

    // rejilla viva: se desliza y pulsa como un piso de datos
    if (this.grid) {
      this.grid.position.z = (t * 4) % (700 / 46);
      this.grid.material.opacity = 0.11 + Math.sin(t * 1.4) * 0.035;
    }
    // reanudar giro cinemático tras 4 s sin tocar
    if (!this.controls.autoRotate && performance.now() - this._lastInteract > 4000) {
      this.controls.autoRotate = true;
    }

    if (this._camTween) {
      this._camTween.t = Math.min(1, this._camTween.t + dt * 1.6);
      const e = 1 - Math.pow(1 - this._camTween.t, 3);
      this.controls.target.lerp(this._camTween.target, e * 0.12 + 0.02);
      this.camera.position.lerp(this._camTween.pos, e * 0.06 + 0.01);
      if (this._camTween.t >= 1 && this.controls.target.distanceTo(this._camTween.target) < 2) this._camTween = null;
    }

    this.controls.update();
    this.composer.render();
  }
}
