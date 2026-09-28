import path from 'node:path';

const allowedExt = new Set(['.png', '.jpg', '.jpeg', '.pdf', '.json']);
export const normalizedFacts = value => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw Error('structuredFacts must be an object');
  const seats = value.seats ?? [];
  if (!Array.isArray(seats) || seats.some(seat => !Number.isSafeInteger(seat.number) || seat.number < 1 ||
    !(seat.machineName === undefined || seat.machineName === null || typeof seat.machineName === 'string'))) {
    throw Error('structuredFacts.seats must contain positive number and optional machineName');
  }
  if (new Set(seats.map(seat => seat.number)).size !== seats.length) throw Error('Duplicate structured seat number');
  if (value.expectedCount !== undefined && (!Number.isSafeInteger(value.expectedCount) || value.expectedCount < 0)) {
    throw Error('Invalid expectedCount');
  }
  if (value.imageQuality !== undefined && (typeof value.imageQuality !== 'number' || value.imageQuality < 0 || value.imageQuality > 1)) {
    throw Error('Invalid imageQuality');
  }
  return {seats: seats.map(seat => ({number: seat.number, machineName: seat.machineName ?? null})),
    expectedCount: value.expectedCount ?? (seats.length || null), imageQuality: value.imageQuality ?? null};
};

export function normalizeArtifact(filePath, bytes) {
  const ext = path.extname(filePath).toLowerCase();
  if (!allowedExt.has(ext)) throw Error(`Unsupported local artifact: ${ext || '(none)'}`);
  if (!bytes.length || bytes.length > 30 * 1024 * 1024) throw Error('Artifact must be 1 byte–30 MB');
  let format;
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) format = 'png';
  else if (bytes[0] === 0xff && bytes[1] === 0xd8) format = 'jpeg';
  else if (bytes.subarray(0, 5).toString() === '%PDF-') format = 'pdf';
  else if (ext === '.json') format = 'json';
  else throw Error(`File signature does not match supported image/PDF: ${filePath}`);
  if (format === 'png' && ext !== '.png' || format === 'jpeg' && !['.jpg', '.jpeg'].includes(ext) ||
    format === 'pdf' && ext !== '.pdf' || format === 'json' && ext !== '.json') throw Error('File extension/signature mismatch');
  if (format !== 'json') return {format, json: null};
  let json;
  try {json = JSON.parse(bytes.toString('utf8'));} catch {throw Error(`Invalid JSON artifact: ${filePath}`);}
  if (json === null || typeof json !== 'object' || Array.isArray(json)) throw Error('JSON artifact must be an object');
  // Extracted HTML is accepted only as already-structured JSON; raw HTML is never fetched or parsed.
  return {format, json};
}
