import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { AxisGizmo, type AxisDir } from './axisGizmo';
import { t } from './i18n';

export type ViewMode = '3d' | 'top';

/** Rozmiar stołu drukarki w mm (typowe 220×220, np. Ender 3 / Prusa MK3 ~250×210). */
export const BED = { x: 220, y: 220 };

/**
 * Viewport: renderer, dwie kamery (perspektywa 3D i ortogonalna z góry),
 * sterowanie kamerą, stół roboczy z siatką i gizmo orientacji.
 */
export class Viewport {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly perspCamera: THREE.PerspectiveCamera;
  readonly topCamera: THREE.OrthographicCamera;
  readonly perspControls: OrbitControls;
  readonly topControls: OrbitControls;
  readonly transform: TransformControls;
  readonly gizmo = new AxisGizmo();
  mode: ViewMode = '3d';

  private label: HTMLDivElement;
  private sun: THREE.DirectionalLight;
  private viewListeners = new Set<(m: ViewMode) => void>();
  private frameListeners = new Set<() => void>();
  private width = 1;
  private height = 1;

  constructor(readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.autoClear = false;
    this.renderer.shadowMap.enabled = true;
    container.appendChild(this.renderer.domElement);

    this.label = document.createElement('div');
    this.label.className = 'view-label';
    container.appendChild(this.label);

    this.scene.background = new THREE.Color(0x2b3037);

    // --- kamery ---
    this.perspCamera = new THREE.PerspectiveCamera(45, 1, 1, 5000);
    this.perspCamera.up.set(0, 0, 1); // oś Z w górę, jak w drukarkach i plikach STL
    this.perspCamera.position.set(180, -260, 200);
    this.topCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 5000);
    this.topCamera.up.set(0, 1, 0); // na ekranie: X w prawo, Y w górę
    this.topCamera.position.set(0, 0, 1000);
    this.topCamera.zoom = 2.2;

    // --- sterowanie: PPM obrót, ŚPM przesuw, kółko zoom; LPM zostaje dla modelowania ---
    this.perspControls = new OrbitControls(this.perspCamera, this.renderer.domElement);
    this.perspControls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
    this.perspControls.target.set(0, 0, 10);
    this.perspControls.enableDamping = true;
    this.perspControls.dampingFactor = 0.15;
    this.perspControls.screenSpacePanning = true;
    this.perspControls.update();

    this.topControls = new OrbitControls(this.topCamera, this.renderer.domElement);
    this.topControls.enableRotate = false;
    this.topControls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN };
    this.topControls.screenSpacePanning = true;
    this.topControls.target.set(0, 0, 0);
    this.topControls.enabled = false;
    this.topControls.update();

    // --- światła ---
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x404850, 1.6));
    const sun = (this.sun = new THREE.DirectionalLight(0xffffff, 1.8));
    sun.position.set(120, -160, 300);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -200, right: 200, top: 200, bottom: -200, near: 10, far: 800 });
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0xffffff, 0.6);
    fill.position.set(-200, 150, 100);
    this.scene.add(fill);

    this.buildBed();

    // --- gizmo przesuwania/obrotu/skali obiektu ---
    this.transform = new TransformControls(this.perspCamera, this.renderer.domElement);
    this.transform.setSize(0.9);
    this.scene.add(this.transform.getHelper());
    this.transform.addEventListener('dragging-changed', (e) => {
      this.activeControls.enabled = !e.value;
    });

    this.bindGizmoClicks();
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    this.setView('3d');
    this.renderer.setAnimationLoop(() => this.render());
  }

  get camera(): THREE.PerspectiveCamera | THREE.OrthographicCamera {
    return this.mode === '3d' ? this.perspCamera : this.topCamera;
  }

  get activeControls(): OrbitControls {
    return this.mode === '3d' ? this.perspControls : this.topControls;
  }

  /** Wywoływane w każdej klatce przed rysowaniem (np. etykiety nad sceną). */
  onFrame(fn: () => void) {
    this.frameListeners.add(fn);
  }

  /** Wymiary canvasu w pikselach CSS. */
  get size() {
    return { width: this.width, height: this.height };
  }

  onViewChange(fn: (m: ViewMode) => void) {
    this.viewListeners.add(fn);
  }

  setView(mode: ViewMode) {
    this.mode = mode;
    this.perspControls.enabled = mode === '3d';
    this.topControls.enabled = mode === 'top';
    this.transform.camera = this.camera;
    this.sun.castShadow = mode === '3d'; // w widoku z góry cienie tylko zaciemniają rzut
    this.label.textContent = mode === '3d' ? t.view.persp : t.view.top;
    this.viewListeners.forEach((fn) => fn(mode));
  }

  /** Ustawia kamerę 3D tak, by patrzyła wzdłuż wybranej osi (kliknięcie w gizmo). */
  lookAlong(dir: AxisDir) {
    if (dir === 'pz') {
      this.topControls.target.set(this.perspControls.target.x, this.perspControls.target.y, 0);
      this.topCamera.position.set(this.topControls.target.x, this.topControls.target.y, 1000);
      this.topControls.update();
      this.setView('top');
      return;
    }
    const t = this.perspControls.target;
    const dist = this.perspCamera.position.distanceTo(t);
    const v: Record<AxisDir, THREE.Vector3> = {
      px: new THREE.Vector3(1, 0, 0),
      nx: new THREE.Vector3(-1, 0, 0),
      py: new THREE.Vector3(0, 1, 0),
      ny: new THREE.Vector3(0, -1, 0),
      pz: new THREE.Vector3(0, 0, 1),
      nz: new THREE.Vector3(0, 0.001, -1).normalize(), // minimalne odchylenie – kamera nie może patrzeć idealnie wzdłuż "up"
    };
    this.perspCamera.position.copy(t).addScaledVector(v[dir], dist);
    this.perspControls.update();
    this.setView('3d');
  }

  /** Promień z kamery przez punkt kursora. */
  rayFromEvent(e: PointerEvent | MouseEvent): THREE.Raycaster {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    this.camera.updateMatrixWorld(); // kamera mogła się zmienić od ostatniej klatki
    ray.setFromCamera(ndc, this.camera);
    return ray;
  }

  /** Rzutuje punkt świata na piksele canvasu. */
  toScreen(p: THREE.Vector3): { x: number; y: number; z: number } {
    this.camera.updateMatrixWorld();
    const v = p.clone().project(this.camera);
    return { x: (v.x + 1) * 0.5 * this.width, y: (1 - v.y) * 0.5 * this.height, z: v.z };
  }

  localPoint(e: PointerEvent | MouseEvent) {
    const r = this.renderer.domElement.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private buildBed() {
    const bed = new THREE.Group();
    bed.name = '__bed';
    // płyta stołu
    const plate = new THREE.Mesh(
      new THREE.PlaneGeometry(BED.x, BED.y),
      new THREE.MeshStandardMaterial({ color: 0x3a4049, roughness: 0.9 }),
    );
    plate.position.z = -0.05;
    plate.receiveShadow = true;
    bed.add(plate);

    // siatka 1 mm (drobna), 10 mm (główna)
    const fine = new THREE.GridHelper(BED.x, BED.x, 0x4a515b, 0x434952);
    const major = new THREE.GridHelper(BED.x, BED.x / 10, 0x6b7480, 0x6b7480);
    for (const g of [fine, major]) {
      g.rotation.x = Math.PI / 2; // GridHelper leży w XZ – kładziemy na XY
      (g.material as THREE.Material).transparent = true;
    }
    (fine.material as THREE.Material).opacity = 0.35;
    (major.material as THREE.Material).opacity = 0.8;
    fine.name = '__fineGrid';
    bed.add(fine, major);

    // osie X (czerwona) i Y (zielona) od środka stołu
    const axes = new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0.02), new THREE.Vector3(BED.x / 2, 0, 0.02),
        new THREE.Vector3(0, 0, 0.02), new THREE.Vector3(0, BED.y / 2, 0.02),
      ]),
      new THREE.LineBasicMaterial({ vertexColors: true }),
    );
    axes.geometry.setAttribute('color', new THREE.Float32BufferAttribute([1, .3, .3, 1, .3, .3, .4, .9, .3, .4, .9, .3], 3));
    bed.add(axes);
    bed.traverse((o) => (o.raycast = () => {}));
    this.scene.add(bed);
  }

  private bindGizmoClicks() {
    const el = this.renderer.domElement;
    el.addEventListener('pointermove', (e) => {
      const p = this.localPoint(e);
      const dir = this.gizmo.pick(p.x, p.y, this.width);
      this.gizmo.hover(dir);
      el.style.cursor = dir ? 'pointer' : '';
    });
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const p = this.localPoint(e);
      const dir = this.gizmo.pick(p.x, p.y, this.width);
      if (dir) this.lookAlong(dir);
    });
  }

  private resize() {
    this.width = this.container.clientWidth || 1;
    this.height = this.container.clientHeight || 1;
    this.renderer.setSize(this.width, this.height);
    this.perspCamera.aspect = this.width / this.height;
    this.perspCamera.updateProjectionMatrix();
    const halfH = 120;
    const halfW = halfH * (this.width / this.height);
    Object.assign(this.topCamera, { left: -halfW, right: halfW, top: halfH, bottom: -halfH });
    this.topCamera.updateProjectionMatrix();
  }

  private render() {
    this.activeControls.update();
    // drobna siatka 1 mm tylko przy zbliżeniu – z daleka zlewa się w szum
    const fine = this.scene.getObjectByName('__fineGrid')!;
    fine.visible = this.mode === 'top'
      ? this.topCamera.zoom > 3
      : this.perspCamera.position.distanceTo(this.perspControls.target) < 180;
    this.frameListeners.forEach((fn) => fn());
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    this.gizmo.render(this.renderer, this.camera, this.width, this.height);
  }
}
