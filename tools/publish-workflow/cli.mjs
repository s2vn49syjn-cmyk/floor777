import fs from 'node:fs/promises';
import path from 'node:path';
import {runPromotionAction, runPromotionBatch} from './index.mjs';

export async function main(action, args = process.argv.slice(2)) {
  const flag = name => args.includes(`--${name}`);
  const value = name => {const i = args.indexOf(`--${name}`); return i < 0 ? null : args[i + 1];};
  if (flag('help')) {
    console.log(`Usage: node tools/${action === 'promote' ? 'promote-layout' : action === 'stage' ? 'stage-layout-publish' : action === 'publish' ? 'publish-layout' : 'rollback-layout'}.mjs --store ID --input operation.json [--execute] [--confirm]\n` +
      'Or use --manifest batch.json. Dry-run is the default; --execute writes files. Publish/rollback also require --confirm.');
    return;
  }
  const inputFile = value('input'), manifestFile = value('manifest');
  if (!!inputFile === !!manifestFile) throw Error('Specify exactly one --input or --manifest');
  const file = path.resolve(inputFile ?? manifestFile);
  const json = JSON.parse(await fs.readFile(file, 'utf8'));
  const options = {dryRun: !flag('execute'), confirm: flag('confirm')};
  let result;
  if (manifestFile) {
    if (!Array.isArray(json) || json.some(entry => entry.action !== action || !entry.storeId)) throw Error('Each batch entry needs this action and an explicit storeId');
    result = await runPromotionBatch(json.map(entry => ({...entry,
      ...(entry.draftPath ? {draftPath: path.resolve(path.dirname(file), entry.draftPath)} : {})})), options);
  } else {
    const id = value('store');
    if (!id || json.storeId !== id) throw Error('--store must match input storeId');
    result = await runPromotionAction(action, {...json,
      ...(json.draftPath ? {draftPath: path.resolve(path.dirname(file), json.draftPath)} : {})}, options);
  }
  console.log(JSON.stringify(result, null, 2));
  if (result.status === 'blocked' || result.status === 'failed' || result.counts?.blocked || result.counts?.failed) process.exitCode = 1;
}
