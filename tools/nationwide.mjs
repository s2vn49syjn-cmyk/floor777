import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadMaster, saveMaster, registerHall, masterPath} from './nationwide/master.mjs';
import {registerSource, reviewSourceUsage} from './nationwide/evidence.mjs';
import {generateNationwide, importHumanReview, prepareGoal6Handoff} from './nationwide/pipeline.mjs';
import {queueRows, progressStats} from './nationwide/queue.mjs';
import {createSourceTemplate, inspectSourcePack, sealSourcePack} from './nationwide/source-pack.mjs';
import {processSourcePacks, sourcePackStatuses} from './nationwide/populate.mjs';
import {populationDashboard, reviewQueue, handoffCandidates} from './nationwide/report.mjs';
import {createOpenAIProvider} from './generate-layout/providers/openai.mjs';
import {autoPopulateAll} from './nationwide/auto.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), command = args[0];
const flag = name => args.includes(`--${name}`);
const value = name => {const index = args.indexOf(`--${name}`); return index < 0 ? null : args[index + 1];};
const inputFile = value('input');
const input = inputFile ? JSON.parse(await fs.readFile(path.resolve(inputFile), 'utf8')) : null;
const execute = flag('execute');
if (flag('dry-run-provider') && execute) throw Error('--dry-run-provider cannot be combined with --execute');
const providerName = value('provider') ?? 'mock';
if (providerName === 'openai' && execute && ['process', 'generate', 'auto'].includes(command) && !flag('confirm-api-cost'))
  throw Error('OpenAI API charges may apply: explicit --confirm-api-cost is required');
if (!['mock', 'openai'].includes(providerName)) throw Error('Supported providers: mock, openai');
const numeric = (flagName, fallback) => value(flagName) === null ? fallback : Number(value(flagName));
const selectedProvider = providerName === 'openai' ? createOpenAIProvider({root, model: value('model') ?? undefined,
  maxFiles: numeric('max-files', 4), maxImageBytes: numeric('max-image-bytes', 8 * 1024 * 1024),
  maxPdfPages: numeric('max-pdf-pages', 3), timeoutMs: numeric('timeout-ms', 90_000),
  maxRetries: numeric('max-retries', 1)}) : undefined;
let result;
try {
  if (command === 'init') {
    const master = await loadMaster(root);
    if (execute) await saveMaster(root, master);
    result = {status: execute ? 'initialized' : 'dry_run', storeCount: Object.keys(master.stores).length, path: masterPath(root)};
  } else if (command === 'register') {
    if (!input) throw Error('--input store.json is required');
    const master = await loadMaster(root);
    const record = registerHall(master, input);
    if (execute) await saveMaster(root, master);
    result = {status: execute ? 'registered' : 'dry_run', record};
  } else if (command === 'source') {
    if (!input || !value('store')) throw Error('--store ID and --input source.json are required');
    const master = await loadMaster(root), record = master.stores[value('store')];
    if (!record) throw Error('Unknown store');
    result = await registerSource(root, record, input, {baseDir: path.dirname(path.resolve(inputFile)), dryRun: !execute});
    if (execute) await saveMaster(root, master);
  } else if (command === 'review-source') {
    if (!input || !value('store')) throw Error('--store ID and --input usage-review.json are required');
    const master = await loadMaster(root), record = master.stores[value('store')];
    if (!record) throw Error('Unknown store');
    const draft = structuredClone(record);
    result = reviewSourceUsage(execute ? record : draft, input);
    if (execute) await saveMaster(root, master);
  } else if (command === 'generate') {
    result = await generateNationwide(root, {storeIds: value('store')?.split(',') ?? null,
      prefecture: value('prefecture'), limit: value('limit') ? Number(value('limit')) : Infinity,
      dryRun: !execute, force: flag('force'), ...(selectedProvider ? {provider: selectedProvider} : {})});
  } else if (command === 'source-template') {
    const hallId = value('hall') ?? value('store');
    if (!hallId || !(await loadMaster(root)).stores[hallId]) throw Error('Registered --hall is required');
    result = await createSourceTemplate(root, hallId, {dryRun: flag('dry-run')});
  } else if (command === 'source-check') {
    const hallId = value('hall') ?? value('store');
    if (!hallId || !(await loadMaster(root)).stores[hallId]) throw Error('Registered --hall is required');
    result = await inspectSourcePack(root, hallId);
    result = {hallId, status: result.status, reasons: result.reasons,
      sources: result.sources.map(item => ({sourceId: item.source.sourceId, format: item.format, checksum: item.checksum}))};
  } else if (command === 'source-seal') {
    const hallId = value('hall') ?? value('store');
    if (!hallId || !(await loadMaster(root)).stores[hallId]) throw Error('Registered --hall is required');
    result = await sealSourcePack(root, hallId, {dryRun: !execute});
  } else if (command === 'source-status') {
    result = await sourcePackStatuses(root, {prefecture: value('prefecture'), layoutStatus: value('status'),
      sourceStatus: value('source-state'), hallIds: (value('hall') ?? value('store'))?.split(',') ?? null,
      limit: value('limit') ? Number(value('limit')) : Infinity});
  } else if (command === 'process') {
    result = await processSourcePacks(root, {hallIds: (value('hall') ?? value('store'))?.split(',') ?? null,
      prefecture: value('prefecture'), limit: value('limit') ? Number(value('limit')) : Infinity,
      dryRun: !execute, force: flag('force'), provider: selectedProvider});
  } else if (command === 'auto') {
    result = await autoPopulateAll(root, {hallIds: (value('hall') ?? value('store'))?.split(',') ?? null,
      prefecture: value('prefecture'), limit: value('limit') ? Number(value('limit')) : Infinity,
      dryRun: !execute, force: flag('force'), provider: selectedProvider, prepare: !flag('no-prepare')});
  } else if (command === 'review-queue') {
    result = await reviewQueue(root, {prefecture: value('prefecture')});
  } else if (command === 'handoff-candidates') {
    result = await handoffCandidates(root, {prefecture: value('prefecture')});
  } else if (command === 'dashboard') {
    result = await populationDashboard(root);
  } else if (command === 'queue') {
    const master = await loadMaster(root);
    result = {rows: queueRows(master, {state: value('state'), prefecture: value('prefecture'),
      ungenerated: flag('ungenerated'), hallIds: value('store')?.split(',') ?? null,
      limit: value('limit') ? Number(value('limit')) : Infinity}), stats: progressStats(master)};
  } else if (command === 'stats') {
    result = progressStats(await loadMaster(root));
  } else if (command === 'review' || command === 'handoff') {
    if (!execute || !input) throw Error(`--input operation.json and --execute are required for ${command}`);
    result = command === 'review' ? await importHumanReview(root, {...input, reviewedPath: path.resolve(path.dirname(path.resolve(inputFile)), input.reviewedPath)}) :
      await prepareGoal6Handoff(root, input);
  } else {
    throw Error('Usage: node tools/nationwide.mjs init|register|source|review-source|source-template|source-check|source-seal|source-status|process|auto|review-queue|handoff-candidates|dashboard|generate|queue|stats|review|handoff [--input FILE] [--hall ID] [--prefecture NAME] [--provider mock|openai] [--model MODEL] [--max-files N] [--max-image-bytes N] [--max-pdf-pages N] [--timeout-ms N] [--max-retries 0..2] [--dry-run-provider] [--force] [--execute]');
  }
  console.log(JSON.stringify(result, null, 2));
} catch (error) {console.error(error.message); process.exitCode = 1;}
