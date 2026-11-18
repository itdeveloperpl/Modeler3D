/**
 * Jednostki długości w interfejsie: milimetry albo cale.
 *
 * Model, pliki projektu i eksport (STL / 3MF) zawsze są w milimetrach – zmienia się tylko
 * to, co użytkownik widzi i wpisuje. Konwersja: `toUnit(mm)` do wyświetlenia,
 * `fromUnit(wartość)` przy wpisaniu. Wybór zapamiętywany w localStorage.
 */

export type Unit = 'mm' | 'in';
export const MM_PER_IN = 25.4;

const STORAGE_KEY = 'modeler3d.unit';

function initialUnit(): Unit {
  try {
    if (localStorage.getItem(STORAGE_KEY) === 'in') return 'in';
  } catch { /* brak dostępu – domyślnie mm */ }
  return 'mm';
}

/** Bieżąca jednostka (żywe wiązanie modułu – zawsze aktualna wartość). */
export let unit: Unit = initialUnit();

const listeners = new Set<() => void>();
export function onUnitChange(fn: () => void) {
  listeners.add(fn);
}

export function setUnit(u: Unit) {
  if (u === unit) return;
  unit = u;
  try {
    localStorage.setItem(STORAGE_KEY, u);
  } catch { /* ustawienie obowiązuje do odświeżenia */ }
  listeners.forEach((fn) => fn());
}

/** mm → bieżąca jednostka. */
export const toUnit = (mm: number) => (unit === 'in' ? mm / MM_PER_IN : mm);
/** bieżąca jednostka → mm. */
export const fromUnit = (v: number) => (unit === 'in' ? v * MM_PER_IN : v);

/** Skrót jednostki do opisów pól: „mm” / „in”. */
export const unitLabel = () => (unit === 'in' ? 'in' : 'mm');

/** Liczba miejsc po przecinku: w calach o jedno więcej (0,001″ ≈ 0,025 mm). */
export const unitDigits = (mmDigits = 2) => (unit === 'in' ? mmDigits + 1 : mmDigits);

/** Długość (podana w mm) jako liczba w bieżącej jednostce, bez zbędnych zer – do pól. */
export function lenValue(mm: number, mmDigits = 2): string {
  const r = Number(toUnit(mm).toFixed(unitDigits(mmDigits)));
  return Object.is(r, -0) ? '0' : String(r);
}

/** Długość z jednostką, ze stałą liczbą miejsc – do etykiet i komunikatów („12.70 mm”, „0.500 in”). */
export function lenText(mm: number, mmDigits = 2): string {
  return `${toUnit(mm).toFixed(unitDigits(mmDigits))} ${unitLabel()}`;
}

/** Krok strzałek w polach liczbowych długości. */
export const inputStep = (mmStep = 1) => (unit === 'in' ? String(mmStep >= 1 ? 0.1 : 0.01) : String(mmStep));

/** Kroki przyciągania do siatki: wartość w mm + opis w bieżącej jednostce. */
export function snapOptions(): { mm: number; label: string }[] {
  if (unit === 'mm') return [0.5, 1, 5, 10].map((v) => ({ mm: v, label: `${v} mm` }));
  return [
    [1, 32], [1, 16], [1, 8], [1, 4], [1, 2], [1, 1],
  ].map(([a, b]) => ({ mm: (a / b) * MM_PER_IN, label: b === 1 ? '1″' : `${a}/${b}″` }));
}
