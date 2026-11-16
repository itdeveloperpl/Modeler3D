import * as THREE from 'three';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import { strToU8, zipSync } from 'fflate';
import type { DocData, Model, ModelMesh } from './model';

function download(data: BlobPart, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Geometria bryły przeliczona do współrzędnych świata (mm, oś Z w górę),
 * bez krawędzi i uchwytów edycji.
 */
function worldGeometry(o: ModelMesh): THREE.BufferGeometry {
  o.updateMatrixWorld(true);
  const g = o.geometry.clone().applyMatrix4(o.matrixWorld);
  // odbicie lustrzane (ujemna skala) odwraca kolejność wierzchołków – naprawiamy orientację ścian
  if (o.matrixWorld.determinant() < 0) {
    const idx = g.getIndex()!;
    for (let i = 0; i < idx.count; i += 3) {
      const b = idx.getX(i + 1);
      idx.setX(i + 1, idx.getX(i + 2));
      idx.setX(i + 2, b);
    }
  }
  return g;
}

/** Eksport do binarnego STL – jedna siatka ze wszystkich brył. */
export function exportSTL(model: Model, onlySelected = false): number {
  const list = onlySelected && model.selected ? [model.selected] : model.objects;
  const group = new THREE.Group();
  for (const o of list) group.add(new THREE.Mesh(worldGeometry(o)));
  const data = new STLExporter().parse(group, { binary: true }) as DataView;
  download(data, 'model.stl', 'model/stl');
  return list.length;
}

const xmlEscape = (s: string) =>
  s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!);

/** Liczba z dokładnością do 0,0001 mm, bez zbędnych zer. */
const num = (v: number) => String(Math.round(v * 1e4) / 1e4);

/**
 * Eksport do 3MF (specyfikacja 3MF Core 1.x).
 * W odróżnieniu od STL plik zawiera jednostki (mm), a każda bryła jest osobnym
 * obiektem z nazwą i kolorem – slicer pokaże je jako osobne części.
 */
export function export3MF(model: Model, onlySelected = false): number {
  const list = onlySelected && model.selected ? [model.selected] : model.objects;

  const colors = list.map((o) => '#' + o.material.color.getHexString().toUpperCase());
  const materials = list
    .map((o, i) => `      <base name="${xmlEscape(o.name)}" displaycolor="${colors[i]}" />`)
    .join('\n');

  const objects = list.map((o, i) => {
    const g = worldGeometry(o);
    const pos = g.getAttribute('position');
    const idx = g.getIndex()!;
    const v: string[] = [];
    for (let k = 0; k < pos.count; k++) {
      v.push(`          <vertex x="${num(pos.getX(k))}" y="${num(pos.getY(k))}" z="${num(pos.getZ(k))}" />`);
    }
    const t: string[] = [];
    for (let k = 0; k < idx.count; k += 3) {
      t.push(`          <triangle v1="${idx.getX(k)}" v2="${idx.getX(k + 1)}" v3="${idx.getX(k + 2)}" />`);
    }
    g.dispose();
    return `    <object id="${i + 2}" name="${xmlEscape(o.name)}" type="model" pid="1" pindex="${i}">
      <mesh>
        <vertices>
${v.join('\n')}
        </vertices>
        <triangles>
${t.join('\n')}
        </triangles>
      </mesh>
    </object>`;
  });

  const items = list.map((_, i) => `    <item objectid="${i + 2}" />`).join('\n');

  const modelXml = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="pl-PL" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <metadata name="Application">Modeler 3D</metadata>
  <metadata name="CreationDate">${new Date().toISOString().slice(0, 10)}</metadata>
  <resources>
    <basematerials id="1">
${materials}
    </basematerials>
${objects.join('\n')}
  </resources>
  <build>
${items}
  </build>
</model>
`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" />
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml" />
</Types>
`;

  const rels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" />
</Relationships>
`;

  const zip = zipSync({
    '[Content_Types].xml': strToU8(contentTypes),
    '_rels/.rels': strToU8(rels),
    '3D/3dmodel.model': strToU8(modelXml),
  }, { level: 6 });
  download(zip, 'model.3mf', 'model/3mf');
  return list.length;
}

export function saveProject(model: Model) {
  download(JSON.stringify(model.serialize()), 'projekt.json', 'application/json');
}

export async function openProject(model: Model, file: File) {
  const doc = JSON.parse(await file.text()) as DocData;
  if (doc.version !== 1 || !Array.isArray(doc.objects)) throw new Error('Nieznany format pliku');
  model.load(doc);
}
