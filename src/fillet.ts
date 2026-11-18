import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { Model, ModelMesh } from './model';
import type { Viewport } from './viewport';
import { applyShapes, type RawMesh } from './csg';
import { lenText } from './units';
import { t } from './i18n';

/**
 * Zaokrąglanie i fazowanie rantów.
 *
 * Rant to ciąg krawędzi, w których stykają się ściany pod wyraźnym kątem (np. krawędź
 * sześcianu albo cały okrąg na brzegu podstawy walca). Wzdłuż rantu budujemy "wycinak"
 * o przekroju: narożnik minus łuk (albo minus prosta – faza). Rant wypukły → wycinak
 * odejmujemy; rant wklęsły (wewnętrzny narożnik) → ten sam kształt dodajemy (wypełnienie).
 * Operację liczy Manifold, więc wynik jest zawsze szczelny.
 */

export type FilletKind = 'round' | 'chamfer';

/** Rant: łamana wzdłuż krawędzi bryły (układ świata). */
export interface Chain {
  points: THREE.Vector3[];
  /** Numery wierzchołków bryły tworzących rant (w tej samej kolejności co `points`). */
  indices: number[];
  closed: boolean;
  /** Dla każdego odcinka i: normalne ścian po lewej (1) i prawej (2) stronie oraz kierunki w głąb tych ścian. */
  segs: { n1: THREE.Vector3; n2: THREE.Vector3; d1: THREE.Vector3; d2: THREE.Vector3; depth: number }[];
  convex: boolean;
}

interface MeshChains {
  mesh: ModelMesh;
  geometry: THREE.BufferGeometry;
  matrix: string;
  chains: Chain[];
}

const FEATURE_COS = Math.cos(THREE.MathUtils.degToRad(30)); // ściany pod kątem > 30° tworzą rant
const TURN_COS = Math.cos(THREE.MathUtils.degToRad(50)); // rant ciągnie się dalej, jeśli skręca o < 50°
const PICK_PX = 9;

export class FilletTool {
  active = false;
  radius = 2;
  kind: FilletKind = 'round';
  segments = 8;

  private cache = new Map<ModelMesh, MeshChains>();
  private target: ModelMesh | null = null;
  private selected = new Set<Chain>();
  private hover: { mesh: ModelMesh; chain: Chain } | null = null;
  private lines = new THREE.Group();
  private materials: LineMaterial[] = [];
  private listeners = new Set<() => void>();
  private messageListeners = new Set<(t: string) => void>();
  private busy = false;
  // podgląd: wynik liczony w tle i pokazany zamiast oryginału (do czasu zatwierdzenia)
  private preview: THREE.Mesh | null = null;
  private previewTimer = 0;
  private previewSeq = 0;
  /** Stan podglądu dla panelu: komunikat, ostrzeżenie albo błąd. */
  previewInfo: { text: string; warn: boolean } | null = null;

  constructor(private model: Model, private view: Viewport) {
    this.lines.name = '__filletLines';
    view.scene.add(this.lines);
    view.onFrame(() => {
      const { width, height } = view.size;
      this.materials.forEach((m) => m.resolution.set(width, height));
    });
  }

  onChange(fn: () => void) {
    this.listeners.add(fn);
  }

  onMessage(fn: (t: string) => void) {
    this.messageListeners.add(fn);
  }

  private emit() {
    this.listeners.forEach((fn) => fn());
  }

  private message(t: string) {
    this.messageListeners.forEach((fn) => fn(t));
  }

  get selectedCount() {
    return this.selected.size;
  }

  get targetName() {
    return this.target?.name ?? null;
  }

  setActive(on: boolean) {
    this.active = on;
    this.clear();
    if (on) this.message(t.fillet.start);
  }

  clear() {
    this.selected.clear();
    clearTimeout(this.previewTimer);
    this.previewSeq++; // wynik liczony w tle nie zostanie już pokazany
    this.previewInfo = null;
    this.hidePreview();
    this.target = null;
    this.hover = null;
    this.cache.clear();
    this.redraw();
    this.emit();
  }

  /** Zmiana promienia / rodzaju / gładkości – przelicz podgląd. */
  paramsChanged() {
    this.schedulePreview();
    this.emit();
  }

  /** Esc: najpierw odznacza ranty; zwraca false, gdy nie było nic zaznaczone. */
  back(): boolean {
    if (this.selected.size === 0) return false;
    this.clear();
    return true;
  }

  /** Po zmianie modelu (np. Ctrl+Z) zaznaczenie mogło stracić sens. */
  validate() {
    if (!this.active) return;
    for (const [mesh, c] of this.cache) {
      if (!this.model.objects.includes(mesh) || mesh.geometry !== c.geometry || matrixKey(mesh) !== c.matrix) {
        this.clear();
        return;
      }
    }
  }

  pointerMove(e: PointerEvent) {
    const h = this.pick(e);
    if (h?.chain === this.hover?.chain) return;
    this.hover = h;
    this.redraw();
  }

  pointerDown(e: PointerEvent) {
    const h = this.pick(e);
    if (!h) return;
    if (this.target !== h.mesh) {
      this.selected.clear(); // ranty zaokrąglamy na jednej bryle naraz
      this.target = h.mesh;
    }
    if (this.selected.has(h.chain)) this.selected.delete(h.chain);
    else this.selected.add(h.chain);
    if (this.selected.size === 0) this.target = null;
    this.redraw();
    this.schedulePreview();
    this.emit();
  }

  /** Liczy wynik dla bieżących rantów i ustawień (bez zmiany modelu). */
  private async compute(): Promise<{ g: THREE.BufferGeometry | null; tooBig: number }> {
    const target = this.target!;
    const r = this.radius;
    if (!(r > 0)) throw new Error(t.fillet.radiusPositive);
    const segs = this.kind === 'chamfer' ? 1 : Math.max(2, Math.round(this.segments) || 2);
    const cut: RawMesh[] = [];
    const add: RawMesh[] = [];
    let tooBig = 0;
    for (const ch of this.selected) {
      const res = buildTool(ch, r, segs);
      if (res.tooBig) tooBig++;
      (ch.convex ? cut : add).push(res.mesh);
    }
    return { g: await applyShapes(target, cut, add), tooBig };
  }

  private tooBigText(n: number) {
    return t.fillet.tooBig(n, this.kind === 'round');
  }

  /** Wykonuje zaokrąglenie / fazowanie zaznaczonych rantów. */
  async apply(): Promise<boolean> {
    if (!this.target || this.selected.size === 0 || this.busy) return false;
    const target = this.target;
    const r = this.radius;
    this.busy = true;
    this.message(t.fillet.computing);
    try {
      const { g, tooBig } = await this.compute();
      if (!this.model.objects.includes(target)) return false;
      if (!g) {
        this.message(t.fillet.empty);
        return false;
      }
      this.hidePreview();
      this.model.checkpoint();
      this.model.replaceGeometry(target, g);
      target.userData.kind = 'mesh';
      const n = this.selected.size;
      this.clear();
      this.model.select(target);
      this.message(t.fillet.done(this.kind === 'round', n, lenText(r), tooBig ? this.tooBigText(tooBig) : null));
      return true;
    } catch (err) {
      this.message(t.fillet.failed((err as Error).message));
      return false;
    } finally {
      this.busy = false;
    }
  }

  // ---------- podgląd ----------

  /** Przelicza podgląd chwilę po ostatniej zmianie (żeby nie liczyć przy każdym wpisanym znaku). */
  private schedulePreview() {
    clearTimeout(this.previewTimer);
    const seq = ++this.previewSeq;
    if (!this.target || this.selected.size === 0) {
      this.hidePreview();
      this.previewInfo = null;
      return;
    }
    this.previewTimer = window.setTimeout(async () => {
      const target = this.target;
      if (!target) return;
      try {
        const { g, tooBig } = await this.compute();
        if (seq !== this.previewSeq || target !== this.target) {
          g?.dispose();
          return; // w międzyczasie coś się zmieniło
        }
        if (!g) {
          this.hidePreview();
          this.previewInfo = { text: t.fillet.previewEmpty, warn: true };
        } else {
          this.showPreview(target, g);
          this.previewInfo = tooBig
            ? { text: t.fillet.previewWarn(this.tooBigText(tooBig)), warn: true }
            : { text: t.fillet.previewOk, warn: false };
        }
      } catch (err) {
        if (seq !== this.previewSeq) return;
        this.hidePreview();
        this.previewInfo = { text: t.fillet.previewError((err as Error).message), warn: true };
      }
      this.redraw();
      this.emit();
    }, 150);
  }

  /** Pokazuje wynik w miejscu bryły (oryginał ukryty do czasu zatwierdzenia lub anulowania). */
  private showPreview(target: ModelMesh, g: THREE.BufferGeometry) {
    this.hidePreview();
    const mesh = new THREE.Mesh(g, target.material.clone());
    target.updateMatrixWorld(true);
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(target.matrixWorld);
    mesh.raycast = () => {};
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(g, 20), new THREE.LineBasicMaterial({ color: 0xffffff }));
    edges.raycast = () => {};
    mesh.add(edges);
    mesh.name = '__filletPreview';
    this.view.scene.add(mesh);
    this.preview = mesh;
    target.visible = false;
  }

  private hidePreview() {
    if (this.preview) {
      this.preview.removeFromParent();
      this.preview.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        (m.material as THREE.Material | undefined)?.dispose();
      });
      this.preview = null;
    }
    if (this.target) this.target.visible = true;
    this.model.objects.forEach((o) => (o.visible = true));
  }

  // ---------- wyszukiwanie rantów ----------

  private chainsOf(mesh: ModelMesh): MeshChains {
    const c = this.cache.get(mesh);
    if (c && c.geometry === mesh.geometry && c.matrix === matrixKey(mesh)) return c;
    const res: MeshChains = { mesh, geometry: mesh.geometry, matrix: matrixKey(mesh), chains: findChains(mesh) };
    this.cache.set(mesh, res);
    return res;
  }

  /** Rant najbliżej kursora (w pikselach); widoczne mają pierwszeństwo przed zasłoniętymi. */
  private pick(e: PointerEvent): { mesh: ModelMesh; chain: Chain } | null {
    const mouse = this.view.localPoint(e);
    const m2 = new THREE.Vector2(mouse.x, mouse.y);
    const cands: { mesh: ModelMesh; chain: Chain; d: number; p: THREE.Vector3 }[] = [];
    for (const mesh of this.model.objects) {
      for (const chain of this.chainsOf(mesh).chains) {
        const pts = chain.points;
        const n = chain.closed ? pts.length : pts.length - 1;
        let best = Infinity, bestP: THREE.Vector3 | null = null;
        for (let i = 0; i < n; i++) {
          const a = pts[i], b = pts[(i + 1) % pts.length];
          const sa = this.view.toScreen(a), sb = this.view.toScreen(b);
          if (sa.z > 1 || sb.z > 1) continue;
          const A = new THREE.Vector2(sa.x, sa.y), B = new THREE.Vector2(sb.x, sb.y);
          const ab = B.clone().sub(A);
          const t = ab.lengthSq() > 0 ? THREE.MathUtils.clamp(m2.clone().sub(A).dot(ab) / ab.lengthSq(), 0, 1) : 0;
          const d = A.clone().addScaledVector(ab, t).distanceTo(m2);
          if (d < best) {
            best = d;
            bestP = a.clone().lerp(b, t);
          }
        }
        if (best <= PICK_PX && bestP) cands.push({ mesh, chain, d: best, p: bestP });
      }
    }
    if (!cands.length) return null;
    cands.sort((a, b) => a.d - b.d);
    const vis = cands.find((c) => this.visible(c.p));
    const c = vis ?? cands[0];
    return { mesh: c.mesh, chain: c.chain };
  }

  private visible(p: THREE.Vector3) {
    const cam = this.view.camera.getWorldPosition(new THREE.Vector3());
    const dir = p.clone().sub(cam);
    const dist = dir.length();
    const hit = new THREE.Raycaster(cam, dir.normalize()).intersectObjects(this.model.objects, false)[0];
    return !hit || hit.distance > dist - 0.05 * Math.max(1, dist / 100);
  }

  // ---------- rysowanie ----------

  private redraw() {
    this.lines.children.slice().forEach((o) => {
      this.lines.remove(o);
      (o as LineSegments2).geometry.dispose();
    });
    this.materials.forEach((m) => m.dispose());
    this.materials = [];
    if (!this.active) return;
    const draw = (chains: Chain[], color: number, width: number) => {
      if (!chains.length) return;
      const pos: number[] = [];
      for (const ch of chains) {
        const n = ch.closed ? ch.points.length : ch.points.length - 1;
        for (let i = 0; i < n; i++) pos.push(...ch.points[i].toArray(), ...ch.points[(i + 1) % ch.points.length].toArray());
      }
      const geo = new LineSegmentsGeometry().setPositions(pos);
      const mat = new LineMaterial({ color, linewidth: width, depthTest: false, transparent: true });
      const { width: w, height: h } = this.view.size;
      mat.resolution.set(w, h);
      this.materials.push(mat);
      const line = new LineSegments2(geo, mat);
      line.renderOrder = 40;
      line.raycast = () => {};
      this.lines.add(line);
    };
    if (this.hover && !this.selected.has(this.hover.chain)) draw([this.hover.chain], 0x4fe36c, 4);
    draw([...this.selected], 0xff8a2a, this.preview ? 2 : 5); // przy podglądzie cieńsze – widać wynik
  }
}

function matrixKey(mesh: ModelMesh) {
  mesh.updateMatrixWorld(true);
  return mesh.matrixWorld.elements.map((v) => v.toFixed(5)).join(',');
}

/** Znajduje ranty bryły: krawędzie między ścianami pod kątem, połączone w ciągi. */
export function findChains(mesh: ModelMesh): Chain[] {
  mesh.updateMatrixWorld(true);
  const src = mesh.geometry.getAttribute('position');
  const P: THREE.Vector3[] = [];
  for (let i = 0; i < src.count; i++) P.push(new THREE.Vector3().fromBufferAttribute(src, i).applyMatrix4(mesh.matrixWorld));
  const index = Array.from(mesh.geometry.getIndex()!.array);
  if (mesh.matrixWorld.determinant() < 0) {
    for (let t = 0; t < index.length; t += 3) [index[t + 1], index[t + 2]] = [index[t + 2], index[t + 1]];
  }
  const nT = index.length / 3;
  const normals: THREE.Vector3[] = [];
  for (let t = 0; t < nT; t++) {
    const a = P[index[t * 3]], b = P[index[t * 3 + 1]], c = P[index[t * 3 + 2]];
    normals.push(b.clone().sub(a).cross(c.clone().sub(a)).normalize());
  }

  // krawędź skierowana a→b → trójkąt, w którym występuje
  const directed = new Map<string, number>();
  for (let t = 0; t < nT; t++) {
    for (let k = 0; k < 3; k++) directed.set(`${index[t * 3 + k]}_${index[t * 3 + ((k + 1) % 3)]}`, t);
  }
  const third = (t: number, a: number, b: number) => [0, 1, 2].map((k) => index[t * 3 + k]).find((v) => v !== a && v !== b)!;

  // rant: krawędź z dwoma trójkątami pod kątem > 30°
  const feature = new Map<string, { a: number; b: number }>();
  const adj = new Map<number, number[]>();
  for (const key of directed.keys()) {
    const [a, b] = key.split('_').map(Number);
    if (a > b) continue;
    const t1 = directed.get(`${a}_${b}`), t2 = directed.get(`${b}_${a}`);
    if (t1 === undefined || t2 === undefined) continue;
    if (normals[t1].dot(normals[t2]) > FEATURE_COS) continue;
    feature.set(`${a}_${b}`, { a, b });
    for (const [u, v] of [[a, b], [b, a]]) {
      if (!adj.has(u)) adj.set(u, []);
      adj.get(u)!.push(v);
    }
  }

  const used = new Set<string>();
  const key = (a: number, b: number) => (a < b ? `${a}_${b}` : `${b}_${a}`);
  const chains: Chain[] = [];
  for (const { a, b } of feature.values()) {
    if (used.has(key(a, b))) continue;
    used.add(key(a, b));
    const seq = [a, b];
    // przedłużanie ciągu w obie strony przez punkty, w których rant gładko biegnie dalej
    const extend = (forward: boolean) => {
      for (;;) {
        const end = forward ? seq[seq.length - 1] : seq[0];
        const prev = forward ? seq[seq.length - 2] : seq[1];
        const nb = adj.get(end) ?? [];
        if (nb.length !== 2) return;
        const next = nb[0] === prev ? nb[1] : nb[0];
        if (used.has(key(end, next))) return;
        const d0 = P[end].clone().sub(P[prev]).normalize(), d1 = P[next].clone().sub(P[end]).normalize();
        if (d0.dot(d1) < TURN_COS) return;
        used.add(key(end, next));
        if (forward) seq.push(next);
        else seq.unshift(next);
      }
    };
    extend(true);
    extend(false);
    let closed = false;
    if (seq.length > 3 && seq[0] === seq[seq.length - 1]) {
      seq.pop();
      closed = true;
    }

    // ściany po obu stronach każdego odcinka: "1" ma krawędź u→v, "2" ma v→u
    const segs: Chain['segs'] = [];
    const n = closed ? seq.length : seq.length - 1;
    for (let i = 0; i < n; i++) {
      const u = seq[i], v = seq[(i + 1) % seq.length];
      const t1 = directed.get(`${u}_${v}`)!, t2 = directed.get(`${v}_${u}`)!;
      const t = P[v].clone().sub(P[u]).normalize();
      const dir = (tri: number) => {
        const n = normals[tri];
        const d = n.clone().cross(t).normalize();
        const w = third(tri, u, v);
        if (d.dot(P[w].clone().sub(P[u])) < 0) d.negate(); // w głąb ściany, od krawędzi
        return d;
      };
      // jak daleko od rantu sięgają przyległe trójkąty – większe zaokrąglenie wyjdzie poza ścianę
      const depth = Math.min(...[t1, t2].map((tri) => P[third(tri, u, v)].clone().sub(P[u]).cross(t).length()));
      segs.push({ n1: normals[t1].clone(), n2: normals[t2].clone(), d1: dir(t1), d2: dir(t2), depth });
    }
    // wypukły: przesuwając się w głąb ściany 2 schodzimy "pod" ścianę 1
    const convex = segs[0].n1.dot(segs[0].d2) < 0;
    chains.push({ points: seq.map((i) => P[i].clone()), indices: seq.slice(), closed, segs, convex });
  }
  return chains;
}

/**
 * Wycinak / wypełnienie wzdłuż rantu: w każdym punkcie rantu przekrój "narożnik minus łuk"
 * w płaszczyźnie prostopadłej do rantu, połączony w zamkniętą bryłę.
 */
function buildTool(ch: Chain, r: number, segs: number): { mesh: RawMesh; tooBig: boolean } {
  const pts = ch.points;
  const N = pts.length;
  const e = Math.max(0.3, r * 0.25); // wysunięcie poza powierzchnię – czyste odejmowanie
  let tooBig = false;
  const rings: THREE.Vector3[][] = [];
  const segAt = (i: number) => ch.segs[((i % ch.segs.length) + ch.segs.length) % ch.segs.length];

  const ringAt = (i: number, origin: THREE.Vector3) => {
    // odcinki przyległe do punktu i
    const adj = ch.closed ? [segAt(i - 1), segAt(i)] : [ch.segs[Math.max(0, i - 1)], ch.segs[Math.min(ch.segs.length - 1, i)]];
    const tPrev = ch.closed || i > 0 ? pts[i].clone().sub(pts[(i - 1 + N) % N]).normalize() : null;
    const tNext = ch.closed || i < N - 1 ? pts[(i + 1) % N].clone().sub(pts[i]).normalize() : null;
    const t = (tPrev && tNext ? tPrev.add(tNext) : (tPrev ?? tNext)!).normalize();
    const avg = (f: (s: Chain['segs'][number]) => THREE.Vector3) => adj.map(f).reduce((s, v) => s.add(v), new THREE.Vector3());
    const flat = (v: THREE.Vector3) => v.addScaledVector(t, -v.dot(t)).normalize(); // w płaszczyźnie przekroju
    const d1 = flat(avg((s) => s.d1)), d2 = flat(avg((s) => s.d2));
    const n1 = flat(avg((s) => s.n1)), n2 = flat(avg((s) => s.n2));

    const phi = Math.acos(THREE.MathUtils.clamp(d1.dot(d2), -1, 1)); // kąt klina między ścianami
    const along = r / Math.tan(phi / 2); // odległość punktów styku od rantu
    const depth = Math.min(...adj.map((s) => s.depth));
    if (!Number.isFinite(along) || along > depth + 1e-6) tooBig = true;
    const bis = d1.clone().add(d2).normalize();
    const O = origin.clone().addScaledVector(bis, r / Math.sin(phi / 2));
    const T1 = origin.clone().addScaledVector(d1, along);
    const T2 = origin.clone().addScaledVector(d2, along);
    // kierunki "od klina" – w nie wysuwamy wycinak poza powierzchnię
    const w1 = n1.dot(d2) < 0 ? n1 : n1.clone().negate();
    const w2 = n2.dot(d1) < 0 ? n2 : n2.clone().negate();

    const ring: THREE.Vector3[] = [];
    if (segs === 1) ring.push(T1, T2); // faza: prosto od T1 do T2
    else {
      const u1 = T1.clone().sub(O), u2 = T2.clone().sub(O);
      const q = new THREE.Quaternion().setFromUnitVectors(u1.clone().normalize(), u2.clone().normalize());
      const id = new THREE.Quaternion();
      for (let k = 0; k <= segs; k++) ring.push(O.clone().add(u1.clone().applyQuaternion(id.clone().slerp(q, k / segs))));
    }
    ring.push(
      T2.clone().addScaledVector(w2, e),
      origin.clone().addScaledVector(w1, e).addScaledVector(w2, e),
      T1.clone().addScaledVector(w1, e),
    );
    return { ring, t };
  };

  for (let i = 0; i < N; i++) rings.push(ringAt(i, pts[i]).ring);
  if (!ch.closed && ch.convex) {
    // na końcach rantu wycinak wystaje odrobinę dalej (żeby nie zostawić cienkiej ścianki).
    // Wypełnienia (rant wklęsły) – nie: wystawałoby poza bryłę.
    const first = ringAt(0, pts[0]), last = ringAt(N - 1, pts[N - 1]);
    rings.unshift(first.ring.map((p) => p.clone().addScaledVector(first.t, -e)));
    rings.push(last.ring.map((p) => p.clone().addScaledVector(last.t, e)));
  }

  // siatka: pierścienie połączone czworokątami, końce zamknięte wachlarzem z narożnika zewnętrznego
  const K = rings[0].length;
  const vertices: number[] = [];
  rings.forEach((ring) => ring.forEach((p) => vertices.push(p.x, p.y, p.z)));
  const index: number[] = [];
  const R = rings.length;
  const id = (ri: number, k: number) => ri * K + (k % K);
  const last = ch.closed ? R : R - 1;
  for (let ri = 0; ri < last; ri++) {
    const rj = (ri + 1) % R;
    for (let k = 0; k < K; k++) index.push(id(ri, k), id(ri, k + 1), id(rj, k + 1), id(ri, k), id(rj, k + 1), id(rj, k));
  }
  if (!ch.closed) {
    const apex = K - 2; // narożnik zewnętrzny – z niego widać cały przekrój
    for (let k = 0; k < K; k++) {
      const a = (apex + 1 + k) % K, b = (apex + 2 + k) % K;
      if (a === apex || b === apex) continue;
      index.push(id(0, apex), id(0, b), id(0, a));
      index.push(id(R - 1, apex), id(R - 1, a), id(R - 1, b));
    }
  }
  // orientacja: objętość dodatnia = ściany na zewnątrz
  let vol = 0;
  const v = (i: number) => new THREE.Vector3(vertices[i * 3], vertices[i * 3 + 1], vertices[i * 3 + 2]);
  for (let i = 0; i < index.length; i += 3) vol += v(index[i]).dot(v(index[i + 1]).cross(v(index[i + 2])));
  if (vol < 0) for (let i = 0; i < index.length; i += 3) [index[i + 1], index[i + 2]] = [index[i + 2], index[i + 1]];
  return { mesh: { vertices, index }, tooBig };
}
