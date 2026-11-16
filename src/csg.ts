import * as THREE from 'three';
import Module, { type ManifoldToplevel } from 'manifold-3d';
import wasmUrl from 'manifold-3d/manifold.wasm?url';
import { cleanGeometry } from './primitives';
import type { ModelMesh } from './model';
import { t } from './i18n';

/**
 * Operacje logiczne na bryłach (CSG) liczone biblioteką Manifold (WebAssembly).
 * Manifold gwarantuje, że wynik jest szczelną bryłą ("manifold") – dokładnie tego
 * wymagają slicery przy druku 3D.
 */

export type BooleanOp = 'subtract' | 'union' | 'intersect';

let wasm: Promise<ManifoldToplevel> | null = null;
function manifold(): Promise<ManifoldToplevel> {
  wasm ??= Module({ locateFile: () => wasmUrl }).then((m) => {
    m.setup();
    return m;
  });
  return wasm;
}

/** Ładuje bibliotekę z wyprzedzeniem, żeby pierwsza operacja nie czekała. */
export function preloadCSG() {
  manifold().catch(() => {});
}

/** Bryła w układzie świata jako obiekt Manifold. */
function toManifold(lib: ManifoldToplevel, mesh: ModelMesh) {
  mesh.updateMatrixWorld(true);
  const pos = mesh.geometry.getAttribute('position');
  const vert = new Float32Array(pos.count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
    vert.set([v.x, v.y, v.z], i * 3);
  }
  const tri = new Uint32Array(mesh.geometry.getIndex()!.array);
  // ujemna skala (odbicie) odwraca ściany na lewą stronę
  if (mesh.matrixWorld.determinant() < 0) {
    for (let i = 0; i < tri.length; i += 3) [tri[i + 1], tri[i + 2]] = [tri[i + 2], tri[i + 1]];
  }
  const m = new lib.Mesh({ numProp: 3, vertProperties: vert, triVerts: tri });
  m.merge();
  try {
    return new lib.Manifold(m);
  } catch {
    throw new Error(t.misc.notClosedSolid(mesh.name));
  }
}

/**
 * Wykonuje operację `target ∘ tool` i zwraca nową geometrię w lokalnym układzie
 * bryły `target` (zachowuje ona swoją pozycję, obrót i skalę).
 * Zwraca null, jeśli wynik jest pusty.
 */
export async function booleanOp(op: BooleanOp, target: ModelMesh, tool: ModelMesh): Promise<THREE.BufferGeometry | null> {
  const lib = await manifold();
  const a = toManifold(lib, target);
  let b;
  try {
    b = toManifold(lib, tool);
  } catch (e) {
    a.delete();
    throw e;
  }
  const r = op === 'subtract' ? a.subtract(b) : op === 'union' ? a.add(b) : a.intersect(b);
  try {
    if (r.isEmpty()) return null;
    const out = r.getMesh();
    const g = new THREE.BufferGeometry();
    const n = out.numProp;
    const verts = new Float32Array((out.vertProperties.length / n) * 3);
    for (let i = 0, j = 0; i < out.vertProperties.length; i += n, j += 3) {
      verts[j] = out.vertProperties[i];
      verts[j + 1] = out.vertProperties[i + 1];
      verts[j + 2] = out.vertProperties[i + 2];
    }
    g.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    g.setIndex(new THREE.BufferAttribute(out.triVerts, 1));
    g.applyMatrix4(target.matrixWorld.clone().invert());
    return cleanGeometry(g);
  } finally {
    a.delete();
    b.delete();
    r.delete();
  }
}

/** Czy obwiednie dwóch brył w ogóle na siebie zachodzą (szybki test przed CSG). */
export function boxesOverlap(a: ModelMesh, b: ModelMesh) {
  const ba = new THREE.Box3().setFromObject(a);
  const bb = new THREE.Box3().setFromObject(b);
  return ba.intersectsBox(bb);
}

/** Zamknięta siatka w układzie świata (np. wycinak zaokrąglenia). */
export interface RawMesh {
  vertices: number[];
  index: number[];
}

/**
 * Odejmuje od bryły siatki `cut` i dodaje siatki `add` (wszystkie w układzie świata).
 * Zwraca nową geometrię w lokalnym układzie bryły albo null, gdy wynik jest pusty.
 */
export async function applyShapes(target: ModelMesh, cut: RawMesh[], add: RawMesh[]): Promise<THREE.BufferGeometry | null> {
  const lib = await manifold();
  const toM = (r: RawMesh) => {
    const m = new lib.Mesh({ numProp: 3, vertProperties: new Float32Array(r.vertices), triVerts: new Uint32Array(r.index) });
    m.merge();
    return new lib.Manifold(m);
  };
  const created: { delete(): void }[] = [];
  try {
    let result = toManifold(lib, target);
    created.push(result);
    if (cut.length) {
      const tools = cut.map(toM);
      created.push(...tools);
      const all = lib.Manifold.union(tools);
      created.push(all);
      result = result.subtract(all);
      created.push(result);
    }
    if (add.length) {
      const parts = add.map(toM);
      created.push(...parts);
      result = lib.Manifold.union([result, ...parts]);
      created.push(result);
    }
    if (result.isEmpty()) return null;
    const out = result.getMesh();
    const n = out.numProp;
    const verts = new Float32Array((out.vertProperties.length / n) * 3);
    for (let i = 0, j = 0; i < out.vertProperties.length; i += n, j += 3) {
      verts[j] = out.vertProperties[i];
      verts[j + 1] = out.vertProperties[i + 1];
      verts[j + 2] = out.vertProperties[i + 2];
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    g.setIndex(new THREE.BufferAttribute(out.triVerts, 1));
    g.applyMatrix4(target.matrixWorld.clone().invert());
    return cleanGeometry(g);
  } finally {
    created.forEach((m) => m.delete());
  }
}
