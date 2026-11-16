import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { Model, ModelMesh } from './model';
import type { Viewport } from './viewport';
import { dotTexture } from './vertexEditor';
import { findChains, type Chain } from './fillet';

const VERTEX_NEAR = 12; // px – narożnik tak blisko kursora ma pierwszeństwo przed rantem
const VERTEX_ON_EDGE = 4; // px – punkt w środku gładkiego rantu (np. na okręgu walca) – tylko przy samym kursorze
const EDGE_NEAR = 10; // px – jak blisko rantu trzeba być, żeby się do niego przykleić
const VERTEX_FAR = 25; // px – gdy w pobliżu nie ma rantu, wierzchołek łapany z większej odległości
const COLOR = 0xffd84f;
const HOVER = 0x4fe36c;

/** Wierzchołek bryły – pomiar śledzi go, gdy bryła lub punkt się przesuwa. */
interface VertexRef {
  kind: 'vertex';
  meshId: number;
  index: number;
  world: THREE.Vector3; // ostatnia znana pozycja (gdy bryłę usunięto)
}

/** Rant bryły (łamana po jej wierzchołkach) z miejscem kliknięcia. */
interface EdgeRef {
  kind: 'edge';
  meshId: number;
  indices: number[];
  closed: boolean;
  seg: number; // odcinek, w który kliknięto
  t: number; // położenie na tym odcinku 0..1
  world: THREE.Vector3[]; // ostatnio znana łamana
}

type Ref = VertexRef | EdgeRef;

/**
 * Miarka. Mierzy odległość między:
 *  - dwoma wierzchołkami,
 *  - wierzchołkiem a rantem (linia prostopadła do rantu),
 *  - dwoma rantami (linia prostopadła do obu – najkrótsza odległość; przy rantach
 *    równoległych przechodzi przez miejsce kliknięcia na pierwszym rancie).
 * Wierzchołki i ranty dowolnych brył; pomiar śledzi przesuwanie brył i punktów.
 */
export class MeasureTool {
  active = false;
  private hover: Ref | null = null;
  private start: Ref | null = null;
  private result: { a: Ref; b: Ref } | null = null;
  private chainCache = new Map<ModelMesh, { geometry: THREE.BufferGeometry; matrix: string; chains: Chain[] }>();

  private line: THREE.Line;
  private ends: THREE.Points;
  private marker: THREE.Points;
  private edgeLines = new THREE.Group();
  private edgeMaterials: LineMaterial[] = [];
  private edgeKey = '';
  private label: HTMLDivElement;
  private listeners = new Set<(text: string) => void>();

  constructor(private model: Model, private view: Viewport) {
    const mat = { depthTest: false, transparent: true };
    this.line = new THREE.Line(
      new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(6), 3)),
      new THREE.LineBasicMaterial({ color: COLOR, ...mat }),
    );
    this.ends = new THREE.Points(
      new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(6), 3)),
      new THREE.PointsMaterial({ color: COLOR, size: 10, sizeAttenuation: false, map: dotTexture(), alphaTest: 0.5, ...mat }),
    );
    this.marker = new THREE.Points(
      new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(3), 3)),
      new THREE.PointsMaterial({ color: HOVER, size: 14, sizeAttenuation: false, map: dotTexture(), alphaTest: 0.5, ...mat }),
    );
    for (const o of [this.line, this.ends, this.marker]) {
      o.renderOrder = 30;
      o.visible = false;
      o.frustumCulled = false;
      o.raycast = () => {};
      view.scene.add(o);
    }
    view.scene.add(this.edgeLines);
    this.label = document.createElement('div');
    this.label.className = 'measure-label';
    this.label.hidden = true;
    view.container.appendChild(this.label);
    view.onFrame(() => this.update());
  }

  /** Wynik pomiaru dla paska stanu. */
  onResult(fn: (text: string) => void) {
    this.listeners.add(fn);
  }

  setActive(on: boolean) {
    this.active = on;
    if (!on) {
      this.hover = null;
      this.start = null;
    }
    this.chainCache.clear();
  }

  /** Esc: najpierw anuluje rozpoczęty odcinek / usuwa wynik; zwraca false, gdy nie było czego anulować. */
  cancel(): boolean {
    if (this.start) {
      this.start = null;
      return true;
    }
    if (this.result) {
      this.result = null;
      return true;
    }
    return false;
  }

  pointerMove(e: PointerEvent) {
    this.hover = this.pick(e);
  }

  /** Kliknięcie: początek albo koniec pomiaru. Zwraca true, jeśli trafiono w wierzchołek lub rant. */
  pointerDown(e: PointerEvent): boolean {
    const ref = this.pick(e);
    if (!ref) return false;
    if (!this.start) {
      this.start = ref;
      this.result = null;
    } else if (!sameRef(ref, this.start)) {
      this.result = { a: this.start, b: ref };
      this.start = null;
      const m = this.measure(this.result.a, this.result.b);
      const kinds = `${kindName(this.result.a)} ↔ ${kindName(this.result.b)}`;
      this.listeners.forEach((fn) => fn(`Miarka (${kinds}${m.perpendicular ? ', prostopadle' : ''}): ${describe(m.p, m.q)}`));
    }
    return true;
  }

  // ---------- obliczenia ----------

  /** Końce odcinka pomiarowego dla dwóch wskazań. */
  private measure(a: Ref, b: Ref): { p: THREE.Vector3; q: THREE.Vector3; perpendicular: boolean } {
    if (a.kind === 'vertex' && b.kind === 'vertex') {
      return { p: this.vertexPos(a), q: this.vertexPos(b), perpendicular: false };
    }
    if (a.kind === 'vertex' && b.kind === 'edge') {
      const p = this.vertexPos(a);
      return { p, q: closestOnPolyline(p, this.polyline(b), b.closed), perpendicular: true };
    }
    if (a.kind === 'edge' && b.kind === 'vertex') {
      const q = this.vertexPos(b);
      return { p: closestOnPolyline(q, this.polyline(a), a.closed), q, perpendicular: true };
    }
    const ea = a as EdgeRef, eb = b as EdgeRef;
    const [p, q] = edgeToEdge(this.polyline(ea), ea.closed, this.pickedPoint(ea), this.polyline(eb), eb.closed);
    return { p, q, perpendicular: true };
  }

  private meshById(id: number) {
    return this.model.objects.find((o) => o.userData.id === id);
  }

  private vertexPos(ref: VertexRef): THREE.Vector3 {
    const mesh = this.meshById(ref.meshId);
    const pos = mesh?.geometry.getAttribute('position');
    if (mesh && pos && ref.index < pos.count) {
      mesh.updateMatrixWorld();
      ref.world.fromBufferAttribute(pos, ref.index).applyMatrix4(mesh.matrixWorld);
    }
    return ref.world.clone();
  }

  private polyline(ref: EdgeRef): THREE.Vector3[] {
    const mesh = this.meshById(ref.meshId);
    const pos = mesh?.geometry.getAttribute('position');
    if (mesh && pos && ref.indices.every((i) => i < pos.count)) {
      mesh.updateMatrixWorld();
      ref.world = ref.indices.map((i) => new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld));
    }
    return ref.world.map((p) => p.clone());
  }

  private pickedPoint(ref: EdgeRef): THREE.Vector3 {
    const pts = this.polyline(ref);
    return pts[ref.seg].clone().lerp(pts[(ref.seg + 1) % pts.length], ref.t);
  }

  /** Punkt, który pokazuje znacznik pod kursorem. */
  private refPoint(ref: Ref) {
    return ref.kind === 'vertex' ? this.vertexPos(ref) : this.pickedPoint(ref);
  }

  // ---------- rysowanie ----------

  private update() {
    const hover = this.active ? this.hover : null;
    let m: ReturnType<MeasureTool['measure']> | null = null;
    if (this.start && hover && !sameRef(this.start, hover)) m = this.measure(this.start, hover); // "na gumce"
    else if (!this.start && this.result) m = this.measure(this.result.a, this.result.b);

    // znacznik pod kursorem (przy rancie: punkt na rancie, w który trafi pomiar)
    this.marker.visible = !!hover;
    if (hover) setPoints(this.marker, [this.start && m ? m.q : this.refPoint(hover)]);

    const startPoint = this.start ? (m ? m.p : this.refPoint(this.start)) : null;
    this.ends.visible = !!(m || startPoint);
    if (m) setPoints(this.ends, [m.p, m.q]);
    else if (startPoint) setPoints(this.ends, [startPoint, startPoint]);
    this.line.visible = !!m;
    if (m) setPoints(this.line, [m.p, m.q]);

    // podświetlone ranty: wskazany pod kursorem, wybrany jako początek, ranty wyniku
    const edges: { ref: EdgeRef; color: number; width: number }[] = [];
    if (hover?.kind === 'edge') edges.push({ ref: hover, color: HOVER, width: 4 });
    if (this.start?.kind === 'edge') edges.push({ ref: this.start, color: COLOR, width: 3 });
    if (!this.start && this.result) {
      for (const r of [this.result.a, this.result.b]) if (r.kind === 'edge') edges.push({ ref: r, color: COLOR, width: 2 });
    }
    this.drawEdges(edges);

    // etykieta w połowie odcinka
    if (m) {
      const mid = m.p.clone().lerp(m.q, 0.5);
      const s = this.view.toScreen(mid);
      const { width, height } = this.view.size;
      this.label.hidden = s.z > 1 || s.x < 0 || s.y < 0 || s.x > width || s.y > height;
      this.label.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, -130%)`;
      const d = m.q.clone().sub(m.p);
      const html = `<b>${fmt(d.length())} mm${m.perpendicular ? ' ⊥' : ''}</b>` +
        `<span>ΔX ${fmt(Math.abs(d.x))} · ΔY ${fmt(Math.abs(d.y))} · ΔZ ${fmt(Math.abs(d.z))}</span>`;
      if (this.label.innerHTML !== html) this.label.innerHTML = html;
    } else {
      this.label.hidden = true;
    }
  }

  private drawEdges(list: { ref: EdgeRef; color: number; width: number }[]) {
    const { width, height } = this.view.size;
    const key = list.map((e) => `${e.ref.meshId}:${e.ref.indices[0]}:${e.ref.indices.length}:${e.color}`).join('|') +
      `@${list.map((e) => this.polyline(e.ref)[0].toArray().map((v) => v.toFixed(3)).join(',')).join(';')}`;
    if (key === this.edgeKey) {
      this.edgeMaterials.forEach((mat) => mat.resolution.set(width, height));
      return;
    }
    this.edgeKey = key;
    this.edgeLines.children.slice().forEach((o) => {
      this.edgeLines.remove(o);
      (o as LineSegments2).geometry.dispose();
    });
    this.edgeMaterials.forEach((mat) => mat.dispose());
    this.edgeMaterials = [];
    for (const { ref, color, width: lw } of list) {
      const pts = this.polyline(ref);
      const n = ref.closed ? pts.length : pts.length - 1;
      const pos: number[] = [];
      for (let i = 0; i < n; i++) pos.push(...pts[i].toArray(), ...pts[(i + 1) % pts.length].toArray());
      const mat = new LineMaterial({ color, linewidth: lw, depthTest: false, transparent: true });
      mat.resolution.set(width, height);
      this.edgeMaterials.push(mat);
      const line = new LineSegments2(new LineSegmentsGeometry().setPositions(pos), mat);
      line.renderOrder = 29;
      line.raycast = () => {};
      this.edgeLines.add(line);
    }
  }

  // ---------- wskazywanie ----------

  private chainsOf(mesh: ModelMesh): Chain[] {
    mesh.updateMatrixWorld(true);
    const matrix = mesh.matrixWorld.elements.join(',');
    const c = this.chainCache.get(mesh);
    if (c && c.geometry === mesh.geometry && c.matrix === matrix) return c.chains;
    const chains = findChains(mesh);
    this.chainCache.set(mesh, { geometry: mesh.geometry, matrix, chains });
    return chains;
  }

  /**
   * Co jest pod kursorem: wierzchołek tuż obok kursora ma pierwszeństwo, potem rant,
   * na końcu wierzchołek trochę dalej. Widoczne mają pierwszeństwo przed zasłoniętymi.
   */
  private pick(e: PointerEvent): Ref | null {
    const mouse = new THREE.Vector2().copy(this.view.localPoint(e));
    const vertex = this.pickVertex(mouse);
    if (vertex) {
      // punkty wewnątrz gładkiego rantu (okrąg walca) są gęsto – nie mogą "zasłaniać" samego rantu
      const mesh = this.meshById(vertex.ref.meshId);
      const inner = mesh ? this.innerVertices(mesh).has(vertex.ref.index) : false;
      if (vertex.d <= (inner ? VERTEX_ON_EDGE : VERTEX_NEAR)) return vertex.ref;
    }
    const edge = this.pickEdge(mouse);
    if (edge) return edge;
    return vertex && vertex.d <= VERTEX_FAR ? vertex.ref : null;
  }

  /** Wierzchołki leżące w środku gładkich rantów (nie narożniki). */
  private innerVertices(mesh: ModelMesh): Set<number> {
    const set = new Set<number>();
    for (const ch of this.chainsOf(mesh)) {
      const from = ch.closed ? 0 : 1, to = ch.closed ? ch.indices.length : ch.indices.length - 1;
      for (let i = from; i < to; i++) set.add(ch.indices[i]);
    }
    return set;
  }

  private pickVertex(mouse: THREE.Vector2): { ref: VertexRef; d: number } | null {
    const cands: { mesh: ModelMesh; i: number; d: number; w: THREE.Vector3 }[] = [];
    const w = new THREE.Vector3();
    for (const mesh of this.model.objects) {
      mesh.updateMatrixWorld();
      const pos = mesh.geometry.getAttribute('position');
      for (let i = 0; i < pos.count; i++) {
        w.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
        const s = this.view.toScreen(w);
        if (s.z > 1) continue;
        const d = Math.hypot(s.x - mouse.x, s.y - mouse.y);
        if (d <= VERTEX_FAR) cands.push({ mesh, i, d, w: w.clone() });
      }
    }
    if (cands.length === 0) return null;
    cands.sort((a, b) => a.d - b.d);
    const best = this.view.mode === 'top'
      ? cands.reduce((a, b) => (Math.abs(a.d - b.d) < 1.5 && b.w.z > a.w.z ? b : a)) // z góry: wyższy punkt
      : cands.find((c) => this.visible(c.w)) ?? cands[0];
    return { ref: { kind: 'vertex', meshId: best.mesh.userData.id, index: best.i, world: best.w }, d: best.d };
  }

  private pickEdge(mouse: THREE.Vector2): EdgeRef | null {
    const cands: { mesh: ModelMesh; chain: Chain; seg: number; t: number; d: number; p: THREE.Vector3 }[] = [];
    for (const mesh of this.model.objects) {
      for (const chain of this.chainsOf(mesh)) {
        const pts = chain.points;
        const n = chain.closed ? pts.length : pts.length - 1;
        let best: (typeof cands)[number] | null = null;
        for (let i = 0; i < n; i++) {
          const a = pts[i], b = pts[(i + 1) % pts.length];
          const sa = this.view.toScreen(a), sb = this.view.toScreen(b);
          if (sa.z > 1 || sb.z > 1) continue;
          const A = new THREE.Vector2(sa.x, sa.y), B = new THREE.Vector2(sb.x, sb.y);
          const ab = B.clone().sub(A);
          const t = ab.lengthSq() > 0 ? THREE.MathUtils.clamp(mouse.clone().sub(A).dot(ab) / ab.lengthSq(), 0, 1) : 0;
          const d = A.clone().addScaledVector(ab, t).distanceTo(mouse);
          if (d <= EDGE_NEAR && (!best || d < best.d)) best = { mesh, chain, seg: i, t, d, p: a.clone().lerp(b, t) };
        }
        if (best) cands.push(best);
      }
    }
    if (!cands.length) return null;
    cands.sort((a, b) => a.d - b.d);
    const c = cands.find((x) => this.visible(x.p)) ?? cands[0];
    return {
      kind: 'edge', meshId: c.mesh.userData.id, indices: c.chain.indices.slice(), closed: c.chain.closed,
      seg: c.seg, t: c.t, world: c.chain.points.map((p) => p.clone()),
    };
  }

  private visible(p: THREE.Vector3) {
    const cam = this.view.camera.getWorldPosition(new THREE.Vector3());
    const dir = p.clone().sub(cam);
    const dist = dir.length();
    const hit = new THREE.Raycaster(cam, dir.normalize()).intersectObjects(this.model.objects, false)[0];
    return !hit || hit.distance > dist - 0.05 * Math.max(1, dist / 100);
  }
}

// ---------- geometria ----------

function sameRef(a: Ref, b: Ref) {
  if (a.kind !== b.kind || a.meshId !== b.meshId) return false;
  if (a.kind === 'vertex') return a.index === (b as VertexRef).index;
  const e = b as EdgeRef;
  return a.indices.length === e.indices.length && a.indices.every((v, i) => v === e.indices[i]);
}

function kindName(r: Ref) {
  return r.kind === 'vertex' ? 'wierzchołek' : 'rant';
}

/** Najbliższe punkty dwóch odcinków (Ericson, "Real-Time Collision Detection"). */
function closestSegSeg(p1: THREE.Vector3, q1: THREE.Vector3, p2: THREE.Vector3, q2: THREE.Vector3) {
  const d1 = q1.clone().sub(p1), d2 = q2.clone().sub(p2), r = p1.clone().sub(p2);
  const a = d1.dot(d1), e = d2.dot(d2), f = d2.dot(r);
  let s: number, t: number;
  if (a < 1e-12 && e < 1e-12) {
    s = t = 0;
  } else if (a < 1e-12) {
    s = 0;
    t = THREE.MathUtils.clamp(f / e, 0, 1);
  } else {
    const c = d1.dot(r);
    if (e < 1e-12) {
      t = 0;
      s = THREE.MathUtils.clamp(-c / a, 0, 1);
    } else {
      const b = d1.dot(d2), denom = a * e - b * b;
      s = denom > 1e-12 ? THREE.MathUtils.clamp((b * f - c * e) / denom, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = THREE.MathUtils.clamp(-c / a, 0, 1);
      } else if (t > 1) {
        t = 1;
        s = THREE.MathUtils.clamp((b - c) / a, 0, 1);
      }
    }
  }
  const c1 = p1.clone().addScaledVector(d1, s), c2 = p2.clone().addScaledVector(d2, t);
  const parallel = d1.clone().cross(d2).lengthSq() < 1e-6 * a * e;
  return { c1, c2, dist: c1.distanceTo(c2), parallel };
}

function closestOnSegment(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3) {
  return new THREE.Line3(a, b).closestPointToPoint(p, true, new THREE.Vector3());
}

/** Najbliższy punkt łamanej (rantu) do punktu – stopa prostopadłej. */
function closestOnPolyline(p: THREE.Vector3, pts: THREE.Vector3[], closed: boolean) {
  let best = pts[0].clone(), bestD = Infinity;
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) {
    const c = closestOnSegment(p, pts[i], pts[(i + 1) % pts.length]);
    const d = c.distanceToSquared(p);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

/**
 * Odcinek prostopadły do obu rantów (najkrótsza odległość). Gdy najbliższe odcinki rantów są
 * równoległe, odległość jest wszędzie ta sama – prowadzimy linię przez miejsce kliknięcia na rancie A.
 */
function edgeToEdge(a: THREE.Vector3[], aClosed: boolean, picked: THREE.Vector3, b: THREE.Vector3[], bClosed: boolean): [THREE.Vector3, THREE.Vector3] {
  const na = aClosed ? a.length : a.length - 1, nb = bClosed ? b.length : b.length - 1;
  let best: ReturnType<typeof closestSegSeg> & { i: number; j: number } | null = null;
  for (let i = 0; i < na; i++) {
    for (let j = 0; j < nb; j++) {
      const r = closestSegSeg(a[i], a[(i + 1) % a.length], b[j], b[(j + 1) % b.length]);
      if (!best || r.dist < best.dist - 1e-9) best = { ...r, i, j };
    }
  }
  if (!best) return [a[0].clone(), b[0].clone()];
  if (best.parallel) {
    const b0 = b[best.j], b1 = b[(best.j + 1) % b.length];
    const onA = closestOnPolyline(picked, a, aClosed);
    const q = closestOnSegment(onA, b0, b1);
    // tylko jeśli stopa prostopadłej z miejsca kliknięcia trafia w rant B (a nie w jego koniec)
    if (Math.abs(q.distanceTo(onA) - best.dist) < 1e-3) return [onA, q];
  }
  return [best.c1, best.c2];
}

function setPoints(obj: THREE.Line | THREE.Points, pts: THREE.Vector3[]) {
  const attr = obj.geometry.getAttribute('position') as THREE.BufferAttribute;
  pts.forEach((p, i) => attr.setXYZ(i, p.x, p.y, p.z));
  attr.needsUpdate = true;
}

const fmt = (v: number) => (Math.round(v * 100) / 100).toFixed(2);

function describe(a: THREE.Vector3, b: THREE.Vector3) {
  const d = b.clone().sub(a);
  return `${fmt(d.length())} mm  (ΔX ${fmt(Math.abs(d.x))}  ΔY ${fmt(Math.abs(d.y))}  ΔZ ${fmt(Math.abs(d.z))})`;
}
