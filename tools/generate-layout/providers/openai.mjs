import fs from 'node:fs/promises';
import path from 'node:path';
import {PDFDocument} from 'pdf-lib';
import {aiOutputSchema, validateAIOutput} from '../validate-ai-output.mjs';
import {normalizeArtifact} from '../normalize-source.mjs';

const API_URL = 'https://api.openai.com/v1/responses';
const defaults = {maxFiles: 4, maxImageBytes: 8 * 1024 * 1024, maxPdfBytes: 20 * 1024 * 1024,
  maxTotalBytes: 20 * 1024 * 1024, maxPdfPages: 3, timeoutMs: 90_000, maxRetries: 1,
  minImageWidth: 600, minImageHeight: 400};
const visual = new Set(['png', 'jpeg', 'pdf']);
const fail = (code, message = code, retryable = false) => Object.assign(new Error(message), {code, retryable});
const inside = (file, directory) => file.startsWith(directory + path.sep);
const positive = (value, name) => {if (!Number.isSafeInteger(value) || value < 1) throw Error(`Invalid ${name}`);};

function imageDimensions(bytes, format) {
  if (format === 'png') return bytes.length >= 24 ? {width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20)} : null;
  for (let i = 2; i + 9 < bytes.length;) {
    if (bytes[i] !== 0xff) break;
    const marker = bytes[i + 1];
    if ([0xc0, 0xc1, 0xc2, 0xc3].includes(marker)) return {height: bytes.readUInt16BE(i + 5), width: bytes.readUInt16BE(i + 7)};
    if (marker === 0xd9 || marker === 0xda) break;
    const length = bytes.readUInt16BE(i + 2);
    if (length < 2) break;
    i += 2 + length;
  }
  return null;
}

function normalizedObservation(observation, visualIds) {
  const report = validateAIOutput(observation);
  if (!report.valid) throw fail('invalid_ai_schema', `AI output schema invalid: ${report.errors.slice(0, 4).join('; ')}`, true);
  if (observation.floors.some(floor => floor.width !== 1 || floor.height !== 1)) {
    throw fail('invalid_normalized_coordinates', 'AI output floor dimensions must be normalized to 1', true);
  }
  if (observation.modelConfidence !== null && observation.modelConfidence < 0.25) {
    throw fail('insufficient_evidence', 'Floor map quality is insufficient for reliable island detection');
  }
  let islandCount = 0;
  const box = (v, label) => {
    if (!Array.isArray(v) || v.some(n => !Number.isFinite(n)) || v[0] < 0 || v[1] < 0 ||
      v[2] <= 0 || v[3] <= 0 || v[0] + v[2] > 1.001 || v[1] + v[3] > 1.001) {
      throw fail('invalid_normalized_coordinates', `${label} must be inside normalized floor bounds`, true);
    }
  };
  for (const floor of observation.floors) for (const island of floor.islands) {
    islandCount++;
    if (island.sourceIds.some(id => !visualIds.has(id))) throw fail('invalid_source_reference', `AI output source reference is unknown: ${island.id}`, true);
    const g = island.geometry;
    if (g) {
      if (g.x < 0 || g.x > 1 || g.y < 0 || g.y > 1 ||
        g.width !== undefined && g.x + g.width > 1.001 || g.height !== undefined && g.y + g.height > 1.001 ||
        ['size', 'pitch', 'radius'].some(key => g[key] !== undefined && g[key] > 1) ||
        g.points?.some(p => p[0] < 0 || p[1] < 0 || p[0] + p[2] > 1.001 || p[1] + p[3] > 1.001)) {
        throw fail('invalid_normalized_coordinates', `Island ${island.id} is outside normalized floor bounds`, true);
      }
    }
    for (const slot of island.machineSlots) box(slot.position, `Slot ${slot.id}`);
  }
  if (!islandCount) throw fail('insufficient_evidence', 'No visible island could be identified');
  return observation;
}

export async function prepareVisionInput(bundle, {root, allowedDirectory = null, includeData = true, limits = defaults} = {}) {
  if (!root && !allowedDirectory) throw Error('Explicit local evidence root is required');
  const directory = path.resolve(allowedDirectory ?? path.join(root, 'work/nationwide/evidence', bundle.storeId));
  const visualSources = bundle.sources.filter(source => visual.has(source.format));
  if (!visualSources.length) throw fail('insufficient_evidence', 'No local floor-map image or PDF');
  if (visualSources.length > limits.maxFiles) throw fail('file_limit', 'Too many visual files for one store');
  const content = [{type: 'input_text', text: `Store ${bundle.storeId}. Visual evidence IDs: ${visualSources.map(s => `${s.sourceId} (floor ${s.floor})`).join(', ')}. Source URLs are provenance only and are not available to fetch.`}];
  const files = [];
  let totalBytes = 0, pageCount = 0;
  for (const source of visualSources) {
    if (source.usageReviewed !== true) throw fail('usage_unreviewed', `Source ${source.sourceId} has no explicit usage review`);
    if (!source.localArtifactPath) throw fail('source_missing', `Source ${source.sourceId} has no local artifact`);
    const local = path.resolve(source.localArtifactPath), real = await fs.realpath(local);
    if (!inside(real, directory)) throw fail('unsafe_source_path', `Source ${source.sourceId} leaves its private evidence directory`);
    const bytes = await fs.readFile(real), format = normalizeArtifact(real, bytes).format;
    if (format !== source.format || !visual.has(format)) throw fail('unsupported_format', `Unsupported source format: ${source.sourceId}`);
    if (format === 'pdf' ? bytes.length > limits.maxPdfBytes : bytes.length > limits.maxImageBytes) {
      throw fail('size_limit', `Source ${source.sourceId} exceeds per-file byte limit`);
    }
    totalBytes += bytes.length;
    if (totalBytes > limits.maxTotalBytes) throw fail('size_limit', 'Store exceeds total input byte limit');
    if (format === 'pdf') {
      let document;
      try {document = await PDFDocument.load(bytes);} catch {throw fail('invalid_pdf', `PDF cannot be opened: ${source.sourceId}`);}
      const count = document.getPageCount(), pages = source.pages ?? (count === 1 ? [1] : null);
      if (!pages) throw fail('pdf_pages_required', `Select pages for multi-page PDF ${source.sourceId}`);
      if (!Array.isArray(pages) || !pages.length || pages.some(page => !Number.isSafeInteger(page) || page < 1 || page > count) ||
        new Set(pages).size !== pages.length) throw fail('invalid_pdf_pages', `Invalid pages for ${source.sourceId}`);
      pageCount += pages.length;
      if (pageCount > limits.maxPdfPages) throw fail('page_limit', 'Selected PDF pages exceed page limit');
      files.push({sourceId: source.sourceId, format, bytes: bytes.length, pages, totalPages: count});
      if (includeData) {
        const selected = await PDFDocument.create();
        const copied = await selected.copyPages(document, pages.map(page => page - 1));
        copied.forEach(page => selected.addPage(page));
        const selectedBytes = await selected.save();
        content.push({type: 'input_text', text: `sourceId=${source.sourceId}; selected PDF pages=${pages.join(',')}; floor=${source.floor}`});
        content.push({type: 'input_file', filename: `${source.sourceId}.pdf`, file_data: `data:application/pdf;base64,${Buffer.from(selectedBytes).toString('base64')}`, detail: 'high'});
      }
    } else {
      const dimensions = imageDimensions(bytes, format);
      if (!dimensions || dimensions.width < limits.minImageWidth || dimensions.height < limits.minImageHeight) {
        throw fail('insufficient_evidence', `Image resolution is too low or unreadable: ${source.sourceId}`);
      }
      files.push({sourceId: source.sourceId, format, bytes: bytes.length, width: dimensions.width, height: dimensions.height});
      if (includeData) {
        content.push({type: 'input_text', text: `sourceId=${source.sourceId}; floor=${source.floor}; image=${dimensions.width}x${dimensions.height}`});
        content.push({type: 'input_image', image_url: `data:image/${format === 'jpeg' ? 'jpeg' : 'png'};base64,${bytes.toString('base64')}`, detail: 'high'});
      }
    }
  }
  return {content, files, fileCount: files.length, pageCount, totalBytes,
    visualSourceIds: new Set(visualSources.map(source => source.sourceId))};
}

const INSTRUCTIONS = `You extract FLOOR777 floor-map observations from supplied local visual evidence only. Never fetch a URL or use unseen information. Return only the supplied JSON schema. Never invent islands, island boundaries, machine slots, machine numbers, floor names, or consecutive numbers. visibleNumber is an integer only when those exact digits are visibly legible at that slot; otherwise null. Do not infer a missing number from neighboring numbers or a roster. visibleMachineName is a candidate only when the exact name is visibly legible at that slot; otherwise null. Use only the supplied visual sourceIds. Coordinates are normalized fractions 0..1 of each floor map: floor width=1 and height=1, all geometry and machine-slot boxes inside that area. Rotation is degrees. If a boundary, count, shape, direction or number is unclear, use unknown/null where the schema permits, reduce confidence, and state the uncertainty on the island. If no floor/island can be recognized, return an empty island list for the visible floor. Do not include explanations or Markdown.`;

function extractResponse(response) {
  if (response?.status === 'incomplete') throw fail('incomplete_response', 'AI response was incomplete', true);
  const contents = response?.output?.filter(item => item.type === 'message').flatMap(item => item.content ?? []) ?? [];
  if (contents.some(item => item.type === 'refusal')) throw fail('ai_refusal', 'AI declined to analyze the evidence');
  const text = contents.filter(item => item.type === 'output_text').map(item => item.text).join('');
  if (!text) throw fail('empty_ai_response', 'AI returned no structured observation', true);
  try {return JSON.parse(text);} catch {throw fail('malformed_ai_response', 'AI returned malformed JSON', true);}
}

export function createOpenAIProvider({root, model = process.env.FLOOR777_VISION_MODEL || 'gpt-4.1',
  apiKey = () => process.env.OPENAI_API_KEY, transport = fetch, ...options} = {}) {
  if (!root) throw Error('OpenAI provider needs the local repository root');
  if (typeof model !== 'string' || !model.trim()) throw Error('Vision model is required');
  const limits = {...defaults, ...options};
  for (const name of ['maxFiles', 'maxImageBytes', 'maxPdfBytes', 'maxTotalBytes', 'maxPdfPages', 'timeoutMs', 'minImageWidth', 'minImageHeight']) positive(limits[name], name);
  if (!Number.isSafeInteger(limits.maxRetries) || limits.maxRetries < 0 || limits.maxRetries > 2) throw Error('maxRetries must be 0..2');
  let lastAudit = null;
  const provider = {id: 'openai', model, coordinateSpace: 'normalized', requiresReviewedSources: true,
    getLastAudit: () => lastAudit,
    async preflight(bundle, {allowedDirectory = null} = {}) {
      const prepared = await prepareVisionInput(bundle, {root, allowedDirectory, includeData: false, limits});
      return {provider: 'openai', model, fileCount: prepared.fileCount, pageCount: prepared.pageCount,
        totalBytes: prepared.totalBytes, files: prepared.files};
    },
    async generateLayoutFromEvidence(bundle) {
      const startedAt = new Date().toISOString();
      lastAudit = {startedAt, completedAt: null, fileCount: 0, pageCount: 0, retryCount: 0,
        responseValidation: 'not_started', failureReason: null};
      try {
        const prepared = await prepareVisionInput(bundle, {root, includeData: true, limits});
        lastAudit.fileCount = prepared.fileCount; lastAudit.pageCount = prepared.pageCount;
        const key = typeof apiKey === 'function' ? apiKey() : apiKey;
        if (!key || typeof key !== 'string') throw fail('missing_api_key', 'OPENAI_API_KEY is not set');
        const body = {model, store: false, instructions: INSTRUCTIONS,
          input: [{role: 'user', content: prepared.content}],
          text: {format: {type: 'json_schema', name: 'floor777_vision_observation', strict: false, schema: aiOutputSchema}}};
        for (let attempt = 0; attempt <= limits.maxRetries; attempt++) {
          lastAudit.retryCount = attempt;
          try {
            const controller = new AbortController();
            let timer;
            const request = Promise.resolve().then(async () => {
              const response = await transport(API_URL, {method: 'POST',
                headers: {'Content-Type': 'application/json', Authorization: `Bearer ${key}`},
                body: JSON.stringify(body), signal: controller.signal});
              if (!response.ok) throw fail(`provider_http_${response.status}`, `Vision provider HTTP ${response.status}`,
                response.status === 429 || response.status >= 500);
              try {return await response.json();} catch {throw fail('invalid_api_response', 'Vision provider response is not JSON', true);}
            });
            const timeout = new Promise((_, reject) => {timer = setTimeout(() => {controller.abort(); reject(fail('provider_timeout', 'Vision provider timed out', true));}, limits.timeoutMs);});
            let raw;
            try {raw = await Promise.race([request, timeout]);} finally {clearTimeout(timer);}
            const observation = extractResponse(raw);
            if (observation.storeId !== bundle.storeId) throw fail('invalid_store_reference', 'AI output storeId differs from evidence', true);
            normalizedObservation(observation, prepared.visualSourceIds);
            lastAudit.responseValidation = 'passed';
            return observation;
          } catch (error) {
            const safe = error.code ? error : fail('provider_request_failed', 'Vision provider request failed', true);
            lastAudit.failureReason = safe.code;
            lastAudit.responseValidation = safe.code === 'invalid_ai_schema' ? 'failed' : lastAudit.responseValidation;
            if (!safe.retryable || attempt === limits.maxRetries) throw safe;
          }
        }
      } catch (error) {lastAudit.failureReason = error.code ?? 'provider_error'; throw error;}
      finally {lastAudit.completedAt = new Date().toISOString();}
    }};
  return provider;
}
