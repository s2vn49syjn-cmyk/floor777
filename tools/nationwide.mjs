import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadMaster, saveMaster, registerHall, masterPath} from './nationwide/master.mjs';
import {registerSource, reviewSourceUsage} from './nationwide/evidence.mjs';
import {generateNationwide, importHumanReview, prepareGoal6Handoff} from './nationwide/pipeline.mjs';
import {queueRows, progressStats} from './nationwide/queue.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), command = args[0];
const flag = name => args.includes(`--${name}`);
const value = name => {const index = args.indexOf(`--${name}`); return index < 0 ? null : args[index + 1];};
const inputFile = value('input');
const input = inputFile ? JSON.parse(await fs.readFile(path.resolve(inputFile), 'utf8')) : null;
const execute = flag('execute');
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
      dryRun: !execute, force: flag('force')});
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
    throw Error('Usage: node tools/nationwide.mjs init|register|source|review-source|generate|queue|stats|review|handoff [--input FILE] [--store ID] [--prefecture NAME] [--state STATE] [--limit N] [--ungenerated] [--force] [--execute]');
  }
  console.log(JSON.stringify(result, null, 2));
} catch (error) {console.error(error.message); process.exitCode = 1;}
