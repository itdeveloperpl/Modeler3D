import * as THREE from 'three';
import { dropToPlate, objectSize, type Model, type ModelMesh } from './model';
import type { VertexEditor } from './vertexEditor';
import { t } from './i18n';
import { fromUnit, inputStep, lenValue, toUnit, unit, unitLabel } from './units';

type Axis = 'x' | 'y' | 'z';
const AXES: Axis[] = ['x', 'y', 'z'];

const fmt = (v: number, digits = 2) => {
  const r = Number(v.toFixed(digits));
  return Object.is(r, -0) ? '0' : String(r);
};

/** Lista obiektów i panel właściwości. */
export class Sidebar {
  private outliner = document.getElementById('outliner') as HTMLUListElement;
  private body = document.getElementById('props-body') as HTMLDivElement;
  private builtFor = '';
  private inputs = new Map<string, HTMLInputElement>();

  constructor(
    private model: Model,
    private editor: VertexEditor,
    private getMode: () => 'object' | 'vertex',
    private actions: {
      duplicate(m: ModelMesh, count?: number, step?: THREE.Vector3): void;
    },
  ) {
    // Enter zatwierdza i opuszcza pole (wtedy Ctrl+Z cofa zmianę bryły, a nie tekst w polu),
    // Esc przywraca bieżącą wartość
    document.getElementById('sidebar')!.addEventListener('keydown', (e) => {
      const el = e.target as HTMLElement;
      if (el.tagName !== 'INPUT') return;
      if (e.key === 'Enter') el.blur();
      if (e.key === 'Escape') {
        el.blur();
        this.updateValues();
      }
    });
  }

  refresh() {
    this.renderOutliner();
    this.renderProps();
  }

  /** Buduje panel od nowa (np. po zmianie języka). */
  rebuild() {
    this.builtFor = '';
    this.refresh();
  }

  private renderOutliner() {
    this.outliner.innerHTML = '';
    if (this.model.objects.length === 0) {
      const li = document.createElement('li');
      li.className = 'muted';
      li.style.cursor = 'default';
      li.textContent = t.sidebar.empty;
      this.outliner.appendChild(li);
      return;
    }
    for (const o of this.model.objects) {
      const li = document.createElement('li');
      const s = objectSize(o);
      li.innerHTML = `<span></span><span class="dim">${lenValue(s.x, 1)}×${lenValue(s.y, 1)}×${lenValue(s.z, 1)}</span>`;
      li.firstElementChild!.textContent = o.name;
      if (o === this.model.selected) li.classList.add('selected');
      li.onclick = () => this.model.select(o);
      this.outliner.appendChild(li);
    }
  }

  private renderProps() {
    const sel = this.model.selected;
    const mode = this.getMode();
    const key = sel
      ? `${sel.uuid}:${mode}:${mode === 'vertex' ? `${this.editor.selection.size > 0}:${this.editor.mirror?.axis}` : ''}`
      : 'none';
    if (key !== this.builtFor) {
      this.builtFor = key;
      this.inputs.clear();
      this.body.innerHTML = '';
      if (!sel) this.body.innerHTML = `<p class="muted">${t.sidebar.nothingSelected}</p>`;
      else if (mode === 'object') this.buildObjectProps(sel);
      else this.buildVertexProps();
    }
    this.updateValues();
  }

  // ---------- tryb obiektu ----------

  private buildObjectProps(sel: ModelMesh) {
    const name = document.createElement('input');
    name.className = 'name-input';
    name.value = sel.name;
    name.onchange = () => {
      this.model.checkpoint();
      sel.name = name.value.trim() || sel.name;
      this.model.emit();
    };
    this.body.appendChild(name);

    const color = document.createElement('div');
    color.className = 'color-row';
    color.innerHTML = `<span>${t.sidebar.color}</span>`;
    const ci = document.createElement('input');
    ci.type = 'color';
    ci.value = '#' + sel.material.color.getHexString();
    ci.onchange = () => {
      this.model.checkpoint();
      sel.material.color.set(ci.value);
      this.model.emit();
    };
    color.appendChild(ci);
    this.body.appendChild(color);

    this.body.appendChild(axisHeader());
    this.row(t.sidebar.position, 'pos', (a, v) => { sel.position[a] = fromUnit(v); });
    this.row(t.sidebar.rotation, 'rot', (a, v) => { sel.rotation[a] = THREE.MathUtils.degToRad(v); });
    this.row(t.sidebar.size, 'size', (a, value) => {
      const v = fromUnit(value);
      if (v <= 0) return;
      const base = sel.geometry.boundingBox!.getSize(new THREE.Vector3())[a];
      if (base > 1e-6) sel.scale[a] = v / base;
    });
    this.buildRoundProps(sel);

    const btns = document.createElement('div');
    btns.className = 'btn-row';
    btns.append(
      button(t.sidebar.dropToBed, () => { this.model.checkpoint(); dropToPlate(sel); this.model.emit(); }),
    );
    this.body.appendChild(btns);
    this.buildArrayProps(sel);
  }

  /** Powielanie: wiele kopii w rzędzie wzdłuż X lub Y, z zadaną przerwą między bryłami. */
  private buildArrayProps(sel: ModelMesh) {
    const box = document.createElement('div');
    box.className = 'ops';
    box.innerHTML = `<h3>${t.sidebar.array}</h3>`;
    const grid = document.createElement('div');
    grid.className = 'param-grid';

    const num = (label: string, value: string, unit: string, min: string, step: string) => {
      const l = document.createElement('label');
      l.textContent = label;
      const input = document.createElement('input');
      input.type = 'number';
      input.value = value;
      input.min = min;
      input.step = step;
      const u = document.createElement('span');
      u.textContent = unit;
      grid.append(l, input, u);
      return input;
    };
    const count = num(t.sidebar.copies, this.arrayState.count, t.sidebar.pcs, '1', '1');
    const gap = num(t.sidebar.gap, this.arrayState.gap, unitLabel(), '0', inputStep());
    count.oninput = () => (this.arrayState.count = count.value);
    gap.oninput = () => (this.arrayState.gap = gap.value);

    const dirLabel = document.createElement('label');
    dirLabel.textContent = t.sidebar.direction;
    const dirs = document.createElement('div');
    dirs.className = 'btn-row seg';
    dirs.style.margin = '0';
    for (const d of ['x', 'y'] as const) {
      const b = button(d.toUpperCase(), () => {
        this.arrayState.dir = d;
        dirs.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
      });
      b.classList.toggle('active', this.arrayState.dir === d);
      dirs.appendChild(b);
    }
    grid.append(dirLabel, dirs, document.createElement('span'));
    box.appendChild(grid);

    const go = button(t.sidebar.createCopies, () => {
      const n = Math.floor(parseFloat(count.value));
      const g = fromUnit(parseFloat(gap.value));
      if (!(n >= 1) || !(g >= 0)) return;
      // krok = rozmiar bryły w danym kierunku + przerwa, więc kopie nigdy na siebie nie nachodzą
      sel.updateMatrixWorld(true);
      const size = new THREE.Box3().setFromObject(sel, true).getSize(new THREE.Vector3());
      const d = this.arrayState.dir;
      const step = new THREE.Vector3(d === 'x' ? size.x + g : 0, d === 'y' ? size.y + g : 0, 0);
      this.actions.duplicate(sel, Math.min(n, 100), step);
    });
    go.style.marginTop = '8px';
    box.appendChild(go);
    this.body.appendChild(box);
  }

  /** Ostatnie ustawienia powielania (zostają przy przełączaniu brył). */
  private arrayState = { count: '3', gap: '5', dir: 'x' as 'x' | 'y' };

  /** Po zmianie jednostek przeliczamy wpisaną przerwę powielania (pole trzyma liczbę w jednostce). */
  unitChanged(from: 'mm' | 'in') {
    const g = parseFloat(this.arrayState.gap);
    if (Number.isFinite(g)) {
      const mm = from === 'in' ? g * 25.4 : g;
      this.arrayState.gap = lenValue(mm);
    }
    this.rebuild();
  }

  // ---------- tryb wierzchołków ----------

  private buildVertexProps() {
    const info = document.createElement('p');
    info.className = 'muted';
    info.dataset.role = 'vinfo';
    info.style.marginBottom = '8px';
    this.body.appendChild(info);
    if (this.editor.selection.size > 0) {
      this.body.appendChild(axisHeader());
      this.row(t.sidebar.point, 'vtx', (a, v) => this.editor.setSelectedAxis(a, fromUnit(v)), true);
    }
    const btns = document.createElement('div');
    btns.className = 'btn-row';
    btns.append(
      button(t.sidebar.selectAll, () => this.editor.selectAll()),
      button(t.sidebar.deselect, () => this.editor.clearSelection()),
    );
    this.body.appendChild(btns);
    this.buildMirrorProps();
  }

  /** Symetria: wybór osi lustra i położenia płaszczyzny. */
  private buildMirrorProps() {
    const box = document.createElement('div');
    box.className = 'ops';
    box.innerHTML = `<h3>${t.sidebar.mirror}</h3>`;
    const axes = document.createElement('div');
    axes.className = 'btn-row seg';
    const current = this.editor.mirror?.axis ?? null;
    for (const [label, axis] of [[t.sidebar.mirrorOff, null], ['X', 'x'], ['Y', 'y'], ['Z', 'z']] as const) {
      const b = button(label, () => this.editor.setMirror(axis));
      b.classList.toggle('active', current === axis);
      b.title = axis ? t.sidebar.mirrorAxisTitle(label) : t.sidebar.mirrorNone;
      axes.appendChild(b);
    }
    box.appendChild(axes);

    if (current) {
      const row = document.createElement('div');
      row.className = 'mirror-row';
      row.innerHTML = `<span>${t.sidebar.plane(current.toUpperCase())}</span>`;
      const input = document.createElement('input');
      input.type = 'number';
      input.step = inputStep();
      input.onchange = () => {
        const v = parseFloat(input.value);
        if (Number.isFinite(v)) this.editor.setMirror(current, fromUnit(v));
        else this.updateValues();
      };
      this.inputs.set('mirror', input);
      row.append(input, document.createTextNode(unitLabel()));
      row.appendChild(button(t.sidebar.center, () => {
        const g = this.model.selected!.geometry;
        g.computeBoundingBox();
        this.editor.setMirror(current, g.boundingBox!.getCenter(new THREE.Vector3())[current]);
      }));
      box.appendChild(row);
      const warn = document.createElement('p');
      warn.className = 'muted small';
      warn.dataset.role = 'mirrorinfo';
      box.appendChild(warn);
    } else {
      const hint = document.createElement('p');
      hint.className = 'muted small';
      hint.textContent = t.sidebar.mirrorHint;
      box.appendChild(hint);
    }
    this.body.appendChild(box);
  }

  /**
   * Walec, stożek, kula: wymiary przez promień / średnicę i wysokość.
   * Zmiana działa przez skalę, więc zachowuje wcześniejsze zmiany kształtu (punkty, wycięcia).
   */
  private buildRoundProps(sel: ModelMesh) {
    const kind = sel.userData.kind as string;
    if (!ROUND_KINDS.includes(kind)) return;
    const box = document.createElement('div');
    box.className = 'ops';
    box.innerHTML = `<h3>${t.primitive[kind as RoundKind]}</h3>`;
    const grid = document.createElement('div');
    grid.className = 'param-grid';

    const base = () => {
      sel.geometry.computeBoundingBox();
      return sel.geometry.boundingBox!.getSize(new THREE.Vector3());
    };
    const setRadius = (r: number) => {
      const b = base();
      sel.scale.x = (2 * r) / b.x;
      sel.scale.y = (2 * r) / b.y;
      if (kind === 'sphere') sel.scale.z = (2 * r) / b.z; // kula skaluje się równo
    };
    const field = (label: string, key: string, apply: (mm: number) => void, mmStep = 0.5) => {
      const l = document.createElement('label');
      l.textContent = label;
      const input = document.createElement('input');
      input.type = 'number';
      input.step = inputStep(mmStep);
      input.min = '0';
      input.onchange = () => {
        const v = parseFloat(input.value);
        if (!Number.isFinite(v) || v <= 0) return this.updateValues();
        this.model.checkpoint();
        apply(fromUnit(v));
        this.model.emit();
      };
      const u = document.createElement('span');
      u.textContent = unitLabel();
      grid.append(l, input, u);
      this.inputs.set(key, input);
    };
    field(t.sidebar.diameter, 'round.d', (v) => setRadius(v / 2), 0.1);
    field(t.sidebar.radius, 'round.r', (v) => setRadius(v), 0.1);
    if (kind !== 'sphere') field(t.sidebar.height, 'round.h', (v) => { sel.scale.z = v / base().z; }, 1);
    box.appendChild(grid);

    const note = document.createElement('p');
    note.className = 'muted small';
    note.dataset.role = 'roundnote';
    box.appendChild(note);
    this.body.appendChild(box);
  }

  private row(label: string, key: string, apply: (a: Axis, v: number) => void, selfCommit = false) {
    const row = document.createElement('div');
    row.className = 'prop-row';
    row.innerHTML = `<span>${label}</span>`;
    for (const a of AXES) {
      const input = document.createElement('input');
      input.type = 'number';
      input.step = key === 'rot' ? '5' : inputStep();
      input.onchange = () => {
        const v = parseFloat(input.value);
        if (!Number.isFinite(v)) return this.updateValues();
        if (selfCommit) return apply(a, v);
        this.model.checkpoint();
        apply(a, v);
        this.model.emit();
      };
      row.appendChild(input);
      this.inputs.set(`${key}.${a}`, input);
    }
    this.body.appendChild(row);
  }

  /** Aktualizuje liczby w polach – pomija pole, w którym użytkownik właśnie pisze. */
  updateValues() {
    const sel = this.model.selected;
    if (!sel) return;
    const set = (k: string, v: number) => {
      const el = this.inputs.get(k);
      if (el && document.activeElement !== el) el.value = fmt(v, unit === 'in' && !k.startsWith('rot') ? 3 : 2);
    };
    /** Długość: wartość w mm, w polu w bieżącej jednostce. */
    const setLen = (k: string, mm: number) => set(k, toUnit(mm));
    if (this.getMode() === 'object') {
      const size = objectSize(sel);
      for (const a of AXES) {
        setLen(`pos.${a}`, sel.position[a]);
        set(`rot.${a}`, THREE.MathUtils.radToDeg(sel.rotation[a]));
        setLen(`size.${a}`, size[a]);
      }
      if (ROUND_KINDS.includes(sel.userData.kind)) {
        // średnica z szerokości; gdy X ≠ Y bryła jest owalna – pokazujemy X i informujemy
        setLen('round.d', size.x);
        setLen('round.r', size.x / 2);
        setLen('round.h', size.z);
        const note = this.body.querySelector<HTMLElement>('[data-role=roundnote]');
        if (note) {
          note.textContent = Math.abs(size.x - size.y) > 0.01
            ? t.sidebar.oval(lenValue(size.x), lenValue(size.y), unitLabel())
            : '';
        }
      }
    } else {
      const n = this.editor.selection.size;
      const info = this.body.querySelector<HTMLElement>('[data-role=vinfo]');
      if (info) {
        info.textContent = n === 0
          ? t.sidebar.vertexHint
          : t.sidebar.vertexSelected(n);
      }
      const w = this.editor.selectedWorld();
      if (w) for (const a of AXES) setLen(`vtx.${a}`, w[a]);
      if (this.editor.mirror) {
        setLen('mirror', this.editor.mirror.offset);
        const mi = this.body.querySelector<HTMLElement>('[data-role=mirrorinfo]');
        if (mi) {
          const n = this.editor.unpairedCount;
          const ax = this.editor.mirror.axis.toUpperCase();
          const state = n === 0 && this.editor.topologySymmetric ? 'ok' : n === 0 ? 'topo' : 'unpaired';
          if (mi.dataset.state !== state || mi.dataset.n !== String(n)) {
            mi.dataset.state = state;
            mi.dataset.n = String(n);
            mi.innerHTML = state === 'ok'
              ? t.sidebar.mirrorOk
              : state === 'topo'
                ? t.sidebar.mirrorTopo
                : t.sidebar.mirrorUnpaired(n);
            if (state !== 'ok') {
              const row = document.createElement('div');
              row.className = 'btn-row';
              row.append(
                button(`${t.sidebar.symmetrize} +${ax} → −${ax}`, () => this.editor.symmetrizeMesh(1)),
                button(`−${ax} → +${ax}`, () => this.editor.symmetrizeMesh(-1)),
              );
              mi.appendChild(row);
            }
          }
        }
      }
    }
  }
}

type RoundKind = 'cylinder' | 'cone' | 'sphere';
const ROUND_KINDS: string[] = ['cylinder', 'cone', 'sphere'] satisfies RoundKind[];

function axisHeader() {
  const h = document.createElement('div');
  h.className = 'axis-head';
  h.innerHTML = '<span></span><b>X</b><b>Y</b><b>Z</b>';
  return h;
}

function button(text: string, onClick: () => void) {
  const b = document.createElement('button');
  b.textContent = text;
  b.onclick = onClick;
  return b;
}
