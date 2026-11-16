import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Rodzaje brył podstawowych. Wszystkie wymiary w milimetrach, oś Z w górę. */
export type PrimitiveKind = 'box' | 'cylinder' | 'sphere' | 'cone' | 'pyramid';

export const PRIMITIVE_NAMES: Record<PrimitiveKind, string> = {
  box: 'Sześcian',
  cylinder: 'Walec',
  sphere: 'Kula',
  cone: 'Stożek',
  pyramid: 'Ostrosłup',
};

/**
 * Tworzy geometrię bryły. Początek układu lokalnego leży na środku podstawy,
 * dzięki czemu nowa bryła stoi na stole (z = 0), a skalowanie jej nie "zanurza".
 */
export function createPrimitiveGeometry(kind: PrimitiveKind): THREE.BufferGeometry {
  let g: THREE.BufferGeometry;
  switch (kind) {
    case 'box':
      g = new THREE.BoxGeometry(20, 20, 20);
      break;
    case 'cylinder':
      g = new THREE.CylinderGeometry(10, 10, 20, 24, 1);
      g.rotateX(Math.PI / 2); // three.js tworzy walce wzdłuż Y – obracamy na Z
      break;
    case 'sphere':
      g = new THREE.SphereGeometry(10, 24, 12);
      g.rotateX(Math.PI / 2);
      break;
    case 'cone':
      g = new THREE.ConeGeometry(10, 20, 24, 1);
      g.rotateX(Math.PI / 2);
      break;
    case 'pyramid':
      g = new THREE.ConeGeometry(14.142, 20, 4, 1);
      g.rotateX(Math.PI / 2);
      g.rotateZ(Math.PI / 4);
      break;
  }
  g.computeBoundingBox();
  g.translate(0, 0, -g.boundingBox!.min.z);
  return cleanGeometry(g);
}

/**
 * Przygotowuje geometrię do edycji i druku:
 * - zostawia tylko pozycje (normalne/UV rozdzielają wierzchołki na krawędziach),
 * - scala wierzchołki w tym samym miejscu, żeby przeciągnięcie punktu ciągnęło
 *   wszystkie stykające się w nim ściany (siatka pozostaje szczelna – ważne dla STL),
 * - usuwa zdegenerowane trójkąty (np. na biegunach kuli) i punkty bez trójkątów.
 */
export function cleanGeometry(src: THREE.BufferGeometry): THREE.BufferGeometry {
  let g = src.clone();
  for (const name of Object.keys(g.attributes)) {
    if (name !== 'position') g.deleteAttribute(name);
  }
  g = mergeVertices(g, 1e-3); // 0,001 mm – dużo poniżej dokładności drukarki
  const index = g.getIndex()!;
  const kept: number[] = [];
  for (let i = 0; i < index.count; i += 3) {
    const a = index.getX(i), b = index.getX(i + 1), c = index.getX(i + 2);
    if (a !== b && b !== c && a !== c) kept.push(a, b, c);
  }
  // usuwa punkty nienależące do żadnego trójkąta (np. środek usuniętej ściany)
  const pos = g.getAttribute('position');
  const remap = new Int32Array(pos.count).fill(-1);
  const verts: number[] = [];
  for (let k = 0; k < kept.length; k++) {
    const i = kept[k];
    if (remap[i] < 0) {
      remap[i] = verts.length / 3;
      verts.push(pos.getX(i), pos.getY(i), pos.getZ(i));
    }
    kept[k] = remap[i];
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setIndex(kept);
  g.clearGroups();
  g.setDrawRange(0, Infinity);
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

