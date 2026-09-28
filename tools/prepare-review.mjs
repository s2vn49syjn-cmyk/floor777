import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {loadMaster, hallIdPattern} from './nationwide/master.mjs';
import {materializePlaceholders} from './generate-layout/placeholders.mjs';
import {validateLayout} from './layout-validator.mjs';
import {processSourcePacks} from './nationwide/populate.mjs';
import {createOpenAIProvider} from './generate-layout/providers/openai.mjs';

export async function prepareReview(root, hallIds) {
  const master = await loadMaster(root), results = [];
  for (const hallId of hallIds) {
    try {
      if (!hallIdPattern.test(hallId)) throw Error('Invalid hall ID');
      const record = master.stores[hallId];
      if (!record) throw Error('Unknown hall');
      if (record.published || !['generated', 'validated', 'needs_review', 'blocked'].includes(record.layoutProgress))
        throw Error('Only unverified, unpublished generated drafts may be prepared');
      if (record.review) throw Error('Human review already exists; continue the existing review');
      if (!record.generation?.layoutPath || !['generated', 'needs_review'].includes(record.generation.status))
        throw Error('No usable cached AI draft; run with --generate to process the Source Pack');
      const source = JSON.parse(await fs.readFile(record.generation.layoutPath, 'utf8'));
      if (source.storeId !== hallId || source.schemaVersion !== 3 || source.generation?.source !== 'ai')
        throw Error('Cached draft identity or schema mismatch');
      const {layout, generated, skipped} = materializePlaceholders(source);
      const validation = validateLayout(layout);
      const revision = createHash('sha256').update(JSON.stringify(layout)).digest('hex').slice(0, 16);
      const draft = `${hallId}-${revision}`, directory = path.join(root, 'work/review-drafts');
      await fs.mkdir(directory, {recursive: true});
      const layoutPath = path.join(directory, `${draft}.json`);
      await fs.writeFile(layoutPath, `${JSON.stringify(layout, null, 2)}\n`, {flag: 'wx'}).catch(error => {
        if (error.code !== 'EEXIST') throw error;
      });
      const remainingBlockers = (record.validation?.blockedReasons ?? []).filter(reason =>
        reason !== 'machine_count_mismatch' || validation.diagnostics.some(d => d.code === reason));
      const report = {hallId, status: !validation.valid || remainingBlockers.length ? 'blocked' : 'needs_review', layoutPath, generated, skipped, validation, remainingBlockers,
        reviewPath: `/tools/layout-review.html?store=${hallId}&draft=${draft}`,
        sourceLayoutPath: record.generation.layoutPath, apiCalls: 0, humanVerificationRequired: true};
      await fs.writeFile(path.join(directory, `${draft}.report.json`), `${JSON.stringify(report, null, 2)}\n`);
      results.push(report);
    } catch (error) {results.push({hallId, status: 'failed', reason: error.message});}
  }
  return results;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2), index = args.indexOf('--hall');
    const hallIds = index >= 0 ? args[index + 1]?.split(',') : null;
    if (!hallIds?.length || hallIds.some(id => !hallIdPattern.test(id))) throw Error('--hall ID[,ID] is required');
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    if (args.includes('--generate')) {
      if (!args.includes('--confirm-api-cost')) throw Error('OpenAI API charges may apply. Add --confirm-api-cost to authorize generation. Without --generate, cached drafts are used offline.');
      console.error('OpenAI vision: API charges may apply; unchanged drafts will be reused. Publishing is not performed.');
      const provider = createOpenAIProvider({root, maxRetries: 0});
      const generation = await processSourcePacks(root, {hallIds, dryRun: false, provider});
      const failed = generation.results.filter(r => !['validated', 'needs_review', 'skipped'].includes(r.status));
      console.log(JSON.stringify({generation}, null, 2));
      // Do not silently fall back to an older draft after a failed generation.
      hallIds.splice(0, hallIds.length, ...hallIds.filter(id => !failed.some(r => r.hallId === id)));
      if (failed.length) process.exitCode = 1;
    }
    const results = await prepareReview(root, hallIds);
    console.log(JSON.stringify({results}, null, 2));
    if (results.some(r => ['failed', 'blocked'].includes(r.status))) process.exitCode = 1;
  } catch (error) {console.error(error.message); process.exitCode = 1;}
}
