import * as THREE from 'three';
import { createPrimitiveGeometry, PRIMITIVE_NAMES, type PrimitiveKind } from './primitives';

const PALETTE = [0x4f9dff, 0xff9f40, 0x6cdc5c, 0xe36cff, 0xffd84f, 0x4fe3d6, 0xff6b6b];

/** Dane obiektu zapisywane w pliku projektu i w historii cofania. */
/** Rodzaj bryły: podstawowa albo dowolna siatka (np. wynik mostu). */
export type ObjectKind = PrimitiveKind | 'mesh';

export interface ObjectData {
  id: number;
  name: string;
  kind: ObjectKind;
  color: number;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
  vertices: number[];
  index: number[];
}

export interface DocData {
  version: 1;
  objects: ObjectData[];
}

export type ModelMesh = THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;

/**
 * Dokument: lista brył, zaznaczenie i historia cofania.
 * Historia działa na migawkach całej sceny – przy prostych modelach to tanie i niezawodne.
 */
export class Model {
  readonly root = new THREE.Group();
  objects: ModelMesh[] = [];
  selected: ModelMesh | null = null;

  private nextId = 1;
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private listeners = new Set<() => void>();

  onChange(fn: () => void) {
    this.listeners.add(fn);
  }

  /** Powiadamia UI/viewport, że coś się zmieniło. */
  emit() {
    this.listeners.forEach((fn) => fn());
  }

  // ---------- tworzenie / usuwanie ----------

  addPrimitive(kind: PrimitiveKind, at?: THREE.Vector3): ModelMesh {
    this.checkpoint();
    const sameKind = this.objects.filter((o) => o.userData.kind === kind).length;
    const mesh = this.createMesh({
      id: this.nextId++,
      name: `${PRIMITIVE_NAMES[kind]} ${sameKind + 1}`,
      kind,
      color: PALETTE[this.objects.length % PALETTE.length],
      position: [at?.x ?? 0, at?.y ?? 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      vertices: [],
      index: [],
    }, createPrimitiveGeometry(kind));
    this.select(mesh);
    return mesh;
  }

  /**
   * Tworzy `count` kopii bryły ustawionych w rzędzie: każda kolejna przesunięta o `step` (mm).
   * Domyślnie obok oryginału, z przerwą 5 mm (bez względu na rozmiar bryły).
   * Jedna operacja w historii; zaznaczona zostaje ostatnia kopia.
   */
  duplicate(src: ModelMesh, count = 1, step?: THREE.Vector3): ModelMesh[] {
    if (count < 1) return [];
    this.checkpoint();
    if (!step) {
      src.updateMatrixWorld(true);
      const width = new THREE.Box3().setFromObject(src, true).getSize(new THREE.Vector3()).x;
      step = new THREE.Vector3(width + 5, 0, 0);
    }
    const base = src.name.replace(/ \(\d+\)$/, '');
    const copies: ModelMesh[] = [];
    for (let k = 1; k <= count; k++) {
      const data = this.serializeObject(src);
      data.id = this.nextId++;
      data.name = this.nextCopyName(base);
      data.position[0] += step.x * k;
      data.position[1] += step.y * k;
      data.position[2] += step.z * k;
      copies.push(this.createMesh(data));
    }
    this.select(copies[copies.length - 1]);
    return copies;
  }

  /** "Sześcian 1" → "Sześcian 1 (2)", "Sześcian 1 (3)"… – pierwszy wolny numer. */
  private nextCopyName(base: string) {
    const names = new Set(this.objects.map((o) => o.name));
    let n = 2;
    while (names.has(`${base} (${n})`)) n++;
    return `${base} (${n})`;
  }

  remove(mesh: ModelMesh) {
    this.checkpoint();
    this.detach(mesh);
    if (this.selected === mesh) this.selected = null;
    this.emit();
  }

  /** Podmienia geometrię bryły (np. wynik wycinania). Wołać po checkpoint(). */
  replaceGeometry(mesh: ModelMesh, geometry: THREE.BufferGeometry) {
    mesh.geometry.dispose();
    mesh.geometry = geometry;
    refreshEdges(mesh);
  }

  /** Usuwa bryłę bez zapisu w historii – dla operacji złożonych, które same robią checkpoint(). */
  removeSilently(mesh: ModelMesh) {
    this.detach(mesh);
    if (this.selected === mesh) this.selected = null;
  }

  select(mesh: ModelMesh | null) {
    this.selected = mesh;
    this.objects.forEach((o) => updateEdgeColor(o, o === mesh));
    this.emit();
  }

  private createMesh(data: ObjectData, geometry?: THREE.BufferGeometry): ModelMesh {
    if (!geometry) {
      geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.vertices, 3));
      geometry.setIndex(data.index);
      geometry.computeVertexNormals();
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
    }
    const material = new THREE.MeshStandardMaterial({
      color: data.color,
      roughness: 0.6,
      metalness: 0.05,
      flatShading: true, // pokazuje faktyczne ścianki, tak jak wyjdą w STL
      polygonOffset: true, // krawędzie rysują się czytelnie na powierzchni
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    const mesh = new THREE.Mesh(geometry, material) as ModelMesh;
    mesh.name = data.name;
    mesh.userData = { id: data.id, kind: data.kind };
    mesh.position.fromArray(data.position);
    mesh.rotation.set(data.rotation[0], data.rotation[1], data.rotation[2]);
    mesh.scale.fromArray(data.scale);
    mesh.castShadow = mesh.receiveShadow = true;
    refreshEdges(mesh);
    this.objects.push(mesh);
    this.root.add(mesh);
    this.nextId = Math.max(this.nextId, data.id + 1);
    return mesh;
  }

  private detach(mesh: ModelMesh) {
    this.root.remove(mesh);
    this.objects = this.objects.filter((o) => o !== mesh);
    mesh.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
  }

  // ---------- historia ----------

  /** Zapamiętuje stan PRZED zmianą. Wołać tuż przed modyfikacją sceny. */
  checkpoint() {
    this.undoStack.push(this.snapshot());
    if (this.undoStack.length > 100) this.undoStack.shift();
    this.redoStack = [];
  }

  clearHistory() {
    this.undoStack = [];
    this.redoStack = [];
  }

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }

  undo() {
    const s = this.undoStack.pop();
    if (!s) return;
    this.redoStack.push(this.snapshot());
    this.restore(s);
  }

  redo() {
    const s = this.redoStack.pop();
    if (!s) return;
    this.undoStack.push(this.snapshot());
    this.restore(s);
  }

  private snapshot(): string {
    return JSON.stringify({ doc: this.serialize(), selected: this.selected?.userData.id ?? null });
  }

  private restore(s: string) {
    const { doc, selected } = JSON.parse(s) as { doc: DocData; selected: number | null };
    this.load(doc, false);
    this.select(this.objects.find((o) => o.userData.id === selected) ?? null);
  }

  // ---------- serializacja ----------

  serializeObject(mesh: ModelMesh): ObjectData {
    const pos = mesh.geometry.getAttribute('position');
    return {
      id: mesh.userData.id,
      name: mesh.name,
      kind: mesh.userData.kind,
      color: mesh.material.color.getHex(),
      position: mesh.position.toArray() as [number, number, number],
      rotation: [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z],
      scale: mesh.scale.toArray() as [number, number, number],
      vertices: Array.from(pos.array as Float32Array, (v) => Math.round(v * 1e4) / 1e4),
      index: Array.from(mesh.geometry.getIndex()!.array),
    };
  }

  serialize(): DocData {
    return { version: 1, objects: this.objects.map((o) => this.serializeObject(o)) };
  }

  /** Wczytuje dokument. `asNew` = otwarcie pliku (czyści historię). */
  load(doc: DocData, asNew = true) {
    [...this.objects].forEach((o) => this.detach(o));
    this.selected = null;
    doc.objects.forEach((d) => this.createMesh(d));
    if (asNew) {
      this.clearHistory();
      this.select(null);
    }
  }
}

// ---------- krawędzie (linie na bryle) ----------

const EDGE_COLOR = 0x15181c;
const EDGE_SELECTED = 0xffffff;

/** Odbudowuje linie krawędzi bryły – wołać po każdej zmianie geometrii. */
export function refreshEdges(mesh: ModelMesh) {
  let edges = mesh.getObjectByName('__edges') as THREE.LineSegments | undefined;
  const geo = new THREE.EdgesGeometry(mesh.geometry, 20);
  if (edges) {
    edges.geometry.dispose();
    edges.geometry = geo;
  } else {
    edges = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: EDGE_COLOR }));
    edges.name = '__edges';
    edges.raycast = () => {}; // linie nie biorą udziału w zaznaczaniu
    mesh.add(edges);
  }
}

function updateEdgeColor(mesh: ModelMesh, selected: boolean) {
  const edges = mesh.getObjectByName('__edges') as THREE.LineSegments | undefined;
  if (edges) (edges.material as THREE.LineBasicMaterial).color.setHex(selected ? EDGE_SELECTED : EDGE_COLOR);
}

/** Wymiary bryły w jej lokalnych osiach, z uwzględnieniem skali (mm). */
export function objectSize(mesh: ModelMesh): THREE.Vector3 {
  mesh.geometry.computeBoundingBox();
  return mesh.geometry.boundingBox!.getSize(new THREE.Vector3()).multiply(mesh.scale);
}

/** Opuszcza bryłę tak, żeby jej najniższy punkt leżał na stole (z = 0). */
export function dropToPlate(mesh: ModelMesh) {
  mesh.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(mesh, true);
  mesh.position.z -= box.min.z;
}
