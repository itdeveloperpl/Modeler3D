/**
 * Tłumaczenia interfejsu (polski / angielski).
 *
 * W kodzie: `t.status.ready`, `t.status.copiesCreated(n)` – `t` to zawsze bieżący słownik
 * (żywe wiązanie modułu ES, podmieniane przez `setLanguage`).
 * W HTML: atrybuty `data-i18n` (tekst), `data-i18n-title` (podpowiedź), `data-i18n-aria` (aria-label)
 * ze ścieżką klucza, np. `data-i18n="ui.add"`.
 */

export type Lang = 'pl' | 'en';

/** Odmiana polska: 1 kopię, 2–4 kopie, 5+ kopii (ale 22–24 kopie, 12–14 kopii). */
function plPlural(n: number, one: string, few: string, many: string) {
  if (n === 1) return one;
  const d = n % 10, tt = n % 100;
  return d >= 2 && d <= 4 && (tt < 12 || tt > 14) ? few : many;
}
const enPlural = (n: number, one: string, many: string) => (n === 1 ? one : many);

const pl = {
  primitive: {
    box: 'Sześcian',
    cylinder: 'Walec',
    sphere: 'Kula',
    cone: 'Stożek',
    pyramid: 'Ostrosłup',
  },
  boolean: {
    subtract: 'Odejmij',
    union: 'Połącz',
    intersect: 'Część wspólna',
  },

  /** Statyczne teksty z index.html. */
  ui: {
    add: 'Dodaj',
    edit: 'Edycja',
    undo: 'Cofnij',
    redo: 'Ponów',
    modeObject: 'Obiekt',
    modeObjectTitle: 'Tab – edycja całych brył',
    modeVertex: 'Wierzchołki',
    modeVertexTitle: 'Tab – edycja punktów bryły',
    translate: 'Przesuń',
    rotate: 'Obróć',
    scale: 'Skaluj',
    duplicate: 'Duplikuj',
    duplicateTitle: 'Ctrl+D – kopia obok zaznaczonej bryły',
    delete: 'Usuń',
    deleteTitle: 'Del – usuń zaznaczoną bryłę',
    modeling: 'Modelowanie',
    subtractTitle: 'Wytnij jedną bryłę z drugiej (np. otwór)',
    unionTitle: 'Połącz dwie nachodzące na siebie bryły w jedną',
    intersectTitle: 'Zostaw tylko część wspólną dwóch brył',
    bridge: 'Most',
    bridgeTitle: 'B – połącz dwie płaskie ściany nowymi ścianami',
    fillet: 'Zaokrąglij',
    filletTitle: 'F – zaokrąglij / sfazuj wybrane ranty',
    view: 'Widok',
    viewTop: 'Z góry',
    measure: 'Miarka',
    measureTitle: 'D – odległość między wierzchołkami i rantami',
    file: 'Plik ▾',
    open: 'Otwórz projekt…',
    save: 'Zapisz projekt',
    exportStl: 'Eksport STL',
    exportStlHint: 'jedna siatka – każdy slicer',
    export3mf: 'Eksport 3MF',
    export3mfHint: 'mm, osobne obiekty, nazwy i kolory',
    settings: '⚙ Ustawienia',
    settingsTitle: 'Ustawienia',
    snapHeading: 'Przyciąganie do siatki',
    snapLabel: 'Przyciągaj przy przesuwaniu brył i punktów',
    gridStep: 'Krok siatki',
    snapHint: 'Przytrzymaj Alt podczas przeciągania, żeby chwilowo wyłączyć przyciąganie. Obrót przyciąga co 15°.',
    language: 'Język / Language',
    filletPanelTitle: 'Zaokrąglenie rantów',
    filletRound: 'Zaokrąglenie',
    filletChamfer: 'Faza',
    radius: 'Promień',
    width: 'Szerokość',
    smoothness: 'Gładkość',
    segmentsUnit: 'segm.',
    filletApply: 'Zastosuj (Enter)',
    objects: 'Obiekty',
    properties: 'Właściwości',
    shortcuts: 'Skróty klawiszowe',
    shortcutsTitle: 'Skróty klawiszowe (?)',
    close: 'Zamknij (Esc)',
    // okno skrótów
    scMouse: 'Mysz',
    scLmb: 'LPM',
    scLmbDo: 'zaznacz, przeciągnij, wskaż',
    scRmb: 'PPM',
    scRmbDo: 'obrót widoku',
    scMmb: 'ŚPM',
    scMmbDo: 'przesuwanie widoku',
    scWheel: 'Kółko',
    scWheelDo: 'przybliżanie',
    scGeneral: 'Ogólne',
    scUndo: 'cofnij / ponów',
    scSaveOpen: 'zapisz / otwórz projekt',
    scDuplicate: 'duplikuj bryłę',
    scDelete: 'usuń bryłę',
    scViews: 'widok z góry / 3D',
    scEsc: 'anuluj, cofnij krok, wyłącz narzędzie',
    scThis: 'to okno',
    scObjectMode: 'Tryb obiektu',
    scToVertex: 'przełącz na wierzchołki',
    scTransform: 'przesuń / obróć / skaluj',
    scAlt: '(podczas przeciągania) bez przyciągania',
    scVertexMode: 'Tryb wierzchołków',
    scDrag: 'Przeciągnij',
    scDragDo: 'przesuń punkt w poziomie',
    scShiftDrag: 'Shift + przeciągnij',
    scShiftDragDo: 'tylko w pionie (Z)',
    scCtrlClick: 'Ctrl + klik',
    scCtrlClickDo: 'zaznacz kilka punktów',
    scSelectAll: 'zaznacz wszystkie',
    scDblClick: '2× klik',
    scDblClickDo: 'dodaj punkt na krawędzi / ścianie',
    scMirror: 'symetria: wył. / X / Y / Z',
    scTools: 'Narzędzia',
    scBoolean: 'Odejmij, Połącz, Część wspólna',
    scBooleanDo: 'klik w bryłę A, potem w bryłę B (Shift – zachowaj bryłę tnącą)',
    scBridge: 'B – Most',
    scBridgeDo: 'klik w ścianę A i B, Enter · ↑/↓ segmenty łuku · ←/→ obrót dopasowania',
    scFillet: 'F – Zaokrąglij',
    scFilletDo: 'klik w ranty, promień w panelu, Enter',
    scMeasure: 'D – Miarka',
    scMeasureDo: 'klik w dwa wierzchołki lub ranty; między rantami – najkrócej, prostopadle do obu (⊥)',
  },

  /** Komunikaty w pasku stanu (main.ts). */
  status: {
    ready: 'Gotowy',
    cancelled: 'Anulowano',
    needTwo: 'Potrzebne są dwie bryły nachodzące na siebie',
    opPickFirst: (name: string, op: string) =>
      `${name}: kliknij ${op === 'subtract' ? 'bryłę, z której chcesz wycinać' : 'pierwszą bryłę'} · Esc – anuluj`,
    opPickSecond: (name: string, op: string, target: string) => {
      const verb = op === 'subtract' ? 'wyciąć z' : op === 'union' ? 'połączyć z' : 'przeciąć z';
      return `${name}: kliknij bryłę, którą chcesz ${verb} „${target}”` +
        (op === 'subtract' ? ' (Shift+klik – zachowaj bryłę tnącą)' : '') + ' · Esc – anuluj';
    },
    notTouching: 'Bryły się nie stykają – przesuń je tak, by na siebie nachodziły',
    computing: (name: string) => `${name}: liczę…`,
    opFailed: (msg: string) => `Operacja nie powiodła się: ${msg}`,
    opEmpty: 'Wynik operacji jest pusty – nic nie zmieniono',
    opDone: (name: string, tris: number, ms: number) => `${name}: gotowe (${tris} trójkątów, ${ms} ms)`,
    filletNone: 'Kliknij rant bryły. Kolejne kliknięcia dodają lub usuwają ranty.',
    filletSelected: (n: number, target: string, preview: string | null) =>
      `Wybrane ranty: ${n} (${target}). ${preview ?? 'Liczę podgląd…'} Esc – odznacz.`,
    copyCreated: (name: string) => `Utworzono kopię: ${name}`,
    copiesCreated: (n: number) => `Utworzono ${n} ${plPlural(n, 'kopię', 'kopie', 'kopii')}`,
    outsideBed: (n: number, x: number, y: number) => ` – UWAGA: ${n} poza stołem ${x}×${y} mm`,
    measureStart: 'Miarka: kliknij wierzchołek początkowy, potem końcowy · Esc – anuluj / wyłącz',
    selectFirstVertex: 'Najpierw zaznacz bryłę, której punkty chcesz edytować',
    pointAdded: 'Dodano punkt – możesz go od razu przeciągnąć',
    bed: (x: string, y: string) => `Stół: X ${x}  Y ${y} mm`,
    point: (x: string, y: string, z: string) => `Punkt: X ${x}  Y ${y}  Z ${z}`,
    selectFirstCopy: 'Najpierw zaznacz bryłę do skopiowania',
    saved: (file: string) => `Zapisano ${file} (folder Pobrane)`,
    loaded: (file: string) => `Wczytano ${file}`,
    loadError: (msg: string) => `Błąd wczytywania: ${msg}`,
    nothingToExport: 'Brak brył do eksportu',
    exported: (n: number, file: string) => `Wyeksportowano ${n} brył(y) do ${file}`,
    belowBed: ' – UWAGA: część bryły jest poniżej stołu (użyj „Połóż na stole”)',
  },

  sidebar: {
    empty: 'Brak – dodaj bryłę z paska u góry',
    nothingSelected: 'Nic nie zaznaczono',
    color: 'Kolor',
    position: 'Pozycja',
    rotation: 'Obrót °',
    size: 'Wymiar',
    dropToBed: 'Połóż na stole',
    array: 'Powiel w rzędzie',
    copies: 'Kopie',
    pcs: 'szt.',
    gap: 'Przerwa',
    direction: 'Kierunek',
    createCopies: 'Utwórz kopie',
    point: 'Punkt',
    selectAll: 'Zaznacz wszystkie',
    deselect: 'Odznacz',
    mirror: 'Symetria (lustro)',
    mirrorOff: 'Wył.',
    mirrorAxisTitle: (axis: string) => `Lustro prostopadłe do osi ${axis} bryły`,
    mirrorNone: 'Bez symetrii',
    plane: (axis: string) => `Płaszczyzna ${axis} =`,
    center: 'Środek',
    mirrorHint: 'Wybierz oś – zmiany punktów po jednej stronie powtórzą się w lustrze po drugiej. Klawisz M przełącza.',
    diameter: 'Średnica',
    radius: 'Promień',
    height: 'Wysokość',
    oval: (x: string, y: string) => `Owal: ${x} × ${y} mm – wpisanie średnicy wyrówna go do koła.`,
    vertexHint: 'Kliknij punkt na bryle i przeciągnij. Ctrl+klik – zaznacz kilka. Podwójny klik na krawędzi lub ścianie – nowy punkt.',
    vertexSelected: (n: number) => `Zaznaczone punkty: ${n}${n > 1 ? ' (pola zmieniają wszystkie naraz)' : ''}`,
    mirrorOk: 'Bryła jest symetryczna. Punkty na płaszczyźnie przesuwają się tylko po niej.',
    mirrorTopo: '<span class="warn">Trójkąty po obu stronach są ułożone różnie</span> – dodawane punkty i linie nie będą lustrzane.',
    mirrorUnpaired: (n: number) =>
      `<span class="warn">${n} punkt(ów) bez pary</span> (czerwone) – bryła nie jest symetryczna; te punkty przesuwają się bez odbicia.`,
    symmetrize: 'Symetryzuj',
  },

  bridge: {
    pickFirst: 'Most: kliknij płaską ścianę pierwszej bryły',
    pickSecond: 'Most: kliknij płaską ścianę drugiej bryły',
    pickSecondSame: 'Most: kliknij płaską ścianę drugiej bryły (może być ta sama bryła)',
    error: (msg: string) => `Most: ${msg}`,
    pickOther: 'Most: wybierz inną ścianę niż pierwsza',
    notClosed: 'Most: nie można zatwierdzić – wynik nie byłby szczelną bryłą (np. most pokrywa się z istniejącą ścianą). Esc – wybierz inne ściany',
    notClosedAfterMerge: 'Most: nie można zatwierdzić – po scaleniu punktów bryła nie byłaby szczelna. Odsuń bryły od siebie i spróbuj ponownie',
    done: (n: number, warnings: string[]) =>
      `Most gotowy: ${n} nowych ścian` +
      (warnings.length ? ` – UWAGA: ${warnings.join('; ')}` : '') +
      ' · kliknij ścianę, aby zrobić kolejny most · B – wyłącz',
    preview: (segments: number, warnings: string[]) =>
      `Most – podgląd (${segments === 0 ? 'prosty' : `łuk, ${segments} segm.`}): Enter zatwierdź · Esc cofnij · ↑/↓ segmenty · ←/→ obróć dopasowanie` +
      (warnings.length ? ` · UWAGA: ${warnings.join('; ')}` : ''),
    folded: 'zakręt jest za ciasny na grubość mostu – ściany mostu się zawijają; odsuń bryły od siebie',
    notFacing: 'ściany nie są zwrócone do siebie – użyj łuku (↑)',
    crossesSelf: (straight: boolean) => 'most przechodzi przez łączoną bryłę' + (straight ? ' – spróbuj łuku (↑)' : ''),
    crossesOther: (name: string) => `most przechodzi przez bryłę „${name}”`,
    wouldLeak: 'wynik nie byłby szczelny – nie można zatwierdzić',
    oddOutline: 'ta ściana ma nietypowy kształt (punkty obrysu się stykają)',
    noOutline: 'nie udało się wyznaczyć obrysu ściany',
    hasHole: 'ściana z otworem – most łączy tylko ściany bez otworów',
  },

  fillet: {
    start: 'Zaokrąglenie: kliknij rant (krawędź) bryły – kolejne kliknięcia dodają / usuwają ranty',
    radiusPositive: 'promień musi być większy od zera',
    tooBig: (n: number, round: boolean) =>
      `przy ${n} rancie(ach) ${round ? 'promień' : 'szerokość'} jest większy niż sąsiednie ściany – kształt może być nieoczekiwany`,
    computing: 'Zaokrąglenie: liczę…',
    empty: 'Zaokrąglenie: wynik byłby pusty – nic nie zmieniono',
    done: (round: boolean, n: number, r: number, warning: string | null) =>
      `${round ? 'Zaokrąglono' : 'Sfazowano'} ${n} rant(y) (${round ? 'promień' : 'szerokość'} ${r} mm)` +
      (warning ? ` – UWAGA: ${warning}` : '') + ' · Ctrl+Z cofa',
    failed: (msg: string) => `Zaokrąglenie nie powiodło się: ${msg}`,
    previewEmpty: 'Wynik byłby pusty.',
    previewWarn: (warning: string) => `Podgląd – UWAGA: ${warning}.`,
    previewOk: 'Podgląd wyniku. Enter – zastosuj.',
    previewError: (msg: string) => `Nie da się policzyć: ${msg}`,
  },

  measure: {
    vertex: 'wierzchołek',
    edge: 'rant',
    result: (kinds: string, perpendicular: boolean, text: string) =>
      `Miarka (${kinds}${perpendicular ? ', prostopadle' : ''}): ${text}`,
  },

  vertex: {
    meshPrepared: (axis: string, added: number) =>
      `Siatkę przygotowano do symetrii ${axis}` +
      (added > 0 ? ` – dodano ${added} punkt(y) na płaszczyźnie lustra` : '') + ' (Ctrl+Z cofa)',
    nothingOnSide: 'Po tej stronie lustra nie ma żadnej części bryły',
  },

  view: {
    persp: 'Perspektywa 3D',
    top: 'Widok z góry (XY)',
  },

  misc: {
    notClosedSolid: (name: string) => `„${name}” nie jest zamkniętą bryłą (np. ściany przecinają się po edycji punktów)`,
    unknownFormat: 'Nieznany format pliku',
    projectFile: 'projekt.json',
    xmlLang: 'pl-PL',
  },
};

export type Dict = typeof pl;

const en: Dict = {
  primitive: {
    box: 'Cube',
    cylinder: 'Cylinder',
    sphere: 'Sphere',
    cone: 'Cone',
    pyramid: 'Pyramid',
  },
  boolean: {
    subtract: 'Subtract',
    union: 'Union',
    intersect: 'Intersect',
  },

  ui: {
    add: 'Add',
    edit: 'Edit',
    undo: 'Undo',
    redo: 'Redo',
    modeObject: 'Object',
    modeObjectTitle: 'Tab – edit whole solids',
    modeVertex: 'Vertices',
    modeVertexTitle: 'Tab – edit the vertices of a solid',
    translate: 'Move',
    rotate: 'Rotate',
    scale: 'Scale',
    duplicate: 'Duplicate',
    duplicateTitle: 'Ctrl+D – copy next to the selected solid',
    delete: 'Delete',
    deleteTitle: 'Del – delete the selected solid',
    modeling: 'Modeling',
    subtractTitle: 'Cut one solid out of another (e.g. a hole)',
    unionTitle: 'Merge two overlapping solids into one',
    intersectTitle: 'Keep only the common part of two solids',
    bridge: 'Bridge',
    bridgeTitle: 'B – connect two flat faces with new faces',
    fillet: 'Fillet',
    filletTitle: 'F – fillet / chamfer the selected edges',
    view: 'View',
    viewTop: 'Top',
    measure: 'Ruler',
    measureTitle: 'D – distance between vertices and edges',
    file: 'File ▾',
    open: 'Open project…',
    save: 'Save project',
    exportStl: 'Export STL',
    exportStlHint: 'single mesh – any slicer',
    export3mf: 'Export 3MF',
    export3mfHint: 'mm, separate objects, names and colors',
    settings: '⚙ Settings',
    settingsTitle: 'Settings',
    snapHeading: 'Grid snapping',
    snapLabel: 'Snap when moving solids and vertices',
    gridStep: 'Grid step',
    snapHint: 'Hold Alt while dragging to temporarily disable snapping. Rotation snaps every 15°.',
    language: 'Language / Język',
    filletPanelTitle: 'Edge fillet',
    filletRound: 'Fillet',
    filletChamfer: 'Chamfer',
    radius: 'Radius',
    width: 'Width',
    smoothness: 'Smoothness',
    segmentsUnit: 'segs',
    filletApply: 'Apply (Enter)',
    objects: 'Objects',
    properties: 'Properties',
    shortcuts: 'Keyboard shortcuts',
    shortcutsTitle: 'Keyboard shortcuts (?)',
    close: 'Close (Esc)',
    scMouse: 'Mouse',
    scLmb: 'LMB',
    scLmbDo: 'select, drag, pick',
    scRmb: 'RMB',
    scRmbDo: 'orbit view',
    scMmb: 'MMB',
    scMmbDo: 'pan view',
    scWheel: 'Wheel',
    scWheelDo: 'zoom',
    scGeneral: 'General',
    scUndo: 'undo / redo',
    scSaveOpen: 'save / open project',
    scDuplicate: 'duplicate solid',
    scDelete: 'delete solid',
    scViews: 'top / 3D view',
    scEsc: 'cancel, step back, exit tool',
    scThis: 'this window',
    scObjectMode: 'Object mode',
    scToVertex: 'switch to vertices',
    scTransform: 'move / rotate / scale',
    scAlt: '(while dragging) no snapping',
    scVertexMode: 'Vertex mode',
    scDrag: 'Drag',
    scDragDo: 'move vertex horizontally',
    scShiftDrag: 'Shift + drag',
    scShiftDragDo: 'vertically only (Z)',
    scCtrlClick: 'Ctrl + click',
    scCtrlClickDo: 'select multiple vertices',
    scSelectAll: 'select all',
    scDblClick: 'Double-click',
    scDblClickDo: 'add vertex on an edge / face',
    scMirror: 'symmetry: off / X / Y / Z',
    scTools: 'Tools',
    scBoolean: 'Subtract, Union, Intersect',
    scBooleanDo: 'click solid A, then solid B (Shift – keep the cutting solid)',
    scBridge: 'B – Bridge',
    scBridgeDo: 'click face A and B, Enter · ↑/↓ arc segments · ←/→ rotate matching',
    scFillet: 'F – Fillet',
    scFilletDo: 'click edges, radius in the panel, Enter',
    scMeasure: 'D – Ruler',
    scMeasureDo: 'click two vertices or edges; between edges – shortest, perpendicular to both (⊥)',
  },

  status: {
    ready: 'Ready',
    cancelled: 'Cancelled',
    needTwo: 'Two overlapping solids are needed',
    opPickFirst: (name, op) =>
      `${name}: click ${op === 'subtract' ? 'the solid to cut from' : 'the first solid'} · Esc – cancel`,
    opPickSecond: (name, op, target) => {
      const verb = op === 'subtract' ? 'cut out of' : op === 'union' ? 'merge with' : 'intersect with';
      return `${name}: click the solid to ${verb} “${target}”` +
        (op === 'subtract' ? ' (Shift+click – keep the cutting solid)' : '') + ' · Esc – cancel';
    },
    notTouching: 'The solids do not touch – move them so they overlap',
    computing: (name) => `${name}: computing…`,
    opFailed: (msg) => `Operation failed: ${msg}`,
    opEmpty: 'The result is empty – nothing changed',
    opDone: (name, tris, ms) => `${name}: done (${tris} triangles, ${ms} ms)`,
    filletNone: 'Click an edge of a solid. Further clicks add or remove edges.',
    filletSelected: (n, target, preview) =>
      `Selected edges: ${n} (${target}). ${preview ?? 'Computing preview…'} Esc – deselect.`,
    copyCreated: (name) => `Created a copy: ${name}`,
    copiesCreated: (n) => `Created ${n} ${enPlural(n, 'copy', 'copies')}`,
    outsideBed: (n, x, y) => ` – WARNING: ${n} outside the ${x}×${y} mm bed`,
    measureStart: 'Ruler: click the start vertex, then the end one · Esc – cancel / exit',
    selectFirstVertex: 'First select the solid whose vertices you want to edit',
    pointAdded: 'Vertex added – you can drag it right away',
    bed: (x, y) => `Bed: X ${x}  Y ${y} mm`,
    point: (x, y, z) => `Vertex: X ${x}  Y ${y}  Z ${z}`,
    selectFirstCopy: 'First select a solid to copy',
    saved: (file) => `Saved ${file} (Downloads folder)`,
    loaded: (file) => `Loaded ${file}`,
    loadError: (msg) => `Loading failed: ${msg}`,
    nothingToExport: 'No solids to export',
    exported: (n, file) => `Exported ${n} ${enPlural(n, 'solid', 'solids')} to ${file}`,
    belowBed: ' – WARNING: part of a solid is below the bed (use “Drop to bed”)',
  },

  sidebar: {
    empty: 'None – add a solid from the toolbar',
    nothingSelected: 'Nothing selected',
    color: 'Color',
    position: 'Position',
    rotation: 'Angle °',
    size: 'Size',
    dropToBed: 'Drop to bed',
    array: 'Linear array',
    copies: 'Copies',
    pcs: 'pcs',
    gap: 'Gap',
    direction: 'Direction',
    createCopies: 'Create copies',
    point: 'Vertex',
    selectAll: 'Select all',
    deselect: 'Deselect',
    mirror: 'Symmetry (mirror)',
    mirrorOff: 'Off',
    mirrorAxisTitle: (axis) => `Mirror perpendicular to the solid's ${axis} axis`,
    mirrorNone: 'No symmetry',
    plane: (axis) => `Plane ${axis} =`,
    center: 'Center',
    mirrorHint: 'Pick an axis – vertex changes on one side are mirrored on the other. The M key toggles.',
    diameter: 'Diameter',
    radius: 'Radius',
    height: 'Height',
    oval: (x, y) => `Oval: ${x} × ${y} mm – entering a diameter makes it round again.`,
    vertexHint: 'Click a vertex on the solid and drag. Ctrl+click – select several. Double-click on an edge or face – new vertex.',
    vertexSelected: (n) => `Selected vertices: ${n}${n > 1 ? ' (fields change all of them at once)' : ''}`,
    mirrorOk: 'The solid is symmetric. Vertices on the plane move only along it.',
    mirrorTopo: '<span class="warn">Triangles on both sides are arranged differently</span> – added vertices and lines will not be mirrored.',
    mirrorUnpaired: (n) =>
      `<span class="warn">${n} unpaired ${enPlural(n, 'vertex', 'vertices')}</span> (red) – the solid is not symmetric; these vertices move without mirroring.`,
    symmetrize: 'Symmetrize',
  },

  bridge: {
    pickFirst: 'Bridge: click a flat face of the first solid',
    pickSecond: 'Bridge: click a flat face of the second solid',
    pickSecondSame: 'Bridge: click a flat face of the second solid (may be the same solid)',
    error: (msg) => `Bridge: ${msg}`,
    pickOther: 'Bridge: pick a different face than the first one',
    notClosed: 'Bridge: cannot confirm – the result would not be watertight (e.g. the bridge overlaps an existing face). Esc – pick other faces',
    notClosedAfterMerge: 'Bridge: cannot confirm – after merging vertices the solid would not be watertight. Move the solids apart and try again',
    done: (n, warnings) =>
      `Bridge done: ${n} new faces` +
      (warnings.length ? ` – WARNING: ${warnings.join('; ')}` : '') +
      ' · click a face to make another bridge · B – exit',
    preview: (segments, warnings) =>
      `Bridge – preview (${segments === 0 ? 'straight' : `arc, ${segments} segs`}): Enter confirm · Esc back · ↑/↓ segments · ←/→ rotate matching` +
      (warnings.length ? ` · WARNING: ${warnings.join('; ')}` : ''),
    folded: 'the bend is too tight for the bridge thickness – bridge faces fold over; move the solids apart',
    notFacing: 'the faces do not face each other – use an arc (↑)',
    crossesSelf: (straight) => 'the bridge passes through the connected solid' + (straight ? ' – try an arc (↑)' : ''),
    crossesOther: (name) => `the bridge passes through solid “${name}”`,
    wouldLeak: 'the result would not be watertight – cannot confirm',
    oddOutline: 'this face has an unusual shape (outline points touch)',
    noOutline: 'could not determine the face outline',
    hasHole: 'face with a hole – bridge only connects faces without holes',
  },

  fillet: {
    start: 'Fillet: click an edge of a solid – further clicks add / remove edges',
    radiusPositive: 'radius must be greater than zero',
    tooBig: (n, round) =>
      `on ${n} ${enPlural(n, 'edge', 'edges')} the ${round ? 'radius' : 'width'} is larger than the adjacent faces – the shape may be unexpected`,
    computing: 'Fillet: computing…',
    empty: 'Fillet: the result would be empty – nothing changed',
    done: (round, n, r, warning) =>
      `${round ? 'Filleted' : 'Chamfered'} ${n} ${enPlural(n, 'edge', 'edges')} (${round ? 'radius' : 'width'} ${r} mm)` +
      (warning ? ` – WARNING: ${warning}` : '') + ' · Ctrl+Z undoes',
    failed: (msg) => `Fillet failed: ${msg}`,
    previewEmpty: 'The result would be empty.',
    previewWarn: (warning) => `Preview – WARNING: ${warning}.`,
    previewOk: 'Result preview. Enter – apply.',
    previewError: (msg) => `Cannot compute: ${msg}`,
  },

  measure: {
    vertex: 'vertex',
    edge: 'edge',
    result: (kinds, perpendicular, text) =>
      `Ruler (${kinds}${perpendicular ? ', perpendicular' : ''}): ${text}`,
  },

  vertex: {
    meshPrepared: (axis, added) =>
      `Mesh prepared for ${axis} symmetry` +
      (added > 0 ? ` – added ${added} ${enPlural(added, 'vertex', 'vertices')} on the mirror plane` : '') + ' (Ctrl+Z undoes)',
    nothingOnSide: 'There is no part of the solid on this side of the mirror',
  },

  view: {
    persp: '3D perspective',
    top: 'Top view (XY)',
  },

  misc: {
    notClosedSolid: (name) => `“${name}” is not a closed solid (e.g. faces intersect after vertex editing)`,
    unknownFormat: 'Unknown file format',
    projectFile: 'project.json',
    xmlLang: 'en-US',
  },
};

const DICTS: Record<Lang, Dict> = { pl, en };
const STORAGE_KEY = 'lang';

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'pl' || saved === 'en') return saved;
  } catch { /* brak dostępu do localStorage – język z przeglądarki */ }
  return navigator.language.toLowerCase().startsWith('pl') ? 'pl' : 'en';
}

export let lang: Lang = initialLang();
/** Bieżący słownik. */
export let t: Dict = DICTS[lang];

const listeners = new Set<() => void>();
/** Wywoływane po zmianie języka (do odświeżenia tekstów tworzonych w kodzie). */
export function onLanguageChange(fn: () => void) {
  listeners.add(fn);
}

export function setLanguage(l: Lang) {
  if (l === lang) return;
  lang = l;
  t = DICTS[l];
  try {
    localStorage.setItem(STORAGE_KEY, l);
  } catch { /* ignoruj */ }
  translatePage();
  listeners.forEach((fn) => fn());
}

function lookup(path: string): string {
  let v: unknown = t;
  for (const part of path.split('.')) v = (v as Record<string, unknown> | undefined)?.[part];
  if (typeof v !== 'string') {
    console.warn(`i18n: brak klucza ${path}`);
    return path;
  }
  return v;
}

/** Tłumaczy statyczne elementy strony oznaczone atrybutami data-i18n*. */
export function translatePage(root: ParentNode = document) {
  document.documentElement.lang = lang;
  document.title = lang === 'pl' ? 'Modeler 3D' : '3D Modeler';
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => (el.textContent = lookup(el.dataset.i18n!)));
  root.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach((el) => (el.title = lookup(el.dataset.i18nTitle!)));
  root.querySelectorAll<HTMLElement>('[data-i18n-aria]').forEach((el) => el.setAttribute('aria-label', lookup(el.dataset.i18nAria!)));
}
