// Deterministic CI provider. It copies a supplied vision observation; it does
// not claim to recognize pixels or invent seats from an image.
export const mockProvider = {
  id: 'mock', model: 'fixture-v1',
  async generateLayoutFromEvidence(bundle) {
    const observations = bundle.sources.map(source => source.visionOutput).filter(Boolean);
    if (observations.length !== 1) throw Error('Mock provider needs exactly one local visionOutput JSON artifact');
    return structuredClone(observations[0]);
  }
};
