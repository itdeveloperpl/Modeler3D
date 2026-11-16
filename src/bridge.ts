import * as THREE from 'three';
import type { Model, ModelMesh } from './model';
import type { Viewport } from './viewport';
import { cleanGeometry } from './primitives';

/**
 * Most: łączy dwie płaskie ściany (tej samej albo dwóch brył) nowymi ścianami bocznymi.
 * Zaznaczone ściany są usuwane, a ich obrysy łączone "zamkiem błyskawicznym",
 * więc liczba punktów obu obrysów może być różna (np. kwadrat → okrąg).
 * Wynik to jedna, szczelna bryła.
 */

/** Siatka bryły przeliczona do współrzędnych świata. */
interface Baked {
  mesh: ModelMesh;
  geometry: THREE.BufferGeometry; // do sprawdzenia, czy bryła się nie zmieniła
  pos: Float32Array;
  index: Uint32Array; // przy odbiciu lustrzanym z odwróconą kolejnością – ściany zawsze na zewnątrz
  adjacency: Map<string, number[]>; // krawędź "a_b" (a<b) → trójkąty
}

/** Zaznaczona płaska ściana. */
interface FacePick {
  baked: Baked;
  tris: Set<number>;
  loop: number[]; // obrys w kolejności obiegu ściany (patrząc z zewnątrz: przeciwnie do wskazówek zegara)
  normal: THREE.Vector3;
  center: THREE.Vector3;
}

interface BridgeResult {
  positions: Float32Array; // wspólna siatka obu brył (świat)
  index: number[]; // pozostałe trójkąty + most
  bridgeTris: number[]; // same trójkąty mostu (do podglądu)
  warnings: string[];
  closed: boolean; // czy wynik jest szczelny – tylko wtedy można zatwierdzić
}

const COPLANAR_COS = Math.cos(THREE.MathUtils.degToRad(0.5));
const PLANE_TOL = 0.01; // mm
const COLOR_HOVER = 0x4fe36c;
const COLOR_A = 0xffd84f;
const COLOR_B = 0x4fd6ff;

export class BridgeTool {
  active = false;
  private bakedCache = new Map<ModelMesh, Baked>();
  private hover: FacePick | null = null;
  private a: FacePick | null = null;
  private b: FacePick | null = null;
  private shift = 0; // ręczna korekta dopasowania (←/→)
  private segments: number | null = null; // liczba segmentów łuku (null = dobierz automatycznie)
  private folded = false; // przekroje łuku nachodzą na siebie
  private result: BridgeResult | null = null;

  private overlays = new THREE.Group();
  private messageListeners = new Set<(text: string) => void>();

  constructor(private model: Model, private view: Viewport) {
    this.overlays.name = '__bridgeOverlays';
    view.scene.add(this.overlays);
  }

  onMessage(fn: (text: string) => void) {
    this.messageListeners.add(fn);
  }

  private message(text: string) {
    this.messageListeners.forEach((fn) => fn(text));
  }

  setActive(on: boolean) {
    this.active = on;
    this.reset();
    if (on) this.message('Most: kliknij płaską ścianę pierwszej bryły');
  }

  reset() {
    this.a = this.b = this.hover = null;
    this.result = null;
    this.shift = 0;
    this.segments = null;
    this.bakedCache.clear();
    this.redraw();
  }

  /** Wywoływane po każdej zmianie modelu – gdy bryła zniknęła lub zmieniła kształt, zaczynamy od nowa. */
  validate() {
    if (!this.active) return;
    const stale = [...this.bakedCache.values()].some(
      (b) => !this.model.objects.includes(b.mesh) || b.mesh.geometry !== b.geometry,
    );
    if (stale) this.reset();
  }

  /** Esc: cofa ostatni krok. Zwraca false, gdy nie było czego cofnąć. */
  back(): boolean {
    if (this.b) {
      this.b = null;
      this.result = null;
      this.shift = 0;
      this.segments = null;
      this.message('Most: kliknij płaską ścianę drugiej bryły');
    } else if (this.a) {
      this.a = null;
      this.message('Most: kliknij płaską ścianę pierwszej bryły');
    } else return false;
    this.redraw();
    return true;
  }

  /** ←/→: przesuwa dopasowanie punktów obrysów (obraca most). */
  rotate(step: number) {
    if (!this.a || !this.b) return;
    this.shift += step;
    this.build();
  }

  /** ↑/↓: liczba segmentów łuku (0 = most prosty). */
  changeSegments(step: number) {
    if (!this.a || !this.b || this.segments === null) return;
    this.segments = Math.max(0, Math.min(32, this.segments + step));
    this.build();
  }

  pointerMove(e: PointerEvent) {
    if (this.b) return; // jest podgląd – czekamy na Enter/Esc
    const res = this.pickFace(e);
    const pick = res && !('error' in res) ? res : null;
    if (pick === this.hover) return; // ta sama ściana – nic do przerysowania
    this.hover = pick;
    this.redraw();
  }

  pointerDown(e: PointerEvent) {
    if (this.b) return;
    const pick = this.pickFace(e);
    if (!pick) return;
    if ('error' in pick) {
      this.message(`Most: ${pick.error}`);
      return;
    }
    if (!this.a) {
      this.a = pick;
      this.hover = null;
      this.message('Most: kliknij płaską ścianę drugiej bryły (może być ta sama bryła)');
    } else {
      if (pick.baked === this.a.baked && [...pick.tris].some((t) => this.a!.tris.has(t))) {
        this.message('Most: wybierz inną ścianę niż pierwsza');
        return;
      }
      this.b = pick;
      this.hover = null;
      this.shift = 0;
      this.segments = null;
      this.build();
    }
    this.redraw();
  }

  /** Enter: zatwierdza most. Zwraca true, jeśli bryły połączono. */
  apply(): boolean {
    if (!this.a || !this.b || !this.result) return false;
    if (!this.result.closed) {
      this.message('Most: nie można zatwierdzić – wynik nie byłby szczelną bryłą (np. most pokrywa się z istniejącą ścianą). Esc – wybierz inne ściany');
      return false;
    }
    const target = this.a.baked.mesh;
    const other = this.b.baked.mesh;
    const r = this.result;

    // geometria w układzie lokalnym bryły A (zachowuje jej pozycję, obrót i skalę)
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(r.positions.slice(), 3));
    g.setIndex(r.index);
    target.updateMatrixWorld(true);
    g.applyMatrix4(target.matrixWorld.clone().invert());
    if (target.matrixWorld.determinant() < 0) flipWinding(g);
    const clean = cleanGeometry(g);
    g.dispose();
    // scalenie punktów (np. gdy ściany się stykały) nie może zepsuć szczelności
    if (!isClosed(Array.from(clean.getIndex()!.array))) {
      clean.dispose();
      this.message('Most: nie można zatwierdzić – po scaleniu punktów bryła nie byłaby szczelna. Odsuń bryły od siebie i spróbuj ponownie');
      return false;
    }

    this.model.checkpoint();
    this.model.replaceGeometry(target, clean);
    target.userData.kind = 'mesh';
    if (other !== target) {
      target.name = `${target.name} + ${other.name}`;
      this.model.removeSilently(other);
    }
    this.model.select(target);
    this.reset();
    this.message(`Most gotowy: ${r.bridgeTris.length / 3} nowych ścian` +
      (r.warnings.length ? ` – UWAGA: ${r.warnings.join('; ')}` : '') +
      ' · kliknij ścianę, aby zrobić kolejny most · B – wyłącz');
    return true;
  }

  // ---------- budowa mostu ----------

  private build() {
    const A = this.a!, B = this.b!;
    const sameMesh = A.baked === B.baked;
    if (this.segments === null) {
      // ściany zwrócone wprost do siebie → most prosty; pod kątem → łuk
      this.segments = A.normal.dot(B.normal.clone().negate()) > Math.cos(THREE.MathUtils.degToRad(20)) ? 0 : 8;
    }
    const S = this.segments;

    // wspólna siatka: A, potem B (jeśli to inna bryła); nowe punkty łuku dopisujemy na końcu
    const offB = sameMesh ? 0 : A.baked.pos.length / 3;
    const verts: number[] = Array.from(sameMesh ? A.baked.pos : concat(A.baked.pos, B.baked.pos));
    const P = (i: number) => new THREE.Vector3(verts[i * 3], verts[i * 3 + 1], verts[i * 3 + 2]);
    const addPoint = (v: THREE.Vector3) => {
      verts.push(v.x, v.y, v.z);
      return verts.length / 3 - 1;
    };

    const index: number[] = [];
    const keep = (baked: Baked, skip: Set<number>[], off: number) => {
      for (let t = 0; t < baked.index.length / 3; t++) {
        if (skip.some((s) => s.has(t))) continue;
        index.push(baked.index[t * 3] + off, baked.index[t * 3 + 1] + off, baked.index[t * 3 + 2] + off);
      }
    };
    if (sameMesh) keep(A.baked, [A.tris, B.tris], 0);
    else {
      keep(A.baked, [A.tris], 0);
      keep(B.baked, [B.tris], offB);
    }
    const remaining = index.length;

    const la = A.loop;
    const lbRaw = B.loop.map((i) => i + offB);
    const nA = la.length, nB = lbRaw.length;

    // obrys B w odwrotnej kolejności – patrząc z jednej strony oba obrysy biegną wtedy "razem"
    const lbAt = (start: number) => (k: number) => lbRaw[(((start - k) % nB) + nB) % nB];

    // obrót "kierunku wyjścia" z A (normalna A) na "kierunek wejścia" w B (przeciwny do normalnej B)
    const turn = turnRotation(A.normal, B.normal.clone().negate(), B.center.clone().sub(A.center));
    const toA = turn.clone().invert();

    // punkt startowy B: najmniejszy skręt. Kierunki od środka ściany B obracamy do płaszczyzny
    // ściany A, żeby porównanie działało też przy ścianach pod kątem.
    const dirA = la.map((i) => P(i).sub(A.center).normalize());
    let bestStart = 0, bestCost = Infinity;
    for (let s = 0; s < nB; s++) {
      const lb = lbAt(s);
      let cost = 0;
      for (let i = 0; i < nA; i++) {
        const j = Math.round((i * nB) / nA) % nB;
        cost += 1 - dirA[i].dot(P(lb(j)).sub(B.center).applyQuaternion(toA).normalize());
      }
      if (cost < bestCost) {
        bestCost = cost;
        bestStart = s;
      }
    }
    const lb = lbAt(bestStart + this.shift);

    // "zamek błyskawiczny": łączy dwa obrysy trójkątami; za każdym razem przesuwa się po tej
    // stronie, gdzie nowa przekątna jest krótsza. Pierwszy obrys używany w kierunku "a_i→a_i+1",
    // drugi "b_j+1→b_j" (tak jak krawędzie usuniętych ścian), więc siatka zostaje spójna.
    const zip = (a: (i: number) => number, na: number, b: (j: number) => number, nb: number) => {
      let i = 0, j = 0;
      while (i < na || j < nb) {
        const ai = a(i % na), ai1 = a((i + 1) % na), bj = b(j % nb), bj1 = b((j + 1) % nb);
        if (j >= nb || (i < na && P(ai1).distanceTo(P(bj)) <= P(ai).distanceTo(P(bj1)))) {
          index.push(ai, ai1, bj);
          i++;
        } else {
          index.push(bj1, bj, ai);
          j++;
        }
      }
    };

    const polylines: THREE.Vector3[][] = []; // "szczeble" mostu – do sprawdzania przecięć
    this.folded = false;
    if (S === 0) {
      // most prosty: obrysy połączone bezpośrednio
      zip((k) => la[k], nA, lb, nB);
      for (let k = 0; k < Math.max(nA, nB); k++) {
        polylines.push([P(la[Math.floor((k * nA) / Math.max(nA, nB))]), P(lb(Math.floor((k * nB) / Math.max(nA, nB))))]);
      }
    } else {
      // łuk: przekrój przeciągany wzdłuż krzywej środkowej (od środka A do środka B).
      // Przekrój obraca się razem z krzywą i płynnie zmienia kształt z obrysu A w obrys B,
      // więc zawsze jest poprzeczny do mostu. M punktów przekroju rozmieszczonych według obwodu.
      const ptsA = la.map((v) => P(v));
      const ptsB = Array.from({ length: nB }, (_, k) => P(lb(k)));
      const uA = arcParams(ptsA), uB = arcParams(ptsB);
      const baseB = nB >= nA;
      const params = baseB ? uB : uA;
      const M = params.length;
      const endA = params.map((u, m) => (baseB ? pointOnLoop(ptsA, uA, u) : ptsA[m]));
      const endB = params.map((u, m) => (baseB ? ptsB[m] : pointOnLoop(ptsB, uB, u)));
      const offA = endA.map((p) => p.clone().sub(A.center));
      const offB = endB.map((p) => p.clone().sub(B.center).applyQuaternion(toA)); // w układzie ściany A

      const h = A.center.distanceTo(B.center) * 0.5;
      const c1 = A.center.clone().addScaledVector(A.normal, h);
      const c2 = B.center.clone().addScaledVector(B.normal, h);
      const id = new THREE.Quaternion();
      const frames: { c: THREE.Vector3; n: THREE.Vector3 }[] = [{ c: A.center, n: A.normal }];
      const rings: number[][] = [];
      for (let k = 1; k <= S; k++) {
        const t = k / (S + 1);
        const c = bezier(A.center, c1, c2, B.center, t);
        const q = id.clone().slerp(turn, t);
        frames.push({ c, n: A.normal.clone().applyQuaternion(q) });
        rings.push(offA.map((oa, m) => addPoint(c.clone().add(oa.clone().lerp(offB[m], t).applyQuaternion(q)))));
      }
      frames.push({ c: B.center, n: B.normal.clone().negate() });

      // za ciasny zakręt: kolejny przekrój nie może leżeć "za" poprzednim
      const ringPts = [endA, ...rings.map((r) => r.map(P)), endB];
      for (let k = 0; k + 1 < ringPts.length && !this.folded; k++) {
        const f = frames[k];
        if (ringPts[k + 1].some((p) => p.clone().sub(f.c).dot(f.n) < -1e-3)) this.folded = true;
      }

      // obrys A → pierwszy pierścień, pierścienie między sobą (czworokąty), ostatni → obrys B
      zip((k) => la[k], nA, (m) => rings[0][m], M);
      for (let k = 0; k + 1 < S; k++) {
        const r0 = rings[k], r1 = rings[k + 1];
        for (let m = 0; m < M; m++) {
          const p = r0[m], q = r0[(m + 1) % M], t = r1[(m + 1) % M], u = r1[m];
          index.push(p, q, t, p, t, u);
        }
      }
      zip((m) => rings[S - 1][m], M, lb, nB);
      for (let m = 0; m < M; m++) polylines.push([endA[m], ...rings.map((r) => P(r[m])), endB[m]]);
    }
    const bridgeTris = index.slice(remaining);
    const positions = new Float32Array(verts);

    // ---- kontrola ----
    const warnings: string[] = [];
    if (this.folded) warnings.push('zakręt jest za ciasny na grubość mostu – ściany mostu się zawijają; odsuń bryły od siebie');
    const toB = B.center.clone().sub(A.center);
    if (S === 0 && (A.normal.dot(toB) <= 0 || B.normal.dot(toB) >= 0)) {
      warnings.push('ściany nie są zwrócone do siebie – użyj łuku (↑)');
    } else {
      const crossed = this.crossesMesh(positions, index.slice(0, remaining), polylines);
      if (crossed === '') warnings.push('most przechodzi przez łączoną bryłę' + (S === 0 ? ' – spróbuj łuku (↑)' : ''));
      else if (crossed) warnings.push(`most przechodzi przez bryłę „${crossed}”`);
    }
    const closed = isClosed(index);
    if (!closed) warnings.push('wynik nie byłby szczelny – nie można zatwierdzić');

    this.result = { positions, index, bridgeTris, warnings, closed };
    this.message(
      `Most – podgląd (${S === 0 ? 'prosty' : `łuk, ${S} segm.`}): Enter zatwierdź · Esc cofnij · ↑/↓ segmenty · ←/→ obróć dopasowanie` +
      (warnings.length ? ` · UWAGA: ${warnings.join('; ')}` : ''),
    );
    this.redraw();
  }

  /**
   * Czy któryś szczebel mostu (krzywa od obrysu A do obrysu B, jako łamana) przecina łączone
   * bryły albo inną bryłę na scenie. Zwraca nazwę przeciętej bryły ('' = łączona) albo null.
   */
  private crossesMesh(positions: Float32Array, rest: number[], curves: THREE.Vector3[][]): string | null {
    const P = (arr: ArrayLike<number>, i: number) => new THREE.Vector3(arr[i * 3], arr[i * 3 + 1], arr[i * 3 + 2]);
    const obstacles: { name: string; pos: ArrayLike<number>; index: ArrayLike<number> }[] = [
      { name: '', pos: positions, index: rest },
    ];
    const joined = new Set([this.a!.baked.mesh, this.b!.baked.mesh]);
    for (const o of this.model.objects) {
      if (joined.has(o)) continue;
      const b = this.bake(o);
      obstacles.push({ name: o.name, pos: b.pos, index: b.index });
    }

    const ray = new THREE.Ray();
    const hit = new THREE.Vector3();
    for (const c of curves) {
      for (let k = 0; k + 1 < c.length; k++) {
        const from = c[k], to = c[k + 1];
        const len = from.distanceTo(to);
        if (len < 1e-6) continue;
        ray.set(from, to.clone().sub(from).normalize());
        for (const ob of obstacles) {
          for (let r = 0; r < ob.index.length; r += 3) {
            const p = ray.intersectTriangle(P(ob.pos, ob.index[r]), P(ob.pos, ob.index[r + 1]), P(ob.pos, ob.index[r + 2]), false, hit);
            if (!p) continue;
            const d = p.distanceTo(from);
            if (d > len * 0.001 && d < len * 0.999) return ob.name;
          }
        }
      }
    }
    return null;
  }

  // ---------- zaznaczanie płaskiej ściany ----------

  private bake(mesh: ModelMesh): Baked {
    let b = this.bakedCache.get(mesh);
    if (b && b.geometry === mesh.geometry) return b;
    mesh.updateMatrixWorld(true);
    const src = mesh.geometry.getAttribute('position');
    const pos = new Float32Array(src.count * 3);
    const v = new THREE.Vector3();
    for (let i = 0; i < src.count; i++) {
      v.fromBufferAttribute(src, i).applyMatrix4(mesh.matrixWorld);
      pos.set([v.x, v.y, v.z], i * 3);
    }
    const index = new Uint32Array(mesh.geometry.getIndex()!.array);
    if (mesh.matrixWorld.determinant() < 0) {
      for (let t = 0; t < index.length; t += 3) [index[t + 1], index[t + 2]] = [index[t + 2], index[t + 1]];
    }
    const adjacency = new Map<string, number[]>();
    for (let t = 0; t < index.length / 3; t++) {
      for (let k = 0; k < 3; k++) {
        const a = index[t * 3 + k], c = index[t * 3 + ((k + 1) % 3)];
        const key = a < c ? `${a}_${c}` : `${c}_${a}`;
        if (!adjacency.has(key)) adjacency.set(key, []);
        adjacency.get(key)!.push(t);
      }
    }
    b = { mesh, geometry: mesh.geometry, pos, index, adjacency };
    this.bakedCache.set(mesh, b);
    return b;
  }

  /** Ściana pod kursorem: trójkąt + wszystkie przyległe trójkąty w tej samej płaszczyźnie. */
  private pickFace(e: PointerEvent): FacePick | { error: string } | null {
    const hit = this.view.rayFromEvent(e).intersectObjects(this.model.objects, false)[0];
    if (!hit || hit.faceIndex == null) return null;
    const baked = this.bake(hit.object as ModelMesh);
    const t0 = hit.faceIndex;

    // jeśli kursor wciąż na tej samej ścianie – nie liczymy od nowa
    for (const f of [this.hover, this.a]) {
      if (f && f.baked === baked && f.tris.has(t0)) return f;
    }

    const P = (i: number) => new THREE.Vector3(baked.pos[i * 3], baked.pos[i * 3 + 1], baked.pos[i * 3 + 2]);
    const triNormal = (t: number) => {
      const a = P(baked.index[t * 3]), b = P(baked.index[t * 3 + 1]), c = P(baked.index[t * 3 + 2]);
      return b.sub(a).cross(c.sub(a));
    };
    const n0 = triNormal(t0).normalize();
    const p0 = P(baked.index[t0 * 3]);

    const tris = new Set([t0]);
    const queue = [t0];
    while (queue.length) {
      const t = queue.pop()!;
      for (let k = 0; k < 3; k++) {
        const a = baked.index[t * 3 + k], c = baked.index[t * 3 + ((k + 1) % 3)];
        for (const u of baked.adjacency.get(a < c ? `${a}_${c}` : `${c}_${a}`) ?? []) {
          if (tris.has(u)) continue;
          const n = triNormal(u);
          if (n.lengthSq() < 1e-12 || n.normalize().dot(n0) < COPLANAR_COS) continue;
          const ok = [0, 1, 2].every((q) => Math.abs(P(baked.index[u * 3 + q]).sub(p0).dot(n0)) < PLANE_TOL);
          if (!ok) continue;
          tris.add(u);
          queue.push(u);
        }
      }
    }

    // obrys: krawędzie należące do jednego trójkąta ściany, w kierunku obiegu trójkątów
    const count = new Map<string, number>();
    for (const t of tris) {
      for (let k = 0; k < 3; k++) {
        const a = baked.index[t * 3 + k], c = baked.index[t * 3 + ((k + 1) % 3)];
        const key = a < c ? `${a}_${c}` : `${c}_${a}`;
        count.set(key, (count.get(key) ?? 0) + 1);
      }
    }
    const next = new Map<number, number>();
    for (const t of tris) {
      for (let k = 0; k < 3; k++) {
        const a = baked.index[t * 3 + k], c = baked.index[t * 3 + ((k + 1) % 3)];
        if (count.get(a < c ? `${a}_${c}` : `${c}_${a}`) !== 1) continue;
        if (next.has(a)) return { error: 'ta ściana ma nietypowy kształt (punkty obrysu się stykają)' };
        next.set(a, c);
      }
    }
    if (next.size < 3) return { error: 'nie udało się wyznaczyć obrysu ściany' };
    const start = next.keys().next().value as number;
    const loop = [start];
    for (let v = next.get(start)!; v !== start; v = next.get(v)!) {
      if (v === undefined || loop.length > next.size) return { error: 'nie udało się wyznaczyć obrysu ściany' };
      loop.push(v);
    }
    if (loop.length !== next.size) {
      return { error: 'ściana z otworem – most łączy tylko ściany bez otworów' };
    }

    const center = loop.reduce((s, i) => s.add(P(i)), new THREE.Vector3()).divideScalar(loop.length);
    return { baked, tris, loop, normal: n0, center };
  }

  // ---------- rysowanie ----------

  private redraw() {
    this.overlays.children.slice().forEach((o) => {
      this.overlays.remove(o);
      o.traverse((c) => {
        const m = c as THREE.Mesh;
        m.geometry?.dispose();
        (m.material as THREE.Material | undefined)?.dispose();
      });
    });
    if (!this.active) return;
    if (this.hover) this.overlays.add(faceOverlay(this.hover, COLOR_HOVER, 0.35));
    if (this.a) this.overlays.add(faceOverlay(this.a, COLOR_A, this.result ? 0 : 0.45));
    if (this.b) this.overlays.add(faceOverlay(this.b, COLOR_B, this.result ? 0 : 0.45));
    if (this.result) this.overlays.add(previewMesh(this.result));
  }
}

// ---------- pomocnicze ----------

function faceOverlay(f: FacePick, color: number, opacity: number): THREE.Group {
  const g = new THREE.Group();
  const P = (i: number) => new THREE.Vector3(f.baked.pos[i * 3], f.baked.pos[i * 3 + 1], f.baked.pos[i * 3 + 2]);
  const lift = f.normal.clone().multiplyScalar(0.05); // minimalnie nad ścianą, żeby nie migotało
  if (opacity > 0) {
    const pts: number[] = [];
    for (const t of f.tris) for (let k = 0; k < 3; k++) pts.push(...P(f.baked.index[t * 3 + k]).add(lift).toArray());
    const geo = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    g.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false })));
  }
  const outline = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(f.loop.map((i) => P(i).add(lift))),
    new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true }),
  );
  outline.renderOrder = 25;
  g.add(outline);
  g.traverse((o) => (o.raycast = () => {}));
  return g;
}

function previewMesh(r: BridgeResult): THREE.Group {
  const g = new THREE.Group();
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(r.positions, 3));
  geo.setIndex(r.bridgeTris);
  const color = r.warnings.length ? 0xff5c5c : 0x4fe36c;
  g.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false })));
  g.add(new THREE.LineSegments(new THREE.WireframeGeometry(geo), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 })));
  g.traverse((o) => (o.raycast = () => {}));
  return g;
}

function concat(a: Float32Array, b: Float32Array) {
  const out = new Float32Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

function flipWinding(g: THREE.BufferGeometry) {
  const idx = g.getIndex()!;
  for (let i = 0; i < idx.count; i += 3) {
    const b = idx.getX(i + 1);
    idx.setX(i + 1, idx.getX(i + 2));
    idx.setX(i + 2, b);
  }
}

/** Każda krawędź skierowana ma bliźniaka w przeciwnym kierunku = bryła zamknięta i spójnie zorientowana. */
function isClosed(index: number[]): boolean {
  const edges = new Map<string, number>();
  for (let t = 0; t < index.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const key = `${index[t + k]}_${index[t + ((k + 1) % 3)]}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  for (const [key, n] of edges) {
    const [a, b] = key.split('_');
    if (n !== 1 || edges.get(`${b}_${a}`) !== 1) return false;
  }
  return true;
}

function bezier(p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3, p3: THREE.Vector3, t: number) {
  const u = 1 - t;
  return p0.clone().multiplyScalar(u * u * u)
    .addScaledVector(p1, 3 * u * u * t)
    .addScaledVector(p2, 3 * u * t * t)
    .addScaledVector(p3, t * t * t);
}

/** Parametr 0..1 każdego punktu obrysu według długości obwodu (od punktu 0). */
function arcParams(pts: THREE.Vector3[]): number[] {
  const n = pts.length;
  const acc = [0];
  for (let i = 1; i < n; i++) acc.push(acc[i - 1] + pts[i - 1].distanceTo(pts[i]));
  const total = acc[n - 1] + pts[n - 1].distanceTo(pts[0]);
  return acc.map((d) => (total > 0 ? d / total : 0));
}

/** Punkt na zamkniętym obrysie dla parametru u (0..1 według długości obwodu). */
function pointOnLoop(pts: THREE.Vector3[], params: number[], u: number): THREE.Vector3 {
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const u0 = params[i], u1 = i + 1 < n ? params[i + 1] : 1;
    if (u >= u0 && u <= u1) {
      const t = u1 > u0 ? (u - u0) / (u1 - u0) : 0;
      return pts[i].clone().lerp(pts[(i + 1) % n], t);
    }
  }
  return pts[0].clone();
}

/**
 * Obrót kierunku `from` na `to`. Przy kierunkach przeciwnych (np. ucho z dwóch ścian w górę)
 * obracamy wokół osi prostopadłej do płaszczyzny wyznaczonej przez `from` i odcinek A→B,
 * żeby łuk szedł nad odcinkiem, a nie w przypadkowym kierunku.
 */
function turnRotation(from: THREE.Vector3, to: THREE.Vector3, ab: THREE.Vector3): THREE.Quaternion {
  if (from.dot(to) > -0.9999) return new THREE.Quaternion().setFromUnitVectors(from, to);
  let axis = from.clone().cross(ab);
  if (axis.lengthSq() < 1e-9) axis = from.clone().cross(Math.abs(from.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0));
  return new THREE.Quaternion().setFromAxisAngle(axis.normalize(), Math.PI);
}
