import * as THREE from 'three';

/**
 * Symetria przy edycji punktów: płaszczyzna lustra prostopadła do osi bryły
 * (w jej lokalnym układzie), np. axis = 'x', offset = 0 → płaszczyzna x = 0.
 */
export type MirrorAxis = 'x' | 'y' | 'z';
export interface MirrorSettings {
  axis: MirrorAxis;
  offset: number; // położenie płaszczyzny wzdłuż osi (mm, układ lokalny bryły)
}

const AXIS_INDEX: Record<MirrorAxis, 0 | 1 | 2> = { x: 0, y: 1, z: 2 };
export const MIRROR_TOLERANCE = 0.01; // mm – punkty bliżej siebie uznajemy za parę

/** Odbicie punktu względem płaszczyzny lustra. */
export function reflect(v: THREE.Vector3, m: MirrorSettings): THREE.Vector3 {
  const r = v.clone();
  r[m.axis] = 2 * m.offset - r[m.axis];
  return r;
}

/** Czy punkt leży na płaszczyźnie lustra. */
export function onPlane(v: THREE.Vector3, m: MirrorSettings) {
  return Math.abs(v[m.axis] - m.offset) < MIRROR_TOLERANCE;
}

/**
 * Dla każdego wierzchołka znajduje jego lustrzaną parę.
 * Wynik: indeks pary, ten sam indeks dla punktów na płaszczyźnie, -1 gdy brak pary.
 * Używa siatki przestrzennej, więc działa szybko także dla dużych siatek po CSG.
 */
export function findMirrorPairs(pos: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, m: MirrorSettings): Int32Array {
  const n = pos.count;
  const cell = MIRROR_TOLERANCE * 2;
  const key = (x: number, y: number, z: number) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
  const grid = new Map<string, number[]>();
  const v = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(pos, i);
    const k = key(v.x, v.y, v.z);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k)!.push(i);
  }

  const pairs = new Int32Array(n).fill(-1);
  const w = new THREE.Vector3();
  const tol2 = MIRROR_TOLERANCE * MIRROR_TOLERANCE;
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(pos, i);
    if (onPlane(v, m)) {
      pairs[i] = i;
      continue;
    }
    const r = reflect(v, m);
    let best = -1;
    let bestD = tol2;
    const cx = Math.floor(r.x / cell), cy = Math.floor(r.y / cell), cz = Math.floor(r.z / cell);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      for (const j of grid.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) {
        const d = w.fromBufferAttribute(pos, j).distanceToSquared(r);
        if (d <= bestD) {
          bestD = d;
          best = j;
        }
      }
    }
    pairs[i] = best;
  }
  return pairs;
}

/**
 * Po przesunięciu punktów `changed` ustawia ich lustrzane pary (układ lokalny).
 * Jeśli zmieniono oba punkty pary, wiodący jest ten o mniejszym indeksie.
 * Punkty leżące na płaszczyźnie zostają na niej.
 */
export function applyMirror(
  pos: THREE.BufferAttribute,
  pairs: Int32Array,
  changed: Iterable<number>,
  m: MirrorSettings,
) {
  const set = new Set(changed);
  const a = AXIS_INDEX[m.axis];
  const v = new THREE.Vector3();
  for (const i of set) {
    const j = pairs[i];
    if (j < 0) continue;
    v.fromBufferAttribute(pos, i);
    if (j === i) {
      v.setComponent(a, m.offset);
      pos.setXYZ(i, v.x, v.y, v.z);
      continue;
    }
    if (set.has(j) && j < i) continue; // tę parę prowadzi j
    const r = reflect(v, m);
    pos.setXYZ(j, r.x, r.y, r.z);
  }
  pos.needsUpdate = true;
}

const AXIS_COLORS: Record<MirrorAxis, number> = { x: 0xff5c5c, y: 0x6cdc5c, z: 0x5c9dff };

/** Półprzezroczysta tafla pokazująca płaszczyznę lustra (dziecko bryły). */
export function createMirrorPlane(geometry: THREE.BufferGeometry, m: MirrorSettings): THREE.Group {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  const size = box.getSize(new THREE.Vector3()).addScalar(10).multiplyScalar(1.15);
  const center = box.getCenter(new THREE.Vector3());
  center[m.axis] = m.offset;

  const group = new THREE.Group();
  group.name = '__mirrorPlane';
  const plane = new THREE.PlaneGeometry(1, 1);
  const outline = new THREE.EdgesGeometry(plane);
  const fill = new THREE.Mesh(plane, new THREE.MeshBasicMaterial({
    color: AXIS_COLORS[m.axis], transparent: true, opacity: 0.14, side: THREE.DoubleSide, depthWrite: false,
  }));
  const line = new THREE.LineSegments(outline, new THREE.LineBasicMaterial({
    color: AXIS_COLORS[m.axis], transparent: true, opacity: 0.8,
  }));
  group.add(fill, line);
  // PlaneGeometry leży w XY – obracamy tak, by normalna wskazywała oś lustra
  if (m.axis === 'x') {
    group.rotation.y = Math.PI / 2;
    group.scale.set(size.z, size.y, 1);
  } else if (m.axis === 'y') {
    group.rotation.x = Math.PI / 2;
    group.scale.set(size.x, size.z, 1);
  } else {
    group.scale.set(size.x, size.y, 1);
  }
  group.position.copy(center);
  group.traverse((o) => (o.raycast = () => {}));
  return group;
}

/** Środek obwiedni bryły wzdłuż osi – domyślne położenie lustra. */
export function centerOffset(geometry: THREE.BufferGeometry, axis: MirrorAxis) {
  geometry.computeBoundingBox();
  const c = geometry.boundingBox!.getCenter(new THREE.Vector3())[axis];
  return Math.round(c * 1000) / 1000;
}

/**
 * Czy podział na trójkąty jest symetryczny: każdy trójkąt ma lustrzany odpowiednik
 * (trójkąt zbudowany z par jego wierzchołków). Sama symetria punktów nie wystarcza –
 * gdy przekątne ścian biegną po obu stronach "w tę samą stronę", po wygięciu ściany
 * bryła przestaje być symetryczna.
 */
export function isTopologySymmetric(index: ArrayLike<number>, pairs: Int32Array): boolean {
  const key = (a: number, b: number, c: number) => [a, b, c].sort((x, y) => x - y).join('_');
  const tris = new Set<string>();
  for (let t = 0; t < index.length; t += 3) tris.add(key(index[t], index[t + 1], index[t + 2]));
  for (let t = 0; t < index.length; t += 3) {
    const a = pairs[index[t]], b = pairs[index[t + 1]], c = pairs[index[t + 2]];
    if (a < 0 || b < 0 || c < 0 || !tris.has(key(a, b, c))) return false;
  }
  return true;
}

/**
 * Symetryzacja: przecina siatkę płaszczyzną lustra, zostawia połowę `keep`
 * (+1: strona dodatnia osi, -1: ujemna) i dobudowuje jej lustrzane odbicie.
 * Wynik jest zamkniętą bryłą, symetryczną co do każdego trójkąta.
 * Zwraca pozycje i indeksy (układ lokalny) albo null, gdy po tej stronie nic nie ma.
 */
export function symmetrize(
  pos: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  index: ArrayLike<number>,
  m: MirrorSettings,
  keep: 1 | -1,
): { vertices: number[]; index: number[] } | null {
  const a = AXIS_INDEX[m.axis];
  const verts: number[] = [];
  const dist: number[] = [];
  for (let i = 0; i < pos.count; i++) {
    const v = [pos.getX(i), pos.getY(i), pos.getZ(i)];
    let d = (v[a] - m.offset) * keep;
    if (Math.abs(d) < MIRROR_TOLERANCE) {
      d = 0;
      v[a] = m.offset; // dokładnie na płaszczyźnie
    }
    verts.push(...v);
    dist.push(d);
  }

  // punkt przecięcia krawędzi z płaszczyzną – wspólny dla sąsiednich trójkątów
  const cut = new Map<string, number>();
  const cutPoint = (i: number, j: number) => {
    const k = i < j ? `${i}_${j}` : `${j}_${i}`;
    let n = cut.get(k);
    if (n === undefined) {
      const t = dist[i] / (dist[i] - dist[j]);
      const p = [0, 1, 2].map((c) => verts[i * 3 + c] + (verts[j * 3 + c] - verts[i * 3 + c]) * t);
      p[a] = m.offset;
      n = verts.length / 3;
      verts.push(...p);
      dist.push(0);
      cut.set(k, n);
    }
    return n;
  };

  // przycinanie każdego trójkąta do zachowanej półprzestrzeni (Sutherland–Hodgman)
  const half: number[] = [];
  for (let t = 0; t < index.length; t += 3) {
    const tri = [index[t], index[t + 1], index[t + 2]];
    if (tri.every((i) => dist[i] === 0)) continue; // ściana leżąca w samym lustrze – po odbiciu byłaby w środku bryły
    const poly: number[] = [];
    for (let k = 0; k < 3; k++) {
      const i = tri[k], j = tri[(k + 1) % 3];
      if (dist[i] >= 0) poly.push(i);
      if ((dist[i] > 0 && dist[j] < 0) || (dist[i] < 0 && dist[j] > 0)) poly.push(cutPoint(i, j));
    }
    for (let k = 1; k + 1 < poly.length; k++) half.push(poly[0], poly[k], poly[k + 1]);
  }
  if (half.length === 0) return null;

  // wierzchołki używane przez połowę + ich odbicia (punkty z lustra są wspólne)
  const used = [...new Set(half)];
  const outVerts: number[] = [];
  const remap = new Map<number, number>();
  const mirrorOf = new Map<number, number>();
  for (const i of used) {
    remap.set(i, outVerts.length / 3);
    outVerts.push(verts[i * 3], verts[i * 3 + 1], verts[i * 3 + 2]);
  }
  for (const i of used) {
    if (dist[i] === 0) {
      mirrorOf.set(i, remap.get(i)!);
      continue;
    }
    const p = [verts[i * 3], verts[i * 3 + 1], verts[i * 3 + 2]];
    p[a] = 2 * m.offset - p[a];
    mirrorOf.set(i, outVerts.length / 3);
    outVerts.push(...p);
  }
  const outIndex: number[] = [];
  for (let t = 0; t < half.length; t += 3) {
    const [x, y, z] = [half[t], half[t + 1], half[t + 2]];
    outIndex.push(remap.get(x)!, remap.get(y)!, remap.get(z)!);
    // odbicie odwraca orientację – zamieniamy kolejność, żeby ściany patrzyły na zewnątrz
    outIndex.push(mirrorOf.get(x)!, mirrorOf.get(z)!, mirrorOf.get(y)!);
  }
  return { vertices: outVerts, index: outIndex };
}
