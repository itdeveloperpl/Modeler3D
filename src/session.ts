import type { DocData } from './model';

/**
 * Zapamiętywanie projektu w sessionStorage – chroni przed utratą pracy przy odświeżeniu
 * strony. Kopia żyje tylko w tej karcie (znika po jej zamknięciu); trwały zapis to Plik → Zapisz.
 * Preferencję (włączone / wyłączone) trzymamy w localStorage, żeby przetrwała zamknięcie karty.
 */

const SESSION_KEY = 'modeler3d.session';
const PREF_KEY = 'modeler3d.autosave';

export type SaveResult = 'ok' | 'quota' | 'unavailable';

export function autosaveEnabled(): boolean {
  try {
    return localStorage.getItem(PREF_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setAutosaveEnabled(on: boolean) {
  try {
    localStorage.setItem(PREF_KEY, on ? 'on' : 'off');
  } catch { /* brak dostępu – ustawienie obowiązuje do odświeżenia */ }
  if (!on) clearSession();
}

/** Projekt zapamiętany w tej karcie albo null (brak, wyłączone, uszkodzony wpis). */
export function loadSession(): DocData | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const doc = JSON.parse(raw) as DocData;
    if (doc?.version !== 1 || !Array.isArray(doc.objects)) throw new Error('nieznany format');
    return doc;
  } catch {
    clearSession(); // uszkodzony wpis nie może blokować startu programu
    return null;
  }
}

export function saveSession(doc: DocData): SaveResult {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(doc));
    return 'ok';
  } catch (err) {
    // za duży projekt (limit zwykle ok. 5 MB) albo przeglądarka blokuje dostęp do pamięci
    return err instanceof DOMException && err.name === 'QuotaExceededError' ? 'quota' : 'unavailable';
  }
}

export function clearSession() {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch { /* nic do zrobienia */ }
}
