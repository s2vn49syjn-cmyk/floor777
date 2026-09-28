import {validateAIOutput} from './validate-ai-output.mjs';

export async function generateObservation(bundle, provider) {
  if (!provider || typeof provider.id !== 'string' || typeof provider.model !== 'string' ||
    typeof provider.generateLayoutFromEvidence !== 'function') throw Error('Invalid provider interface');
  const observation = await provider.generateLayoutFromEvidence(bundle);
  const report = validateAIOutput(observation);
  if (!report.valid) throw Error(`AI output schema invalid: ${report.errors.slice(0, 8).join('; ')}`);
  if (observation.storeId !== bundle.storeId) throw Error('AI output storeId differs from evidence');
  const sourceIds = new Set(bundle.sources.map(source => source.sourceId));
  for (const floor of observation.floors) for (const island of floor.islands) {
    if (island.sourceIds.some(id => !sourceIds.has(id))) throw Error(`AI output source reference is unknown: ${island.id}`);
  }
  return observation;
}
