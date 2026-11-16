import * as THREE from 'three';
import { Model, type ModelMesh } from './model';
import { BED, Viewport, type ViewMode } from './viewport';
import { VertexEditor } from './vertexEditor';
import { MeasureTool } from './measure';
import { BridgeTool } from './bridge';
import { FilletTool } from './fillet';
import { Sidebar } from './ui';
import { export3MF, exportSTL, openProject, saveProject } from './io';
import type { PrimitiveKind } from './primitives';
import { BOOLEAN_NAMES, booleanOp, boxesOverlap, preloadCSG, type BooleanOp } from './csg';

type EditMode = 'object' | 'vertex';
type Tool = 'translate' | 'rotate' | 'scale';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const status = $('status');

const view = new Viewport($('viewport'));
const model = new Model();
view.scene.add(model.root);
const editor = new VertexEditor(model, view);
const measure = new MeasureTool(model, view);
const bridge = new BridgeTool(model, view);
const fillet = new FilletTool(model, view);

let mode: EditMode = 'object';
let tool: Tool = 'translate';

const sidebar = new Sidebar(model, editor, () => mode, {
  duplicate: (m, count, step) => duplicate(m, count, step),
});

// ---------- operacje logiczne (wycinanie / łączenie / część wspólna) ----------

/** Czekamy, aż użytkownik kliknie bryłę-narzędzie. */
/** Operacja w toku: czekamy na wskazanie bryły A (target = null), potem bryły B. */
let pendingOp: { op: BooleanOp; target: ModelMesh | null } | null = null;
let opHover: ModelMesh | null = null;

function startBoolean(op: BooleanOp) {
  if (pendingOp?.op === op) {
    cancelBoolean(); // drugi klik w to samo narzędzie = anuluj
    status.textContent = 'Anulowano';
    return;
  }
  if (model.objects.length < 2) {
    status.textContent = 'Potrzebne są dwie bryły nachodzące na siebie';
    return;
  }
  if (measure.active) setMeasure(false);
  if (bridge.active) setBridge(false);
  if (fillet.active) setFillet(false);
  if (mode === 'vertex') setMode('object');
  preloadCSG();
  // zaznaczona bryła od razu staje się bryłą A
  pendingOp = { op, target: model.selected };
  sync();
  stickyStatus(pendingOpPrompt());
}

function pendingOpPrompt() {
  if (!pendingOp) return 'Gotowy';
  const name = BOOLEAN_NAMES[pendingOp.op];
  if (!pendingOp.target) {
    const what = pendingOp.op === 'subtract' ? 'bryłę, z której chcesz wycinać' : 'pierwszą bryłę';
    return `${name}: kliknij ${what} · Esc – anuluj`;
  }
  const verb = pendingOp.op === 'subtract' ? 'wyciąć z' : pendingOp.op === 'union' ? 'połączyć z' : 'przeciąć z';
  return `${name}: kliknij bryłę, którą chcesz ${verb} „${pendingOp.target.name}”` +
    (pendingOp.op === 'subtract' ? ' (Shift+klik – zachowaj bryłę tnącą)' : '') + ' · Esc – anuluj';
}

function cancelBoolean() {
  pendingOp = null;
  setOpHover(null);
  canvas.style.cursor = '';
  sync();
}

function setOpHover(m: ModelMesh | null) {
  if (m === opHover) return;
  opHover?.material.emissive.setHex(0x000000);
  m?.material.emissive.setHex(0x661a1a);
  opHover = m;
}

async function applyBoolean(tool: ModelMesh, keepTool: boolean) {
  const { op, target: maybeTarget } = pendingOp!;
  const target = maybeTarget!;
  cancelBoolean();
  if (!boxesOverlap(target, tool)) {
    status.textContent = 'Bryły się nie stykają – przesuń je tak, by na siebie nachodziły';
    return;
  }
  const t0 = performance.now();
  status.textContent = `${BOOLEAN_NAMES[op]}: liczę…`;
  let geometry: THREE.BufferGeometry | null;
  try {
    geometry = await booleanOp(op, target, tool);
  } catch (err) {
    console.error(err);
    status.textContent = `Operacja nie powiodła się: ${(err as Error).message}`;
    return;
  }
  if (!model.objects.includes(target) || !model.objects.includes(tool)) return; // scena zmieniła się w trakcie liczenia
  if (!geometry) {
    status.textContent = 'Wynik operacji jest pusty – nic nie zmieniono';
    return;
  }
  model.checkpoint();
  model.replaceGeometry(target, geometry);
  if (!keepTool || op !== 'subtract') model.removeSilently(tool);
  model.select(target);
  const tris = geometry.getIndex()!.count / 3;
  status.textContent = `${BOOLEAN_NAMES[op]}: gotowe (${tris} trójkątów, ${Math.round(performance.now() - t0)} ms)`;
}

// ---------- synchronizacja stanu ----------

function sync() {
  const sel = model.selected;
  if (mode === 'vertex') {
    view.transform.detach();
    if (!sel) setMode('object');
    else editor.attach(sel); // po cofnięciu bryła jest odtwarzana na nowo – podpinamy się ponownie
  } else {
    // podczas wskazywania bryły-narzędzia uchwyty przesuwania tylko by przeszkadzały
    if (sel && !pendingOp && !measure.active && !bridge.active && !fillet.active) view.transform.attach(sel);
    else view.transform.detach();
  }
  if (pendingOp && ((pendingOp.target && !model.objects.includes(pendingOp.target)) || mode !== 'object')) cancelBoolean();
  bridge.validate();
  fillet.validate();
  sidebar.refresh();
  document.querySelectorAll<HTMLButtonElement>('[data-op]').forEach((b) => b.classList.toggle('active', b.dataset.op === pendingOp?.op));
  $('duplicate').toggleAttribute('disabled', !model.selected);
  $('delete').toggleAttribute('disabled', !model.selected);
  $('undo').toggleAttribute('disabled', !model.canUndo);
  $('redo').toggleAttribute('disabled', !model.canRedo);
}
model.onChange(sync);
editor.onChange(() => sidebar.refresh());
let stickyUntil = 0; // ważne komunikaty nie są od razu zastępowane pozycją kursora
function stickyStatus(text: string) {
  status.textContent = text;
  stickyUntil = performance.now() + 5000;
}
editor.onMessage(stickyStatus);
measure.onResult(stickyStatus);
fillet.onMessage(stickyStatus);
bridge.onMessage((text) => {
  status.textContent = text;
  stickyUntil = Infinity; // instrukcje mostu zostają widoczne, dopóki narzędzie jest aktywne
});

// ---------- most ----------

function setBridge(on: boolean) {
  if (on) {
    if (pendingOp) cancelBoolean();
    if (measure.active) setMeasure(false);
    if (fillet.active) setFillet(false);
    if (mode === 'vertex') setMode('object');
  }
  bridge.setActive(on);
  $('bridge').classList.toggle('active', on);
  canvas.style.cursor = on ? 'crosshair' : '';
  if (!on) {
    stickyUntil = 0;
    status.textContent = 'Gotowy';
  }
  sync();
}

// ---------- zaokrąglanie rantów ----------

const filletPanel = $('fillet-panel');
const filletR = $<HTMLInputElement>('fillet-r');
const filletSeg = $<HTMLInputElement>('fillet-seg');

function setFillet(on: boolean) {
  if (on) {
    if (pendingOp) cancelBoolean();
    if (measure.active) setMeasure(false);
    if (bridge.active) setBridge(false);
    if (mode === 'vertex') setMode('object');
  }
  fillet.setActive(on);
  $('fillet').classList.toggle('active', on);
  filletPanel.hidden = !on;
  canvas.style.cursor = on ? 'crosshair' : '';
  if (!on) {
    stickyUntil = 0;
    status.textContent = 'Gotowy';
  }
  sync();
}

function syncFilletPanel() {
  const n = fillet.selectedCount;
  const info = $('fillet-info');
  const pv = fillet.previewInfo;
  info.textContent = n === 0
    ? 'Kliknij rant bryły. Kolejne kliknięcia dodają lub usuwają ranty.'
    : `Wybrane ranty: ${n} (${fillet.targetName}). ${pv ? pv.text : 'Liczę podgląd…'} Esc – odznacz.`;
  info.classList.toggle('warn-text', !!pv?.warn && n > 0);
  $<HTMLButtonElement>('fillet-apply').disabled = n === 0;
  $('fillet-r-label').textContent = fillet.kind === 'round' ? 'Promień' : 'Szerokość';
  filletSeg.disabled = fillet.kind === 'chamfer';
  document.querySelectorAll<HTMLButtonElement>('#fillet-kind button').forEach((b) => b.classList.toggle('active', b.dataset.kind === fillet.kind));
}
fillet.onChange(syncFilletPanel);
filletR.oninput = () => { fillet.radius = parseFloat(filletR.value); fillet.paramsChanged(); };
filletSeg.oninput = () => { fillet.segments = parseFloat(filletSeg.value); fillet.paramsChanged(); };
document.querySelectorAll<HTMLButtonElement>('#fillet-kind button').forEach((b) => {
  b.onclick = () => {
    fillet.kind = b.dataset.kind as 'round' | 'chamfer';
    fillet.paramsChanged();
  };
});
$('fillet-apply').onclick = () => void fillet.apply();
// w polach panelu: Enter zatwierdza, Esc wychodzi z pola i anuluje jak zwykle.
// Pozostałe klawisze w polach i tak nie uruchamiają skrótów (globalna obsługa pomija pola).
filletPanel.addEventListener('keydown', (e) => {
  const el = e.target as HTMLElement;
  if (el.tagName !== 'INPUT') return;
  if (e.key === 'Enter') {
    e.preventDefault();
    el.blur();
    void fillet.apply();
  } else if (e.key === 'Escape') {
    el.blur();
    if (!fillet.back()) setFillet(false);
  }
});
syncFilletPanel();

// ---------- duplikowanie ----------

function duplicate(src: ModelMesh, count = 1, step?: THREE.Vector3) {
  if (mode === 'vertex') setMode('object');
  const copies = model.duplicate(src, count, step);
  // czy wszystko mieści się na stole drukarki
  const outside = copies.filter((o) => {
    const b = new THREE.Box3().setFromObject(o, true);
    return b.min.x < -BED.x / 2 || b.max.x > BED.x / 2 || b.min.y < -BED.y / 2 || b.max.y > BED.y / 2;
  }).length;
  stickyStatus(
    (copies.length === 1 ? `Utworzono kopię: ${copies[0].name}` : `Utworzono ${copies.length} ${plural(copies.length, 'kopię', 'kopie', 'kopii')}`) +
    (outside ? ` – UWAGA: ${outside} poza stołem ${BED.x}×${BED.y} mm` : ''),
  );
}

/** Odmiana polska: 1 kopię, 2–4 kopie, 5+ kopii (ale 22–24 kopie, 12–14 kopii). */
function plural(n: number, one: string, few: string, many: string) {
  if (n === 1) return one;
  const d = n % 10, t = n % 100;
  return d >= 2 && d <= 4 && (t < 12 || t > 14) ? few : many;
}

// ---------- miarka ----------

function setMeasure(on: boolean) {
  if (on && pendingOp) cancelBoolean();
  if (on && bridge.active) setBridge(false);
  if (on && fillet.active) setFillet(false);
  measure.setActive(on);
  $('measure').classList.toggle('active', on);
  if (!on) canvas.style.cursor = '';
  status.textContent = on
    ? 'Miarka: kliknij wierzchołek początkowy, potem końcowy · Esc – anuluj / wyłącz'
    : 'Gotowy';
  stickyUntil = on ? performance.now() + 3000 : 0;
  sync();
}

function setMode(m: EditMode) {
  if (m === 'vertex' && !model.selected) {
    status.textContent = 'Najpierw zaznacz bryłę, której punkty chcesz edytować';
    return;
  }
  mode = m;
  if (m === 'object') editor.detach();
  $('mode-object').classList.toggle('active', m === 'object');
  $('mode-vertex').classList.toggle('active', m === 'vertex');
  $('transform-group').style.visibility = m === 'object' ? '' : 'hidden'; // nie 'none' – pasek nie zmienia wysokości
  sync();
}

function setTool(t: Tool) {
  tool = t;
  view.transform.setMode(t);
  document.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === t));
  applySnap();
}

function setView(v: ViewMode) {
  view.setView(v);
}
view.onViewChange((v) => {
  $('view-3d').classList.toggle('active', v === '3d');
  $('view-top').classList.toggle('active', v === 'top');
});

function applySnap() {
  const on = ($('snap') as HTMLInputElement).checked;
  const step = parseFloat(($('snap-size') as HTMLSelectElement).value);
  editor.snap = on;
  editor.snapStep = step;
  view.transform.setTranslationSnap(on ? step : null);
  view.transform.setRotationSnap(on ? THREE.MathUtils.degToRad(15) : null);
  view.transform.setScaleSnap(on ? 0.05 : null);
}

// ---------- gizmo przesuwania obiektu ----------

view.transform.addEventListener('mouseDown', () => model.checkpoint());
view.transform.addEventListener('objectChange', () => sidebar.updateValues());
view.transform.addEventListener('mouseUp', () => model.emit());

// ---------- mysz w viewporcie ----------

const canvas = view.renderer.domElement;
let down: { x: number; y: number; handled: boolean } | null = null;

canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  const p = view.localPoint(e);
  if (view.gizmo.contains(p.x, p.y, canvas.clientWidth) || view.transform.dragging) {
    down = null;
    return;
  }
  if (fillet.active) {
    fillet.pointerDown(e);
    down = { x: e.clientX, y: e.clientY, handled: true };
    return;
  }
  if (bridge.active) {
    bridge.pointerDown(e);
    down = { x: e.clientX, y: e.clientY, handled: true };
    return;
  }
  if (measure.active) {
    measure.pointerDown(e);
    down = { x: e.clientX, y: e.clientY, handled: true }; // kliknięcia miarki nie zmieniają zaznaczenia
    return;
  }
  const handled = mode === 'vertex' && editor.pointerDown(e);
  if (handled) canvas.setPointerCapture(e.pointerId);
  down = { x: e.clientX, y: e.clientY, handled };
});

canvas.addEventListener('pointermove', (e) => {
  if (fillet.active) {
    fillet.pointerMove(e);
    const p = view.localPoint(e);
    if (!view.gizmo.contains(p.x, p.y, canvas.clientWidth)) canvas.style.cursor = 'crosshair';
  } else if (bridge.active) {
    bridge.pointerMove(e);
    const p = view.localPoint(e);
    if (!view.gizmo.contains(p.x, p.y, canvas.clientWidth)) canvas.style.cursor = 'crosshair';
  } else if (measure.active) {
    measure.pointerMove(e);
    const p = view.localPoint(e);
    if (!view.gizmo.contains(p.x, p.y, canvas.clientWidth)) canvas.style.cursor = 'crosshair';
  } else if (mode === 'vertex') {
    const over = editor.pointerMove(e);
    if (!view.gizmo.contains(view.localPoint(e).x, view.localPoint(e).y, canvas.clientWidth)) {
      canvas.style.cursor = editor.dragging ? 'grabbing' : over ? 'grab' : '';
    }
  }
  if (pendingOp) {
    const hit = view.rayFromEvent(e).intersectObjects(model.objects, false)[0];
    const m = (hit?.object as ModelMesh | undefined) ?? null;
    setOpHover(m && m !== pendingOp.target ? m : null); // przy wyborze bryły A podświetla każdą
    canvas.style.cursor = 'crosshair';
  }
  showCursorPosition(e);
});

canvas.addEventListener('pointerup', (e) => {
  if (e.button !== 0) return;
  if (editor.pointerUp()) {
    down = null;
    return;
  }
  if (!down || down.handled) return;
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4;
  down = null;
  if (moved) return;

  // zwykłe kliknięcie: zaznaczenie bryły
  const hit = view.rayFromEvent(e).intersectObjects(model.objects, false)[0];
  const mesh = (hit?.object as ModelMesh | undefined) ?? null;
  if (pendingOp) {
    if (mesh && !pendingOp.target) {
      pendingOp.target = mesh; // wybrano bryłę A – teraz bryła B
      setOpHover(null);
      model.select(mesh);
      stickyStatus(pendingOpPrompt());
    } else if (mesh && mesh !== pendingOp.target) void applyBoolean(mesh, e.shiftKey);
    else {
      cancelBoolean();
      status.textContent = 'Anulowano';
    }
    return;
  }
  if (mode === 'vertex') {
    if (mesh && mesh !== model.selected) {
      editor.detach();
      model.select(mesh);
    } else editor.clearSelection();
  } else {
    model.select(mesh);
  }
});

// podwójne kliknięcie w trybie wierzchołków: nowy punkt na krawędzi lub ścianie
canvas.addEventListener('dblclick', (e) => {
  if (mode !== 'vertex' || measure.active || bridge.active || fillet.active) return;
  if (editor.insertAt(e)) status.textContent = 'Dodano punkt – możesz go od razu przeciągnąć';
});

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

/** Pasek stanu: współrzędne kursora na stole. */
function showCursorPosition(e: PointerEvent) {
  if (performance.now() < stickyUntil) return;
  const p = view.rayFromEvent(e).ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), new THREE.Vector3());
  const parts: string[] = pendingOp ? [pendingOpPrompt()] : [];
  if (p) parts.push(`Stół: X ${p.x.toFixed(1)}  Y ${p.y.toFixed(1)} mm`);
  if (mode === 'vertex' && editor.dragging) {
    const w = editor.selectedWorld();
    if (w) parts.push(`Punkt: X ${w.x.toFixed(2)}  Y ${w.y.toFixed(2)}  Z ${w.z.toFixed(2)}`);
  }
  status.textContent = parts.join('   |   ') || 'Gotowy';
}

// ---------- pasek narzędzi ----------

document.querySelectorAll<HTMLButtonElement>('[data-add]').forEach((b) => {
  b.onclick = () => {
    if (mode === 'vertex') setMode('object');
    // nowa bryła obok istniejących, żeby się nie nakładały
    const x = model.objects.length ? Math.max(...model.objects.map((o) => o.position.x)) + 30 : 0;
    model.addPrimitive(b.dataset.add as PrimitiveKind, new THREE.Vector3(x > 90 ? 0 : x, x > 90 ? 30 : 0, 0));
  };
});
document.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((b) => {
  b.onclick = () => setTool(b.dataset.tool as Tool);
});
$('mode-object').onclick = () => setMode('object');
$('mode-vertex').onclick = () => setMode('vertex');
$('view-3d').onclick = () => setView('3d');
$('view-top').onclick = () => setView('top');
$('measure').onclick = () => setMeasure(!measure.active);
document.querySelectorAll<HTMLButtonElement>('[data-op]').forEach((b) => {
  b.onclick = () => startBoolean(b.dataset.op as BooleanOp);
});
$('delete').onclick = () => {
  if (!model.selected) return;
  if (mode === 'vertex') setMode('object');
  model.remove(model.selected);
};
$('bridge').onclick = () => setBridge(!bridge.active);
$('fillet').onclick = () => setFillet(!fillet.active);
$('duplicate').onclick = () => {
  if (model.selected) duplicate(model.selected);
  else status.textContent = 'Najpierw zaznacz bryłę do skopiowania';
};
$('snap').onchange = applySnap;
$('snap-size').onchange = applySnap;
$('undo').onclick = () => model.undo();
$('redo').onclick = () => model.redo();
$('save').onclick = () => {
  saveProject(model);
  stickyStatus('Zapisano projekt.json (folder Pobrane)');
};
$('open').onclick = () => $('file-input').click();
$('file-input').onchange = async (e) => {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  try {
    setMode('object');
    await openProject(model, file);
    status.textContent = `Wczytano ${file.name}`;
  } catch (err) {
    status.textContent = `Błąd wczytywania: ${(err as Error).message}`;
  }
};
function runExport(format: 'stl' | '3mf') {
  if (model.objects.length === 0) {
    status.textContent = 'Brak brył do eksportu';
    return;
  }
  const below = model.objects.some((o) => new THREE.Box3().setFromObject(o).min.z < -0.01);
  const n = format === 'stl' ? exportSTL(model) : export3MF(model);
  status.textContent = `Wyeksportowano ${n} brył(y) do model.${format}` +
    (below ? ' – UWAGA: część bryły jest poniżej stołu (użyj „Połóż na stole”)' : '');
}
$('export-stl').onclick = () => runExport('stl');
$('export-3mf').onclick = () => runExport('3mf');

// ---------- menu rozwijane: Plik, Ustawienia ----------

/**
 * Menu pod przyciskiem: klik w przycisk otwiera / zamyka, klik obok lub Esc zamyka.
 * `closeOnPick` – zamknij po wybraniu pozycji (menu Plik), a nie przy zmianie ustawienia.
 */
function popover(btn: HTMLElement, panel: HTMLElement, closeOnPick: boolean) {
  const toggle = (show = panel.hidden) => {
    panel.hidden = !show;
    btn.classList.toggle('active', show);
  };
  btn.onclick = (e) => {
    e.stopPropagation();
    menus.forEach((m) => m !== toggle && m(false)); // naraz otwarte tylko jedno menu
    toggle();
  };
  document.addEventListener('pointerdown', (e) => {
    const t = e.target as Node;
    if (!panel.hidden && !panel.contains(t) && !btn.contains(t)) toggle(false);
  });
  panel.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      toggle(false);
      btn.focus();
    }
  });
  if (closeOnPick) panel.addEventListener('click', (e) => (e.target as HTMLElement).closest('button') && toggle(false));
  menus.push(toggle);
  return toggle;
}
const menus: ((show?: boolean) => void)[] = [];
popover($('file-btn'), $('file-menu'), true);
popover($('settings-btn'), $('settings-popup'), false);
const anyMenuOpen = () => !$('file-menu').hidden || !$('settings-popup').hidden;
const closeMenus = () => menus.forEach((m) => m(false));

// ---------- okno skrótów klawiszowych ----------

const shortcuts = $('shortcuts-popup');
function toggleShortcuts(show = shortcuts.hidden) {
  shortcuts.hidden = !show;
}
$('shortcuts-link').onclick = (e) => {
  e.stopPropagation();
  toggleShortcuts();
};
$('shortcuts-close').onclick = () => toggleShortcuts(false);
// kliknięcie poza okienkiem je zamyka
document.addEventListener('pointerdown', (e) => {
  if (!shortcuts.hidden && !shortcuts.contains(e.target as Node) && e.target !== $('shortcuts-link')) toggleShortcuts(false);
});

// ---------- klawiatura ----------

window.addEventListener('keydown', (e) => {
  const t = e.target as HTMLElement;
  if (t.tagName === 'INPUT' || t.tagName === 'SELECT') return;
  const ctrl = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();

  if (e.key === '?') {
    toggleShortcuts();
    return;
  }
  if (key === 'escape' && (!shortcuts.hidden || anyMenuOpen())) {
    toggleShortcuts(false); // Esc najpierw zamyka okienka i menu, nie anuluje narzędzia
    closeMenus();
    return;
  }
  if (ctrl && key === 's') {
    e.preventDefault(); // zamiast "zapisz stronę" przeglądarki
    saveProject(model);
    stickyStatus('Zapisano projekt.json (folder Pobrane)');
    return;
  }
  if (ctrl && key === 'o') {
    e.preventDefault();
    $('file-input').click();
    return;
  }

  if (ctrl && key === 'z' && !e.shiftKey) { e.preventDefault(); model.undo(); return; }
  if (ctrl && (key === 'y' || (key === 'z' && e.shiftKey))) { e.preventDefault(); model.redo(); return; }
  if (ctrl && key === 'd') {
    e.preventDefault();
    if (model.selected && mode === 'object') duplicate(model.selected);
    return;
  }
  if (ctrl && key === 'a' && mode === 'vertex') { e.preventDefault(); editor.selectAll(); return; }
  if (ctrl) return;

  switch (key) {
    case 'tab':
      e.preventDefault();
      setMode(mode === 'object' ? 'vertex' : 'object');
      break;
    case 'm':
      if (mode === 'vertex') {
        // przełącza oś lustra: wył. → X → Y → Z → wył.
        const order = [null, 'x', 'y', 'z'] as const;
        const i = order.indexOf(editor.mirror?.axis ?? null);
        editor.setMirror(order[(i + 1) % order.length]);
      }
      break;
    case 'w': setTool('translate'); break;
    case 'e': setTool('rotate'); break;
    case 'r': setTool('scale'); break;
    case 't': setView('top'); break;
    case 'p': setView('3d'); break;
    case 'd':
      setMeasure(!measure.active);
      break;
    case 'b':
      setBridge(!bridge.active);
      break;
    case 'f':
      setFillet(!fillet.active);
      break;
    case 'enter':
      if (fillet.active) {
        e.preventDefault();
        void fillet.apply();
      } else if (bridge.active) {
        e.preventDefault(); // inaczej Enter "kliknąłby" przycisk, który ma fokus
        bridge.apply();
      }
      break;
    case 'arrowup':
    case 'arrowdown':
      if (bridge.active) {
        e.preventDefault();
        bridge.changeSegments(key === 'arrowup' ? 1 : -1);
      }
      break;
    case 'arrowleft':
    case 'arrowright':
      if (bridge.active) {
        e.preventDefault();
        bridge.rotate(key === 'arrowleft' ? -1 : 1);
      }
      break;
    case 'escape':
      if (fillet.active) {
        if (!fillet.back()) setFillet(false);
      } else if (bridge.active) {
        if (!bridge.back()) setBridge(false);
      } else if (measure.active) {
        if (!measure.cancel()) setMeasure(false);
      } else if (pendingOp) {
        cancelBoolean();
        status.textContent = 'Anulowano';
      } else if (mode === 'vertex') editor.clearSelection();
      else model.select(null);
      break;
    case 'delete':
    case 'backspace':
      if (mode === 'object' && model.selected) model.remove(model.selected);
      break;
  }
});

// ---------- start ----------

setTool(tool);
applySnap();
model.addPrimitive('box');
// pierwsza bryła nie powinna dać się "cofnąć" do pustej sceny przy starcie
model.clearHistory();
sync();

// dostęp z konsoli przeglądarki (tylko w trybie deweloperskim)
if (import.meta.env.DEV) Object.assign(window, { app: { model, view, editor, measure, bridge, fillet } });
