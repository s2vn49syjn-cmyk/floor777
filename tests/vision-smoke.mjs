// Explicit opt-in only. Never listed in npm test or GitHub Actions.
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createOpenAIProvider} from '../tools/generate-layout/providers/openai.mjs';
import {processSourcePacks} from '../tools/nationwide/populate.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const index = process.argv.indexOf('--hall'), hallId = index < 0 ? null : process.argv[index + 1];
if (!hallId || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(hallId) || !process.argv.includes('--confirm-api-cost')) {
  throw Error('Explicit --hall ID and --confirm-api-cost are required');
}
if (!process.env.OPENAI_API_KEY) throw Error('OPENAI_API_KEY is not set');
const provider = createOpenAIProvider({root, model: process.env.FLOOR777_VISION_MODEL || 'gpt-4.1'});
const result = await processSourcePacks(root, {hallIds: [hallId], dryRun: false, provider});
console.log(JSON.stringify(result, null, 2));
