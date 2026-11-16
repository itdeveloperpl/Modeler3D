# Modeler 3D

Prosty program do modelowania brył z myślą o **druku 3D**. Działa lokalnie w przeglądarce
(bez serwera i bez internetu), pracuje w milimetrach z osią Z skierowaną w górę – tak jak
slicery – i zawsze zapisuje szczelne bryły gotowe do druku.

## Uruchomienie

Wymagany Node.js 18+.

```bash
npm install
npm run dev        # serwer deweloperski → http://localhost:5173
```

Wersja produkcyjna (statyczne pliki w `dist/`, można je otworzyć z dowolnego serwera plików):

```bash
npm run build
npm run preview
```

Program można później spakować jako aplikację desktopową (np. Tauri lub Electron) bez zmian w kodzie.

## Funkcje

### Bryły i obiekty
- **Bryły podstawowe**: sześcian, walec, kula, stożek, ostrosłup (20 mm, stoją na stole).
- **Przesuwanie, obracanie, skalowanie** uchwytami w widoku (W / E / R) lub liczbowo w panelu.
- **Wymiary w mm** w panelu; dla walca, stożka i kuli także **średnica / promień / wysokość**.
- **Połóż na stole** – opuszcza bryłę tak, by jej najniższy punkt leżał na z = 0.
- **Duplikowanie** (Ctrl+D) – kopia obok oryginału z przerwą 5 mm; **powielanie w rzędzie**
  (liczba kopii, przerwa, kierunek X/Y) z ostrzeżeniem, gdy kopie wychodzą poza stół.
- **Cofnij / ponów** (Ctrl+Z / Ctrl+Y) dla wszystkich operacji.

### Edycja punktów (tryb „Wierzchołki”, Tab)
- **Przeciąganie wierzchołków** myszą: w poziomie, z Shift tylko w pionie (Z).
- **Przyciąganie do siatki** 0,5 / 1 / 5 / 10 mm – w menu ⚙ Ustawienia (Alt podczas przeciągania wyłącza).
- **Zaznaczanie wielu punktów** (Ctrl+klik, Ctrl+A) i wpisywanie współrzędnych w panelu.
- **Dodawanie punktów**: podwójne kliknięcie na krawędzi lub ścianie (z podglądem miejsca).
- **Symetria (lustro)** względem osi X / Y / Z bryły (klawisz M): zmiany po jednej stronie
  powtarzają się po drugiej. Siatka jest automatycznie przygotowywana tak, by była
  symetryczna co do każdego trójkąta; punkty bez pary są oznaczane na czerwono.

### Operacje na bryłach (grupa „Modelowanie”)
Wszystkie działają tak samo: klik w narzędzie na pasku, potem wskazanie w widoku
(podpowiedź w pasku stanu), Esc lub drugi klik w narzędzie – anuluj.
- **Odejmij / Połącz / Część wspólna** (CSG) – klik w bryłę A, potem w bryłę B
  (zaznaczona bryła od razu staje się bryłą A). Np. walec odjęty od sześcianu daje otwór.
- **Most** (B) – łączy dwie płaskie ściany (tej samej lub różnych brył) nowymi ścianami.
  Obrysy mogą mieć różną liczbę punktów (np. kwadrat → okrąg). Ściany pod kątem łączone są
  **łukiem** (↑/↓ – liczba segmentów, ←/→ – obrót dopasowania). Podgląd przed zatwierdzeniem,
  ostrzeżenia o przechodzeniu przez bryły i zbyt ciasnym zakręcie; wynik nieszczelny nie da
  się zatwierdzić.
- **Zaokrąglanie i fazowanie rantów** (F) – klik w ranty (cały okrąg walca to jeden rant),
  promień / szerokość i gładkość w panelu, **podgląd na żywo**. Ranty zewnętrzne są
  zaokrąglane, wewnętrzne narożniki wypełniane łukiem.

### Widok i pomiary
- **Widok 3D** (P) i **z góry** (T); stół 220 × 220 mm z siatką 1 i 10 mm.
- **Wskaźnik osi** w rogu – kliknięcie w oś ustawia widok wzdłuż niej.
- **Miarka** (D) – odległość między **wierzchołkami i rantami** (także różnych brył):
  - wierzchołek ↔ wierzchołek – prosto między punktami,
  - wierzchołek ↔ rant – linia prostopadła do rantu,
  - rant ↔ rant – linia prostopadła do obu rantów (najkrótsza odległość, np. szerokość
    szczeliny); przy rantach równoległych przechodzi przez miejsce kliknięcia.
  Narożniki mają pierwszeństwo przed rantem, punkty w środku gładkiego rantu (np. na okręgu
  walca) – nie. Pomiar śledzi przesuwanie brył i punktów; ⊥ w etykiecie = pomiar prostopadły.

### Pliki (menu „Plik ▾”)
- **Zapisz / Otwórz** projekt (JSON, Ctrl+S / Ctrl+O) – zachowuje kształt, położenie, kolory i nazwy.
- **Eksport STL** (binarny) i **Eksport 3MF** (jednostki mm, osobne obiekty z nazwami
  i kolorami). Ostrzeżenie, gdy część bryły jest poniżej stołu.

## Układ okna

- **Górny pasek** – grupy według celu: *Dodaj* (bryły), *Edycja* (cofnij/ponów, tryb
  obiektu/wierzchołków, przesuń/obróć/skaluj, duplikuj, usuń), *Modelowanie*
  (odejmij, połącz, część wspólna, most, zaokrąglij), *Widok* (3D, z góry, miarka),
  a po prawej menu **Plik ▾** (otwórz, zapisz, eksport STL / 3MF) i **⚙ Ustawienia**
  (przyciąganie do siatki i krok siatki).
- **Panel po prawej** – lista obiektów i **właściwości** zaznaczonej bryły (nazwa, kolor,
  położenie, obrót, wymiary, połóż na stole, powielanie w rzędzie).
- **Pasek stanu** na dole – podpowiedzi aktywnego narzędzia, wyniki pomiarów, ostrzeżenia;
  w prawym rogu link **„Skróty klawiszowe”** otwierający ściągawkę (także klawisz **?**).

## Sterowanie

| Mysz | Działanie |
|---|---|
| LPM | zaznacz / przeciągnij / wskaż |
| PPM | obrót widoku |
| ŚPM | przesuwanie widoku |
| Kółko | przybliżanie |

| Klawisz | Działanie |
|---|---|
| Tab | tryb obiektów ↔ wierzchołków |
| W / E / R | przesuń / obróć / skaluj |
| T / P | widok z góry / 3D |
| Ctrl+S / Ctrl+O | zapisz / otwórz projekt |
| Ctrl+D | duplikuj |
| Del | usuń bryłę |
| Ctrl+Z / Ctrl+Y | cofnij / ponów |
| M | symetria wył. / X / Y / Z (tryb wierzchołków) |
| D | miarka |
| B | most |
| F | zaokrąglanie rantów |
| Enter | zatwierdź (most, zaokrąglenie) |
| Esc | anuluj / cofnij krok / wyłącz narzędzie |
| ? | okno ze skrótami klawiszowymi |

## Technologie

- [TypeScript](https://www.typescriptlang.org/) + [Vite](https://vitejs.dev/)
- [three.js](https://threejs.org/) – renderowanie, kamery, uchwyty, eksport STL
- [Manifold](https://github.com/elalish/manifold) (`manifold-3d`, WebAssembly) – operacje
  logiczne na bryłach; gwarantuje szczelne wyniki
- [fflate](https://github.com/101arrowz/fflate) – archiwum ZIP dla formatu 3MF

## Struktura kodu

```
src/
  main.ts          spina całość: pasek narzędzi, mysz, klawiatura, narzędzia
  model.ts         dokument: bryły, zaznaczenie, historia cofania, zapis
  primitives.ts    bryły podstawowe i porządkowanie siatek (scalanie punktów itp.)
  viewport.ts      renderer, kamery 3D / z góry, stół, uchwyty przesuwania
  axisGizmo.ts     wskaźnik osi w rogu widoku
  vertexEditor.ts  edycja punktów: przeciąganie, dodawanie, symetria
  mirror.ts        logika lustra: pary punktów, symetryzacja siatki
  csg.ts           operacje logiczne (Manifold)
  bridge.ts        narzędzie „Most”
  fillet.ts        zaokrąglanie i fazowanie rantów
  measure.ts       miarka
  io.ts            zapis / odczyt projektu, eksport STL i 3MF
  ui.ts            panel boczny: lista obiektów i właściwości
```

Model danych sceny trzyma bryły jako siatki trójkątów z indeksami (wspólne wierzchołki),
dzięki czemu edycja punktów nie rozrywa siatki, a eksport jest szczelny.

## Ograniczenia

- Most łączy tylko **płaskie ściany bez otworów**.
- Zaokrąglanie działa na rantach jednej bryły naraz; narożnik, w którym spotykają się trzy
  zaokrąglone krawędzie, nie jest idealnym fragmentem kuli.
- Walec, stożek i kula mają stałą liczbę boków (24) – otwór wpisany średnicą jest
  wielokątem, warto dać zapas 0,2–0,3 mm na otwory pod śruby.
- „Zapisz” pobiera plik do folderu Pobrane (nie nadpisuje otwartego pliku).
