import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const template = () => fs.readFileSync(path.join(root, 'tools', 'templates', 'hall-page.html'), 'utf8');
const escapeHTML = value => String(value).replace(/[&<>"']/g, character =>
  ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[character]));

// Store-specific content is limited to metadata and editorial notices. All
// controls, map markup and script references live in one maintained template.
export function renderHallPage(hall, meta = {}) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(hall?.id)) throw Error('Invalid store ID');
  const values = {
    STORE_ID: hall.id,
    NAME: escapeHTML(hall.name),
    PREFECTURE: escapeHTML(hall.prefecture),
    CITY: escapeHTML(meta.cityLabel || hall.city),
    BREADCRUMB_CITY: escapeHTML(meta.breadcrumbCity ?? hall.city),
    MAP_VIEWBOX_ATTRIBUTE: meta.mapViewBoxAttribute || 'viewbox="0 0 2205 2020"',
    POSITION_FILE: escapeHTML(meta.positionFile || `positions-${hall.id}.json`),
    HERO_NOTE: meta.heroNote || '',
    SOURCE_NOTE: meta.sourceNote || '',
    ROBOTS_META: meta.robotsMeta || '',
    STRUCTURED_DATA: meta.structuredData || '',
    SW_REGISTER: meta.swRegister || ''
  };
  const html = template().replace(/\{\{([A-Z_]+)\}\}/g, (token, key) => {
    if (!Object.hasOwn(values, key)) throw Error(`Unknown template token: ${token}`);
    return values[key];
  });
  const newline = meta.lineEnding === 'crlf' ? '\r\n' : '\n';
  const trailing = meta.trailingEnding === 'crlf' ? '\r\n' : '\n';
  return html.replace(/\r?\n/g, newline).replace(/(?:\r?\n)*$/, '') + trailing.repeat(meta.trailingNewlines ?? 1);
}

export function renderExistingHall(id) {
  const hall = JSON.parse(fs.readFileSync(path.join(root, 'data', `${id}.json`), 'utf8'));
  const metadata = JSON.parse(fs.readFileSync(path.join(root, 'tools', 'hall-page-meta.json'), 'utf8'));
  if (!metadata[id]) throw Error(`No page metadata for ${id}`);
  return renderHallPage(hall, metadata[id]);
}
