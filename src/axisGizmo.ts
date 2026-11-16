import * as THREE from 'three';

export type AxisDir = 'px' | 'nx' | 'py' | 'ny' | 'pz' | 'nz';

const AXES: { dir: AxisDir; v: THREE.Vector3; color: number; label?: string }[] = [
  { dir: 'px', v: new THREE.Vector3(1, 0, 0), color: 0xff4f4f, label: 'X' },
  { dir: 'py', v: new THREE.Vector3(0, 1, 0), color: 0x5fd34f, label: 'Y' },
  { dir: 'pz', v: new THREE.Vector3(0, 0, 1), color: 0x4f8dff, label: 'Z' },
  { dir: 'nx', v: new THREE.Vector3(-1, 0, 0), color: 0x8a3030 },
  { dir: 'ny', v: new THREE.Vector3(0, -1, 0), color: 0x3a7a32 },
  { dir: 'nz', v: new THREE.Vector3(0, 0, -1), color: 0x30508a },
];

/**
 * Gizmo orientacji w rogu widoku: pokazuje, jak ustawione są osie,
 * a kliknięcie w kulkę osi ustawia kamerę patrzącą wzdłuż tej osi.
 */
export class AxisGizmo {
  readonly size = 110;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1.6, 1.6, 1.6, -1.6, 0.1, 10);
  private handles: THREE.Mesh[] = [];
  private raycaster = new THREE.Raycaster();
  private hovered: THREE.Mesh | null = null;

  constructor() {
    for (const a of AXES) {
      if (a.label) {
        const line = new THREE.Mesh(
          new THREE.CylinderGeometry(0.04, 0.04, 1, 8).translate(0, 0.5, 0),
          new THREE.MeshBasicMaterial({ color: a.color }),
        );
        line.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), a.v);
        this.scene.add(line);
      }
      const handle = new THREE.Mesh(
        new THREE.SphereGeometry(a.label ? 0.28 : 0.2, 20, 12),
        new THREE.MeshBasicMaterial({ color: a.color }),
      );
      handle.position.copy(a.v).multiplyScalar(1.1);
      if (a.label) {
        const sprite = new THREE.Sprite(
          new THREE.SpriteMaterial({ map: labelTexture(a.label), depthTest: false, transparent: true }),
        );
        sprite.scale.setScalar(0.5);
        sprite.renderOrder = 1;
        sprite.raycast = () => {};
        handle.add(sprite);
      }
      handle.userData.dir = a.dir;
      handle.userData.baseColor = a.color;
      this.scene.add(handle);
      this.handles.push(handle);
    }
  }

  /** Rysuje gizmo w prawym górnym rogu; orientacja kopiowana z kamery głównej. */
  render(renderer: THREE.WebGLRenderer, mainCamera: THREE.Camera, width: number, height: number) {
    this.camera.quaternion.copy(mainCamera.quaternion);
    this.camera.position.set(0, 0, 4).applyQuaternion(mainCamera.quaternion);

    const x = width - this.size - 6;
    const y = height - this.size - 6;
    renderer.clearDepth();
    renderer.setScissorTest(true);
    renderer.setScissor(x, y, this.size, this.size);
    renderer.setViewport(x, y, this.size, this.size);
    renderer.render(this.scene, this.camera);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, width, height);
  }

  /** Zwraca oś pod kursorem (współrzędne względem canvasu) lub null. */
  pick(px: number, py: number, width: number): AxisDir | null {
    const left = width - this.size - 6;
    const top = 6;
    if (px < left || px > left + this.size || py < top || py > top + this.size) return null;
    const ndc = new THREE.Vector2(((px - left) / this.size) * 2 - 1, -((py - top) / this.size) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.intersectObjects(this.handles, false)[0];
    return hit ? (hit.object.userData.dir as AxisDir) : null;
  }

  /** Czy punkt leży w obszarze gizmo (żeby nie zaznaczać obiektów pod nim). */
  contains(px: number, py: number, width: number) {
    const left = width - this.size - 6;
    return px >= left && px <= left + this.size && py >= 6 && py <= 6 + this.size;
  }

  hover(dir: AxisDir | null) {
    const h = this.handles.find((m) => m.userData.dir === dir) ?? null;
    if (h === this.hovered) return;
    if (this.hovered) (this.hovered.material as THREE.MeshBasicMaterial).color.setHex(this.hovered.userData.baseColor);
    if (h) (h.material as THREE.MeshBasicMaterial).color.setHex(0xffffff);
    this.hovered = h;
  }
}

function labelTexture(text: string) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 40px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 32, 34);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
