import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {PDFDocument} from 'pdf-lib';
import {createOpenAIProvider, prepareVisionInput} from '../tools/generate-layout/providers/openai.mjs';
import {generateStore} from '../tools/generate-layout/index.mjs';
import {loadMaster, registerHall, saveMaster} from '../tools/nationwide/master.mjs';
import {processSourcePacks} from '../tools/nationwide/populate.mjs';
import {sealSourcePack} from '../tools/nationwide/source-pack.mjs';
import {validateLayout} from '../tools/layout-validator.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicPaths = ['data/halls.json', 'tests/fixtures/layout-golden.json',
  'data/hyper-arrow-mihara.json', 'data/super-cosmo-sakai.json', 'data/kikuya-sakai-honten.json'];
const baseline = await Promise.all(publicPaths.map(file => fs.readFile(path.join(repo, file))));
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'floor777-vision-'));
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==', 'base64');
const now = new Date().toISOString();
const observation = storeId => ({schemaVersion: 1, storeId, modelConfidence: 0.6, floors: [{
  id: 'slot-floor', width: 1, height: 1, category: 'slot', rentalType: '46枚', modelConfidence: 0.6,
  islands: [{id: 'island-1', shape: 'line', geometry: {x: 0.1, y: 0.2, width: 0.3, height: 0.1, rotation: 0},
    estimatedMachineCount: 2, modelConfidence: 0.6, sourceIds: ['map'], uncertainty: ['One seat number is unreadable'],
    machineSlots: [{id: 'a', position: [0.1, 0.2, 0.04, 0.04], visibleNumber: 101, visibleMachineName: '機種A', modelConfidence: 0.9},
      {id: 'b', position: [0.3, 0.2, 0.04, 0.04], visibleNumber: null, modelConfidence: 0.2}]}]
} ]});
const response = object => ({ok: true, json: async () => ({status: 'completed', output: [{type: 'message',
  content: [{type: 'output_text', text: typeof object === 'string' ? object : JSON.stringify(object)}]}]})});
const source = (id, localArtifactPath, format = 'png', pages = null, usageReviewed = true) => ({sourceId: id,
  sourceType: 'user-supplied', sourceUrl: 'https://example.org/provenance-only', observedAt: now, retrievedAt: now,
  floor: 'slot-floor', category: 'slot', rentalType: '46枚', localArtifactPath, format, pages, usageReviewed,
  contentHash: 'a'.repeat(64), structuredFacts: {}});

try {
  const evidenceDir = path.join(root, 'work/nationwide/evidence', 'fixture-hall');
  await fs.mkdir(evidenceDir, {recursive: true});
  await fs.writeFile(path.join(evidenceDir, 'map.png'), png);
  const bundle = {storeId: 'fixture-hall', storeName: 'Fixture', sources: [source('map', path.join(evidenceDir, 'map.png'))]};
  const providerOpts = {root, apiKey: 'test-only', minImageWidth: 1, minImageHeight: 1};
  let calls = 0, request;
  const provider = createOpenAIProvider({...providerOpts, transport: async (url, options) => {
    calls++; request = {url, options}; return response(observation('fixture-hall'));
  }});
  assert.equal(provider.id, 'openai'); assert.equal(typeof provider.generateLayoutFromEvidence, 'function');
  const preflight = await provider.preflight(bundle);
  assert.equal(preflight.fileCount, 1); assert.equal(preflight.totalBytes, png.length);
  assert.equal(calls, 0);
  const generated = await provider.generateLayoutFromEvidence(bundle);
  assert.equal(generated.floors[0].islands[0].machineSlots[1].visibleNumber, null);
  assert.equal(calls, 1);
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0xbc,
    0x03, 0xe8, 0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00, 0xff, 0xd9]);
  await fs.writeFile(path.join(evidenceDir, 'map.jpg'), jpeg);
  const jpegBundle = {...bundle, sources: [source('photo', path.join(evidenceDir, 'map.jpg'), 'jpeg')]};
  const jpegPayload = await prepareVisionInput(jpegBundle, {root, limits: {maxFiles: 4, maxImageBytes: 8e6,
    maxPdfBytes: 20e6, maxTotalBytes: 20e6, maxPdfPages: 3, minImageWidth: 600, minImageHeight: 400}});
  assert(jpegPayload.content.some(item => item.type === 'input_image' && item.image_url.startsWith('data:image/jpeg;base64,')));
  const payload = JSON.parse(request.options.body);
  assert.equal(request.url, 'https://api.openai.com/v1/responses');
  assert.equal(payload.store, false); assert.equal(payload.text.format.type, 'json_schema');
  assert.equal(payload.text.format.schema.title, 'FLOOR777 vision observation v1');
  assert(payload.input[0].content.some(item => item.type === 'input_image' && item.image_url.startsWith('data:image/png;base64,')));
  const promptText = payload.input[0].content.filter(item => item.type === 'input_text').map(item => item.text).join('\n');
  assert(promptText.includes('floor=slot-floor'));
  assert(promptText.includes('category=slot'));
  assert(promptText.includes('rentalType=46枚'));
  assert(payload.instructions.includes('copy category and rentalType exactly'));
  assert(payload.instructions.includes('include only islands or rows that are visibly part of the slot area'));
  assert(!JSON.stringify(payload).includes('https://example.org/provenance-only'));
  assert(!JSON.stringify(provider.getLastAudit()).includes('test-only'));
  const noRights = structuredClone(bundle); noRights.sources[0].usageReviewed = false;
  await assert.rejects(() => provider.generateLayoutFromEvidence(noRights), /usage review/);
  assert.equal(calls, 1);
  await assert.rejects(() => createOpenAIProvider({...providerOpts, apiKey: '', transport: async () => {calls++; return response(observation('fixture-hall'));}})
    .generateLayoutFromEvidence(bundle), /OPENAI_API_KEY/);
  assert.equal(calls, 1);
  await assert.rejects(() => prepareVisionInput({...bundle, sources: [source('map', path.join(root, 'outside.png'))]},
    {root, limits: {maxFiles: 4, maxImageBytes: 10_000, maxPdfBytes: 10_000, maxTotalBytes: 10_000,
      maxPdfPages: 3, minImageWidth: 1, minImageHeight: 1}}), /ENOENT|unsafe/);
  await fs.writeFile(path.join(root, 'outside.png'), png);
  await assert.rejects(() => provider.generateLayoutFromEvidence({...bundle, sources: [source('map', path.join(root, 'outside.png'))]}), /private evidence directory/);
  assert.equal(calls, 1);
  await assert.rejects(() => createOpenAIProvider({...providerOpts, maxImageBytes: 20}).preflight(bundle), /byte limit/);
  await assert.rejects(() => createOpenAIProvider({...providerOpts, maxFiles: 1}).preflight({
    ...bundle, sources: [bundle.sources[0], jpegBundle.sources[0]]}), /Too many visual files/);
  await assert.rejects(() => createOpenAIProvider({...providerOpts, minImageWidth: 600}).preflight(bundle), /resolution/);
  const pdf = await PDFDocument.create(); pdf.addPage([600, 800]); pdf.addPage([600, 800]);
  const pdfBytes = Buffer.from(await pdf.save()); await fs.writeFile(path.join(evidenceDir, 'map.pdf'), pdfBytes);
  const pdfSource = source('map', path.join(evidenceDir, 'map.pdf'), 'pdf', null);
  await assert.rejects(() => provider.preflight({...bundle, sources: [pdfSource]}), /Select pages/);
  pdfSource.pages = [2];
  const pdfBundle = {...bundle, sources: [pdfSource]};
  assert.equal((await provider.preflight(pdfBundle)).pageCount, 1);
  const pdfPayload = await prepareVisionInput(pdfBundle, {root, limits: {maxFiles: 4, maxImageBytes: 8e6,
    maxPdfBytes: 20e6, maxTotalBytes: 20e6, maxPdfPages: 2, minImageWidth: 1, minImageHeight: 1}});
  const fileItem = pdfPayload.content.find(item => item.type === 'input_file');
  const clipped = await PDFDocument.load(Buffer.from(fileItem.file_data.split(',')[1], 'base64'));
  assert.equal(clipped.getPageCount(), 1);
  await assert.rejects(() => createOpenAIProvider({...providerOpts, maxPdfPages: 1}).preflight({
    ...bundle, sources: [{...pdfSource, pages: [1, 2]}]}), /page limit/);
  let malformedCalls = 0;
  const malformedProvider = createOpenAIProvider({...providerOpts, maxRetries: 1, transport: async () => {
    malformedCalls++; return response('{oops');
  }});
  await assert.rejects(() => malformedProvider.generateLayoutFromEvidence(bundle), /malformed JSON/);
  assert.equal(malformedCalls, 2); assert.equal(malformedProvider.getLastAudit().retryCount, 1);
  const schemaProvider = createOpenAIProvider({...providerOpts, maxRetries: 0, transport: async () => response({...observation('fixture-hall'), extra: true})});
  await assert.rejects(() => schemaProvider.generateLayoutFromEvidence(bundle), /schema invalid/);
  const refProvider = createOpenAIProvider({...providerOpts, maxRetries: 0, transport: async () => {
    const invalid = observation('fixture-hall'); invalid.floors[0].islands[0].sourceIds = ['not-in-evidence']; return response(invalid);
  }});
  await assert.rejects(() => refProvider.generateLayoutFromEvidence(bundle), /source reference/);
  const timeoutProvider = createOpenAIProvider({...providerOpts, timeoutMs: 10, maxRetries: 0,
    transport: async () => new Promise(() => {})});
  await assert.rejects(() => timeoutProvider.generateLayoutFromEvidence(bundle), /timed out/);
  const manifest = {storeId: 'fixture-hall', storeName: 'Fixture', sources: [{...bundle.sources[0],
    localArtifactPath: path.join(evidenceDir, 'map.png')}]};
  const draftRoot = path.join(root, 'work/layout-drafts');
  const draft = await generateStore(manifest, {baseDir: root, draftRoot, provider});
  assert.equal(draft.status, 'needs_review');
  assert.equal(draft.layout.floors[0].width, 1000);
  assert.equal(draft.layout.floors[0].islands[0].machines[0].position[0], 100);
  assert.equal(draft.layout.floors[0].islands[0].machines[0].machineName, '機種A');
  assert.equal(draft.layout.floors[0].islands[0].machines[1].number, null);
  assert(validateLayout(draft.layout).valid || draft.audit.validationSummary.errors > 0);
  assert.equal(draft.audit.providerRun.fileCount, 1);
  assert.equal((await generateStore(manifest, {baseDir: root, draftRoot, provider})).cached, true);
  const alternate = createOpenAIProvider({...providerOpts, model: 'different-model', transport: async () => response(observation('fixture-hall'))});
  assert.equal((await generateStore(manifest, {baseDir: root, draftRoot, provider: alternate})).cached, false);
  assert.equal((await generateStore(manifest, {baseDir: root, draftRoot, provider, force: true})).cached, false);
  let transientCalls = 0;
  const transient = createOpenAIProvider({...providerOpts, model: 'transient-test', maxRetries: 0, transport: async () => {
    transientCalls++; return transientCalls === 1 ? {ok: false, status: 500} : response(observation('fixture-hall'));
  }});
  const failedDraft = await generateStore(manifest, {baseDir: root, draftRoot, provider: transient});
  assert.equal(failedDraft.status, 'failed'); assert.equal(failedDraft.audit.providerRun.failureReason, 'provider_http_500');
  assert.equal((await generateStore(manifest, {baseDir: root, draftRoot, provider: transient})).cached, false);
  assert.equal(transientCalls, 2);
  const unreviewedManifest = structuredClone(manifest); unreviewedManifest.sources[0].usageReviewed = false;
  await assert.rejects(() => generateStore(unreviewedManifest, {baseDir: root, draftRoot, provider}), /usage review/);
  const twoFloors = observation('fixture-hall');
  twoFloors.floors.push({...structuredClone(twoFloors.floors[0]), id: 'second-floor'});
  const multiProvider = createOpenAIProvider({...providerOpts, model: 'multi-test', transport: async () => response(twoFloors)});
  const multiDraft = await generateStore(manifest, {baseDir: root, draftRoot, provider: multiProvider});
  assert.equal(multiDraft.status, 'blocked'); assert.equal(multiDraft.layout.floors.length, 2);
  assert(multiDraft.layout.verification.notes.includes('unsupported_multi_floor'));

  await fs.mkdir(path.join(root, 'halls'), {recursive: true});
  await fs.mkdir(path.join(root, 'data'), {recursive: true});
  await fs.writeFile(path.join(root, 'data/halls.json'), JSON.stringify({halls: []}));
  const master = await loadMaster(root);
  for (const id of ['first-hall', 'second-hall']) registerHall(master,
    {hallId: id, name: id, prefecture: '東京都', municipality: '千代田区', address: id, slotSupported: true});
  await saveMaster(root, master);
  for (const [id, approved] of [['first-hall', false], ['second-hall', true]]) {
    const dir = path.join(root, 'work/nationwide/sources', id); await fs.mkdir(dir, {recursive: true});
    await fs.writeFile(path.join(dir, 'map.png'), png);
    await fs.writeFile(path.join(dir, 'manifest.json'), JSON.stringify({formatVersion: 1, hallId: id, sources: [{
      sourceId: 'map', sourceType: 'user-supplied', sourceUrl: null, observedAt: now, importedAt: now,
      usageReviewed: approved, usageReviewedAt: approved ? now : null, usageNote: approved ? 'fixture review' : '',
      sourceOwner: 'fixture', floor: 'slot-floor', category: 'slot', rentalType: '46枚', pages: null,
      localFiles: [{path: 'map.png', checksum: null}]}]}));
    await sealSourcePack(root, id, {dryRun: false});
  }
  const batchProvider = createOpenAIProvider({...providerOpts, transport: async () => response(observation('second-hall'))});
  const batch = await processSourcePacks(root, {hallIds: ['first-hall', 'second-hall'], dryRun: false, provider: batchProvider});
  assert.equal(batch.counts.source_needed, 1);
  assert.equal(batch.counts.needs_review, 1);
  assert.equal((await loadMaster(root)).stores['second-hall'].review, null);
  assert.equal((await loadMaster(root)).stores['second-hall'].published, false);
  const withPdf = await loadMaster(root);
  registerHall(withPdf, {hallId: 'pdf-hall', name: 'pdf-hall', prefecture: '東京都', municipality: '千代田区',
    address: 'pdf-hall', slotSupported: true});
  await saveMaster(root, withPdf);
  const pdfPack = path.join(root, 'work/nationwide/sources/pdf-hall'); await fs.mkdir(pdfPack, {recursive: true});
  await fs.writeFile(path.join(pdfPack, 'floor.pdf'), pdfBytes);
  await fs.writeFile(path.join(pdfPack, 'manifest.json'), JSON.stringify({formatVersion: 1, hallId: 'pdf-hall', sources: [{
    sourceId: 'map', sourceType: 'user-supplied', sourceUrl: null, observedAt: now, importedAt: now,
    usageReviewed: true, usageReviewedAt: now, usageNote: 'fixture review', sourceOwner: 'fixture',
    floor: 'slot-floor', category: 'slot', rentalType: '46枚', pages: [2],
    localFiles: [{path: 'floor.pdf', checksum: null}]}]}));
  await sealSourcePack(root, 'pdf-hall', {dryRun: false});
  const pdfProvider = createOpenAIProvider({...providerOpts, transport: async (url, options) => {
    assert(JSON.parse(options.body).input[0].content.some(item => item.type === 'input_file'));
    return response(observation('pdf-hall'));
  }});
  const pdfDry = await processSourcePacks(root, {hallIds: ['pdf-hall'], dryRun: true, provider: pdfProvider});
  assert.equal(pdfDry.results[0].preflight.pageCount, 1);
  const pdfRun = await processSourcePacks(root, {hallIds: ['pdf-hall'], dryRun: false, provider: pdfProvider});
  assert.equal(pdfRun.counts.needs_review, 1);
  console.log('PASS: local image/PDF provider, rights/path/size/page gates, normalized schema, retry/timeout, cache/model, batch and private draft');
} finally {await fs.rm(root, {recursive: true, force: true});}
for (let i = 0; i < publicPaths.length; i++) assert.deepEqual(await fs.readFile(path.join(repo, publicPaths[i])), baseline[i]);
