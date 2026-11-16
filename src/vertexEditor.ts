import * as THREE from 'three';
import { refreshEdges, type Model, type ModelMesh } from './model';
import type { Viewport } from './viewport';
import {
  applyMirror, centerOffset, createMirrorPlane, findMirrorPairs, isTopologySymmetric, onPlane, reflect,
  symmetrize, MIRROR_TOLERANCE, type MirrorAxis, type MirrorSettings,
} from './mirror';
import { cleanGeometry } from './primitives';
import { t } from './i18n';

const COLOR_NORMAL = new THREE.Color(0xe8ecf2);
const COLOR_HOVER = new THREE.Color(0xffe14f);
const COLOR_SELECTED = new THREE.Color(0xff8a2a);
const COLOR_MIRRORED = new THREE.Color(0xffc58a); // lustrzana para zaznaczonego punktu
const COLOR_UNPAIRED = new THREE.Color(0xff4f6a); // przy włączonej symetrii: punkt bez pary
const PICK_RADIUS = 10; // px
const EDGE_PICK_RADIUS = 7; // px – jak blisko krawędzi trzeba kliknąć, żeby dodać na niej punkt
const MID_SNAP_RADIUS = 8; // px – przyciąganie nowego punktu do środka krawędzi

interface DragState {
  primary: number;
  primaryStart: THREE.Vector3; // świat
  starts: Map<number, THREE.Vector3>; // świat, dla wszystkich zaznaczonych
  offsetH: THREE.Vector3; // przesunięcie trafienia względem wierzchołka (płaszczyzna pozioma)
  offsetV: THREE.Vector3; // j.w. dla płaszczyzny pionowej
  moved: boolean;
}

/**
 * Edycja bryły przez chwytanie jej wierzchołków (punktów przecięcia krawędzi siatki)
 * i przeciąganie myszą.
 *  - zwykłe przeciąganie: ruch w poziomie (płaszczyzna XY na wysokości wierzchołka),
 *  - z Shift: tylko w pionie (oś Z),
 *  - Ctrl + klik: dodaj/usuń wierzchołek z zaznaczenia; przeciąga się wszystkie zaznaczone.
 */
export class VertexEditor {
  target: ModelMesh | null = null;
  selection = new Set<number>();
  snap = true;
  snapStep = 1;
  /** Symetria: null = wyłączona. */
  mirror: MirrorSettings | null = null;
  /** Indeks lustrzanej pary każdego punktu (patrz findMirrorPairs). */
  private pairs: Int32Array | null = null;
  private mirrorFor: number | null = null; // id bryły, dla której ustawiono położenie lustra

  private hovered: number | null = null;
  private drag: DragState | null = null;
  private visiblePoints: THREE.Points | null = null;
  private hiddenPoints: THREE.Points | null = null;
  private colors: THREE.BufferAttribute | null = null;
  private listeners = new Set<() => void>();
  private messageListeners = new Set<(text: string) => void>();
  /** Czy podział na trójkąty jest symetryczny względem lustra. */
  topologySymmetric = true;

  constructor(private model: Model, private view: Viewport) {}

  onChange(fn: () => void) {
    this.listeners.add(fn);
  }

  private emit() {
    this.listeners.forEach((fn) => fn());
  }

  /** Komunikaty dla użytkownika (pasek stanu). */
  onMessage(fn: (text: string) => void) {
    this.messageListeners.add(fn);
  }

  private message(text: string) {
    this.messageListeners.forEach((fn) => fn(text));
  }

  get dragging() {
    return this.drag !== null;
  }

  attach(mesh: ModelMesh | null) {
    if (mesh === this.target && this.visiblePoints) return;
    this.detach();
    this.target = mesh;
    if (!mesh) return;

    const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', pos); // współdzielone z bryłą – przeciąganie od razu widać
    this.colors = new THREE.Float32BufferAttribute(new Float32Array(pos.count * 3), 3);
    geo.setAttribute('color', this.colors);

    const dot = dotTexture();
    // punkty widoczne: pełne kolory, przesłonięte: przygaszone, rysowane "przez" bryłę
    this.visiblePoints = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 10, sizeAttenuation: false, vertexColors: true, map: dot, alphaTest: 0.5, depthTest: true,
    }));
    this.hiddenPoints = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 7, sizeAttenuation: false, vertexColors: true, map: dot, alphaTest: 0.5,
      depthTest: false, transparent: true, opacity: 0.35,
    }));
    this.hiddenPoints.renderOrder = 10;
    for (const p of [this.visiblePoints, this.hiddenPoints]) {
      p.raycast = () => {};
      p.name = '__vertexHandles';
      mesh.add(p);
    }
    if (this.mirror && this.mirrorFor !== mesh.userData.id) {
      // inna bryła – lustro na jej środek (po cofnięciu ta sama bryła zachowuje ustawienie)
      this.mirror.offset = centerOffset(mesh.geometry, this.mirror.axis);
    }
    this.mirrorFor = mesh.userData.id;
    this.updateMirror();
  }

  detach() {
    if (this.target) {
      for (const p of [this.visiblePoints, this.hiddenPoints]) {
        if (p) {
          this.target.remove(p);
          (p.material as THREE.Material).dispose();
        }
      }
      this.removeMirrorPlane();
    }
    this.pairs = null;
    this.visiblePoints?.geometry.deleteAttribute('position');
    this.visiblePoints?.geometry.dispose();
    this.visiblePoints = this.hiddenPoints = null;
    this.target = null;
    this.selection.clear();
    this.hovered = null;
    this.drag = null;
    this.showPreview(null);
  }

  // ---------- symetria ----------

  /** Włącza lustro dla osi (domyślnie na środku bryły) albo wyłącza (null). */
  setMirror(axis: MirrorAxis | null, offset?: number) {
    if (!axis) this.mirror = null;
    else {
      const keep = this.mirror?.axis === axis ? this.mirror.offset : undefined;
      const def = this.target ? centerOffset(this.target.geometry, axis) : 0;
      this.mirror = { axis, offset: offset ?? keep ?? def };
    }
    this.updateMirror();
    // bryła symetryczna, ale z niesymetrycznym podziałem na trójkąty – poprawiamy od razu,
    // inaczej nowe punkty i wygięte ściany wyglądałyby po obu stronach inaczej
    if (this.mirror && this.target && this.unpairedCount === 0 && !this.topologySymmetric) {
      const added = this.symmetrizeMesh(1);
      if (added !== null) {
        this.message(t.vertex.meshPrepared(this.mirror.axis.toUpperCase(), added));
      }
    }
    this.emit();
  }

  /**
   * Przecina bryłę lustrem i zastępuje stronę przeciwną do `keep` odbiciem strony `keep`.
   * Zwraca liczbę dodanych punktów albo null, gdy się nie udało.
   */
  symmetrizeMesh(keep: 1 | -1): number | null {
    const mesh = this.target;
    if (!mesh || !this.mirror) return null;
    const g = mesh.geometry;
    const before = g.getAttribute('position').count;
    const res = symmetrize(g.getAttribute('position'), g.getIndex()!.array, this.mirror, keep);
    if (!res) {
      this.message(t.vertex.nothingOnSide);
      return null;
    }
    this.model.checkpoint();
    const raw = new THREE.BufferGeometry();
    raw.setAttribute('position', new THREE.Float32BufferAttribute(res.vertices, 3));
    raw.setIndex(res.index);
    this.model.replaceGeometry(mesh, cleanGeometry(raw));
    raw.dispose();
    this.attach(null);
    this.attach(mesh); // nowe uchwyty i pary
    this.model.emit();
    return mesh.geometry.getAttribute('position').count - before;
  }

  /** Liczba punktów bez lustrzanej pary (gdy bryła nie jest symetryczna). */
  get unpairedCount() {
    if (!this.pairs) return 0;
    let n = 0;
    for (const p of this.pairs) if (p < 0) n++;
    return n;
  }

  /** Przelicza pary i odświeża taflę lustra. */
  private updateMirror() {
    const mesh = this.target;
    this.removeMirrorPlane();
    this.pairs = null;
    if (mesh && this.mirror) {
      this.pairs = findMirrorPairs(mesh.geometry.getAttribute('position'), this.mirror);
      this.topologySymmetric = isTopologySymmetric(mesh.geometry.getIndex()!.array, this.pairs);
      mesh.add(createMirrorPlane(mesh.geometry, this.mirror));
    }
    this.refreshColors();
  }

  private removeMirrorPlane() {
    const old = this.target?.getObjectByName('__mirrorPlane');
    if (!old) return;
    old.removeFromParent();
    old.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      (m.material as THREE.Material | undefined)?.dispose();
    });
  }

  // ---------- dodawanie punktów ----------

  /**
   * Podwójne kliknięcie: wstawia nowy punkt.
   *  - blisko krawędzi → punkt na krawędzi (dzieli oba sąsiednie trójkąty),
   *  - na ścianie → punkt w miejscu kliknięcia (dzieli trójkąt na trzy).
   * Siatka pozostaje szczelna. Zwraca true, jeśli punkt dodano.
   */
  insertAt(e: MouseEvent): boolean {
    if (!this.target || this.pick(e) !== null) return false;
    const target = this.findInsertion(e);
    if (!target) return false;

    this.model.checkpoint();
    const mesh = this.target;
    const g = mesh.geometry;
    const verts = Array.from(g.getAttribute('position').array as Float32Array);
    const index = Array.from(g.getIndex()!.array);
    const local = target.point.clone().applyMatrix4(mesh.matrixWorld.clone().invert());

    // lustrzany odpowiednik krawędzi / trójkąta – zapamiętany przed podziałem
    const pairs = this.mirror && !onPlane(local, this.mirror) ? this.pairs : null;
    const tri = target.kind === 'face' ? [index[target.face * 3], index[target.face * 3 + 1], index[target.face * 3 + 2]] : [];
    const mirrorEdge = pairs && target.kind === 'edge' ? [pairs[target.a], pairs[target.b]] : null;
    const mirrorTri = pairs && target.kind === 'face' ? tri.map((i) => pairs[i]) : null;

    const added: number[] = [];
    if (target.kind === 'edge') added.push(splitEdge(verts, index, target.a, target.b, local));
    else added.push(splitFace(verts, index, target.face * 3, local));

    // symetria: ten sam punkt w lustrzanej krawędzi / lustrzanym trójkącie
    if (this.mirror && !onPlane(local, this.mirror)) {
      const r = reflect(local, this.mirror);
      if (mirrorEdge && mirrorEdge.every((i) => i >= 0)) {
        added.push(splitEdge(verts, index, mirrorEdge[0], mirrorEdge[1], r));
      } else if (mirrorTri && mirrorTri.every((i) => i >= 0) && findTriangle(index, mirrorTri) !== null) {
        added.push(splitFace(verts, index, findTriangle(index, mirrorTri)!, r));
      } else {
        // siatka niesymetryczna – szukamy po położeniu
        const edge = findEdgeContaining(verts, index, r);
        if (edge) added.push(splitEdge(verts, index, edge[0], edge[1], r));
        else {
          const t = findTriangleContaining(verts, index, r);
          if (t !== null) added.push(splitFace(verts, index, t, r));
        }
      }
    }

    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    g.setIndex(index);
    this.attach(null);
    this.attach(mesh); // uchwyty od nowa – zmieniła się liczba punktów
    added.forEach((i) => this.selection.add(i));
    this.refreshColors();
    this.geometryChanged();
    this.model.emit();
    return true;
  }

  /** Gdzie trafiłby nowy punkt pod kursorem: krawędź (preferowana) albo ściana. */
  private findInsertion(e: MouseEvent):
    | { kind: 'edge'; a: number; b: number; point: THREE.Vector3 }
    | { kind: 'face'; face: number; point: THREE.Vector3 }
    | null {
    const mesh = this.target!;
    mesh.updateMatrixWorld();
    const ray = this.view.rayFromEvent(e);
    const mouse = this.view.localPoint(e);
    const pos = mesh.geometry.getAttribute('position');
    const index = mesh.geometry.getIndex()!;

    // pozycje punktów w świecie (raz na wywołanie)
    const world: THREE.Vector3[] = [];
    for (let i = 0; i < pos.count; i++) world.push(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld));

    const seen = new Set<string>();
    let best: { a: number; b: number; d: number; point: THREE.Vector3 } | null = null;
    const onSeg = new THREE.Vector3();
    for (let t = 0; t < index.count; t += 3) {
      for (let k = 0; k < 3; k++) {
        const a = index.getX(t + k), b = index.getX(t + ((k + 1) % 3));
        const key = a < b ? `${a}_${b}` : `${b}_${a}`;
        if (seen.has(key)) continue;
        seen.add(key);
        ray.ray.distanceSqToSegment(world[a], world[b], undefined, onSeg);
        const s = this.view.toScreen(onSeg);
        const d = Math.hypot(s.x - mouse.x, s.y - mouse.y);
        if (d > EDGE_PICK_RADIUS || (best && d >= best.d)) continue;
        if (!this.isVisible(onSeg)) continue;
        const point = onSeg.clone();
        // blisko środka krawędzi → dokładnie w środku
        const mid = world[a].clone().lerp(world[b], 0.5);
        const ms = this.view.toScreen(mid);
        if (Math.hypot(ms.x - mouse.x, ms.y - mouse.y) < MID_SNAP_RADIUS) point.copy(mid);
        // nie wstawiamy na samych końcach krawędzi
        const len = world[a].distanceTo(world[b]);
        if (point.distanceTo(world[a]) < len * 0.02 || point.distanceTo(world[b]) < len * 0.02) continue;
        best = { a, b, d, point };
      }
    }
    if (best) return { kind: 'edge', a: best.a, b: best.b, point: best.point };

    const hit = ray.intersectObject(mesh, false)[0];
    if (hit && hit.faceIndex != null) return { kind: 'face', face: hit.faceIndex, point: hit.point.clone() };
    return null;
  }

  private preview: THREE.Points | null = null;
  private previewLine: THREE.Line | null = null;

  /** Zielony znacznik w miejscu, gdzie podwójne kliknięcie doda punkt. */
  private updatePreview(e: PointerEvent) {
    const ins = this.findInsertion(e);
    this.showPreview(ins);
  }

  private showPreview(ins: ReturnType<VertexEditor['findInsertion']>) {
    if (!this.preview) {
      this.preview = new THREE.Points(
        new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3)),
        new THREE.PointsMaterial({ size: 11, sizeAttenuation: false, color: 0x4fe36c, map: dotTexture(), alphaTest: 0.5, depthTest: false }),
      );
      this.previewLine = new THREE.Line(
        new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3)),
        new THREE.LineBasicMaterial({ color: 0x4fe36c, depthTest: false }),
      );
      for (const o of [this.preview, this.previewLine]) {
        o.renderOrder = 20;
        o.raycast = () => {};
        o.visible = false;
        this.view.scene.add(o);
      }
    }
    this.preview.visible = !!ins;
    this.previewLine!.visible = ins?.kind === 'edge';
    if (!ins) return;
    const p = this.preview.geometry.getAttribute('position') as THREE.BufferAttribute;
    p.setXYZ(0, ins.point.x, ins.point.y, ins.point.z);
    p.needsUpdate = true;
    if (ins.kind === 'edge') {
      const mesh = this.target!;
      const pos = mesh.geometry.getAttribute('position');
      const a = new THREE.Vector3().fromBufferAttribute(pos, ins.a).applyMatrix4(mesh.matrixWorld);
      const b = new THREE.Vector3().fromBufferAttribute(pos, ins.b).applyMatrix4(mesh.matrixWorld);
      const l = this.previewLine!.geometry.getAttribute('position') as THREE.BufferAttribute;
      l.setXYZ(0, a.x, a.y, a.z);
      l.setXYZ(1, b.x, b.y, b.z);
      l.needsUpdate = true;
    }
  }

  /** Czy punkt na powierzchni bryły jest widoczny z kamery (nie zasłania go inna ściana). */
  private isVisible(p: THREE.Vector3): boolean {
    if (this.view.mode === 'top') return true;
    const cam = this.view.camera.getWorldPosition(new THREE.Vector3());
    const dir = p.clone().sub(cam);
    const dist = dir.length();
    const hit = new THREE.Raycaster(cam, dir.normalize()).intersectObject(this.target!, false)[0];
    return !hit || hit.distance > dist - 0.05 * Math.max(1, dist / 100);
  }

  selectAll() {
    if (!this.target) return;
    const n = this.target.geometry.getAttribute('position').count;
    for (let i = 0; i < n; i++) this.selection.add(i);
    this.refreshColors();
    this.emit();
  }

  clearSelection() {
    this.selection.clear();
    this.refreshColors();
    this.emit();
  }

  // ---------- zdarzenia myszy (zwracają true, jeśli zdarzenie zostało obsłużone) ----------

  pointerDown(e: PointerEvent): boolean {
    if (!this.target || e.button !== 0) return false;
    const idx = this.pick(e);
    if (idx === null) return false;

    if (e.ctrlKey || e.metaKey) {
      if (this.selection.has(idx)) {
        this.selection.delete(idx);
        this.refreshColors();
        this.emit();
        return true;
      }
      this.selection.add(idx);
    } else if (!this.selection.has(idx)) {
      this.selection.clear();
      this.selection.add(idx);
    }

    this.showPreview(null);
    if (this.mirror) this.updateMirror(); // pary według aktualnego kształtu
    const primaryStart = this.worldPos(idx);
    const starts = new Map<number, THREE.Vector3>();
    this.selection.forEach((i) => starts.set(i, this.worldPos(i)));
    const ray = this.view.rayFromEvent(e);
    const hH = this.hitPlane(ray, this.horizontalPlane(primaryStart)) ?? primaryStart.clone();
    const hV = this.hitPlane(ray, this.verticalPlane(primaryStart)) ?? primaryStart.clone();
    this.drag = {
      primary: idx,
      primaryStart,
      starts,
      offsetH: hH.sub(primaryStart),
      offsetV: hV.sub(primaryStart),
      moved: false,
    };
    this.refreshColors();
    this.emit();
    return true;
  }

  pointerMove(e: PointerEvent): boolean {
    if (!this.target) return false;
    if (!this.drag) {
      const idx = this.pick(e);
      if (idx !== this.hovered) {
        this.hovered = idx;
        this.refreshColors();
      }
      if (idx === null) this.updatePreview(e);
      else this.showPreview(null);
      return idx !== null;
    }

    const d = this.drag;
    const ray = this.view.rayFromEvent(e);
    const vertical = e.shiftKey && this.view.mode === '3d';
    const next = d.primaryStart.clone();
    if (vertical) {
      const hit = this.hitPlane(ray, this.verticalPlane(d.primaryStart));
      if (!hit) return true;
      next.z = hit.z - d.offsetV.z;
    } else {
      const hit = this.hitPlane(ray, this.horizontalPlane(d.primaryStart));
      if (!hit) return true;
      next.x = hit.x - d.offsetH.x;
      next.y = hit.y - d.offsetH.y;
    }
    if (this.snap && !e.altKey) {
      const s = this.snapStep;
      if (vertical) next.z = Math.round(next.z / s) * s;
      else {
        next.x = Math.round(next.x / s) * s;
        next.y = Math.round(next.y / s) * s;
      }
    }

    const delta = next.sub(d.primaryStart);
    if (!d.moved) {
      if (delta.lengthSq() < 1e-10) return true;
      this.model.checkpoint(); // stan sprzed przeciągania – do cofnięcia
      d.moved = true;
    }
    const inv = this.target.matrixWorld.clone().invert();
    const pos = this.target.geometry.getAttribute('position') as THREE.BufferAttribute;
    d.starts.forEach((start, i) => {
      const local = start.clone().add(delta).applyMatrix4(inv);
      pos.setXYZ(i, local.x, local.y, local.z);
    });
    if (this.mirror && this.pairs) applyMirror(pos, this.pairs, d.starts.keys(), this.mirror);
    this.geometryChanged();
    return true;
  }

  pointerUp(): boolean {
    if (!this.drag) return false;
    const moved = this.drag.moved;
    this.drag = null;
    if (moved && this.mirror) this.updateMirror(); // tafla dopasowana do nowego rozmiaru
    if (moved) this.model.emit();
    return true;
  }

  // ---------- dostęp dla panelu właściwości ----------

  /** Pozycja (świat) pierwszego zaznaczonego wierzchołka. */
  selectedWorld(): THREE.Vector3 | null {
    const first = this.selection.values().next();
    return first.done ? null : this.worldPos(first.value);
  }

  /** Ustawia współrzędną świata dla zaznaczonych wierzchołków (wpisywanie z klawiatury). */
  setSelectedAxis(axis: 'x' | 'y' | 'z', value: number) {
    if (!this.target || this.selection.size === 0) return;
    this.model.checkpoint();
    const inv = this.target.matrixWorld.clone().invert();
    const pos = this.target.geometry.getAttribute('position') as THREE.BufferAttribute;
    this.selection.forEach((i) => {
      const w = this.worldPos(i);
      w[axis] = value;
      w.applyMatrix4(inv);
      pos.setXYZ(i, w.x, w.y, w.z);
    });
    if (this.mirror && this.pairs) applyMirror(pos, this.pairs, this.selection, this.mirror);
    this.geometryChanged();
    this.model.emit();
  }

  // ---------- pomocnicze ----------

  private geometryChanged() {
    const mesh = this.target!;
    const g = mesh.geometry;
    g.getAttribute('position').needsUpdate = true;
    g.computeVertexNormals();
    g.computeBoundingBox();
    g.computeBoundingSphere();
    refreshEdges(mesh);
    this.emit();
  }

  private worldPos(i: number): THREE.Vector3 {
    const mesh = this.target!;
    mesh.updateMatrixWorld();
    return new THREE.Vector3().fromBufferAttribute(mesh.geometry.getAttribute('position'), i).applyMatrix4(mesh.matrixWorld);
  }

  private horizontalPlane(p: THREE.Vector3) {
    return new THREE.Plane(new THREE.Vector3(0, 0, 1), -p.z);
  }

  /** Płaszczyzna pionowa przez punkt, zwrócona możliwie w stronę kamery. */
  private verticalPlane(p: THREE.Vector3) {
    const dir = this.view.camera.getWorldDirection(new THREE.Vector3());
    dir.z = 0;
    if (dir.lengthSq() < 1e-6) dir.set(0, 1, 0);
    dir.normalize();
    return new THREE.Plane().setFromNormalAndCoplanarPoint(dir, p);
  }

  private hitPlane(ray: THREE.Raycaster, plane: THREE.Plane) {
    return ray.ray.intersectPlane(plane, new THREE.Vector3());
  }

  /**
   * Szuka wierzchołka najbliżej kursora (w pikselach). Wierzchołki widoczne
   * mają pierwszeństwo przed zasłoniętymi przez bryłę.
   */
  private pick(e: MouseEvent): number | null {
    const mesh = this.target!;
    const mouse = this.view.localPoint(e);
    const pos = mesh.geometry.getAttribute('position');
    mesh.updateMatrixWorld();
    const candidates: { i: number; d: number; w: THREE.Vector3 }[] = [];
    const w = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      w.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      const s = this.view.toScreen(w);
      if (s.z > 1) continue;
      const d = Math.hypot(s.x - mouse.x, s.y - mouse.y);
      if (d <= PICK_RADIUS) candidates.push({ i, d, w: w.clone() });
    }
    if (candidates.length === 0) return null;
    // w widoku z góry punkty górne i dolne pokrywają się – wtedy wygrywa wyższy
    candidates.sort((a, b) => (Math.abs(a.d - b.d) < 1.5 ? b.w.z - a.w.z : a.d - b.d));
    const camPos = this.view.camera.getWorldPosition(new THREE.Vector3());
    const ray = new THREE.Raycaster();
    for (const c of candidates) {
      if (this.view.mode === 'top') return c.i;
      const toV = c.w.clone().sub(camPos);
      const dist = toV.length();
      ray.set(camPos, toV.normalize());
      const hit = ray.intersectObject(mesh, false)[0];
      if (!hit || hit.distance > dist - 0.05 * Math.max(1, dist / 100)) return c.i; // nic nie zasłania
    }
    return candidates[0].i;
  }

  private refreshColors() {
    if (!this.colors) return;
    const mirrored = new Set<number>();
    if (this.pairs) this.selection.forEach((i) => this.pairs![i] >= 0 && mirrored.add(this.pairs![i]));
    for (let i = 0; i < this.colors.count; i++) {
      const c = this.selection.has(i) ? COLOR_SELECTED
        : i === this.hovered ? COLOR_HOVER
        : mirrored.has(i) ? COLOR_MIRRORED
        : this.pairs && this.pairs[i] < 0 ? COLOR_UNPAIRED
        : COLOR_NORMAL;
      this.colors.setXYZ(i, c.r, c.g, c.b);
    }
    this.colors.needsUpdate = true;
  }
}

let dotTex: THREE.Texture | null = null;
/** Okrągły znacznik punktu (tekstura dla THREE.Points). */
export function dotTexture() {
  if (dotTex) return dotTex;
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const ctx = c.getContext('2d')!;
  ctx.beginPath();
  ctx.arc(16, 16, 13, 0, Math.PI * 2);
  ctx.fillStyle = '#fff';
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#000';
  ctx.stroke();
  dotTex = new THREE.CanvasTexture(c);
  return dotTex;
}

// ---------- operacje na tablicach siatki (pozycje + indeksy) ----------

const vec = (verts: number[], i: number) => new THREE.Vector3(verts[i * 3], verts[i * 3 + 1], verts[i * 3 + 2]);

/** Wstawia punkt na krawędzi a–b, dzieląc wszystkie trójkąty z tą krawędzią. Zwraca indeks punktu. */
function splitEdge(verts: number[], index: number[], a: number, b: number, p: THREE.Vector3): number {
  const m = verts.length / 3;
  verts.push(p.x, p.y, p.z);
  const n = index.length;
  for (let t = 0; t < n; t += 3) {
    for (let k = 0; k < 3; k++) {
      const u = index[t + k], v = index[t + ((k + 1) % 3)], w = index[t + ((k + 2) % 3)];
      if ((u === a && v === b) || (u === b && v === a)) {
        // (u, v, w) → (u, m, w) + (m, v, w): ta sama kolejność obiegu – normalne bez zmian
        index[t] = u; index[t + 1] = m; index[t + 2] = w;
        index.push(m, v, w);
        break;
      }
    }
  }
  return m;
}

/** Wstawia punkt wewnątrz trójkąta zaczynającego się od indeksu t (dzieli go na trzy). */
function splitFace(verts: number[], index: number[], t: number, p: THREE.Vector3): number {
  const m = verts.length / 3;
  verts.push(p.x, p.y, p.z);
  const [u, v, w] = [index[t], index[t + 1], index[t + 2]];
  index[t] = u; index[t + 1] = v; index[t + 2] = m;
  index.push(v, w, m, w, u, m);
  return m;
}

/** Krawędź, na której (wewnątrz) leży punkt p, albo null. */
function findEdgeContaining(verts: number[], index: number[], p: THREE.Vector3): [number, number] | null {
  for (let t = 0; t < index.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = index[t + k], b = index[t + ((k + 1) % 3)];
      const A = vec(verts, a), B = vec(verts, b);
      const ab = B.clone().sub(A);
      const len2 = ab.lengthSq();
      if (len2 < 1e-12) continue;
      const s = p.clone().sub(A).dot(ab) / len2;
      if (s <= 0.001 || s >= 0.999) continue;
      if (A.addScaledVector(ab, s).distanceTo(p) < MIRROR_TOLERANCE) return [a, b];
    }
  }
  return null;
}

/** Indeks (początek) trójkąta, w którego wnętrzu leży punkt p, albo null. */
function findTriangleContaining(verts: number[], index: number[], p: THREE.Vector3): number | null {
  const tri = new THREE.Triangle();
  const closest = new THREE.Vector3();
  for (let t = 0; t < index.length; t += 3) {
    tri.set(vec(verts, index[t]), vec(verts, index[t + 1]), vec(verts, index[t + 2]));
    tri.closestPointToPoint(p, closest);
    if (closest.distanceTo(p) < MIRROR_TOLERANCE) return t;
  }
  return null;
}

/** Początek trójkąta zbudowanego z podanych trzech wierzchołków (dowolna kolejność) albo null. */
function findTriangle(index: number[], tri: number[]): number | null {
  const want = [...tri].sort((a, b) => a - b).join('_');
  for (let t = 0; t < index.length; t += 3) {
    if ([index[t], index[t + 1], index[t + 2]].sort((a, b) => a - b).join('_') === want) return t;
  }
  return null;
}
