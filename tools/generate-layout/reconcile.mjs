const uniqueSorted = values => [...new Set(values)].sort((a, b) => a - b);

export function reconcileEvidence(bundle, observation) {
  const issues = [], blockers = [], floors = new Map();
  const mapSources = bundle.sources.filter(source => ['png', 'jpeg', 'pdf'].includes(source.format));
  if (!mapSources.length) blockers.push('元フロアマップ画像/PDFがありません');
  const dates = bundle.sources.map(source => Date.parse(source.observedAt));
  const daysApart = (Math.max(...dates) - Math.min(...dates)) / 86400000;
  if (daysApart > 90) blockers.push(`資料の日付差が大きい (${Math.round(daysApart)}日)`);
  else if (daysApart > 30) issues.push(`資料の日付差があります (${Math.round(daysApart)}日)`);
  for (const source of mapSources) if (source.structuredFacts.imageQuality !== null && source.structuredFacts.imageQuality < 0.3) {
    blockers.push(`画像品質が低すぎます: ${source.sourceId}`);
  }
  for (const floor of observation.floors) {
    const related = bundle.sources.filter(source => source.floor === floor.id);
    if (!related.length || !related.some(source => ['png', 'jpeg', 'pdf'].includes(source.format))) {
      blockers.push(`${floor.id}: 対象フロアの画像/PDFがありません`);
    }
    if (related.some(source => source.category !== floor.category || source.rentalType !== floor.rentalType)) {
      blockers.push(`${floor.id}: パチンコ/スロット区分または貸出区分が食い違います`);
    }
    const rosters = related.map(source => source.structuredFacts.seats).filter(seats => seats.length);
    const reference = rosters[0] ?? [];
    const referenceNumbers = uniqueSorted(reference.map(seat => seat.number));
    for (const seats of rosters.slice(1)) if (JSON.stringify(uniqueSorted(seats.map(seat => seat.number))) !== JSON.stringify(referenceNumbers)) {
      issues.push(`${floor.id}: 構造化資料同士の台番号集合が異なります`);
    }
    const counts = related.map(source => source.structuredFacts.expectedCount).filter(count => count !== null);
    const expectedCount = referenceNumbers.length || counts[0] || null;
    if (counts.some(count => expectedCount !== null && count !== expectedCount)) issues.push(`${floor.id}: 構造化資料同士の台数が異なります`);
    const slotCount = floor.islands.reduce((sum, island) => sum + island.machineSlots.length, 0);
    const statedCount = floor.islands.reduce((sum, island) => sum + island.estimatedMachineCount, 0);
    if (statedCount !== slotCount) issues.push(`${floor.id}: 推定台数 ${statedCount} と台枠 ${slotCount} が一致しません`);
    if (expectedCount !== null && expectedCount !== slotCount) {
      const text = `${floor.id}: 参照台数 ${expectedCount} と画像台枠 ${slotCount} が一致しません`;
      (Math.abs(expectedCount - slotCount) / Math.max(expectedCount, 1) > 0.2 ? blockers : issues).push(text);
    }
    const visible = floor.islands.flatMap(island => island.machineSlots.map(slot => slot.visibleNumber)).filter(number => number !== null);
    const visibleSet = new Set(visible), referenceSet = new Set(referenceNumbers);
    if (visibleSet.size !== visible.length) issues.push(`${floor.id}: 画像で読めた台番号に重複があります`);
    if (referenceNumbers.length && visible.some(number => !referenceSet.has(number))) issues.push(`${floor.id}: 画像の台番号と構造化資料が一致しません`);
    if (referenceNumbers.length && visible.length < slotCount) issues.push(`${floor.id}: 読めない台番号は未確定のまま残します`);
    if (!referenceNumbers.length) issues.push(`${floor.id}: 参照台番号一覧がありません`);
    for (const island of floor.islands) for (const note of island.uncertainty) issues.push(`${floor.id}/${island.id}: ${note}`);
    const roster = new Map(reference.map(seat => [seat.number, seat.machineName]));
    floors.set(floor.id, {roster, referenceNumbers, expectedCount, slotCount, visible, related});
  }
  for (const source of mapSources) if (!observation.floors.some(floor => floor.id === source.floor)) {
    blockers.push(`${source.floor}: 画像の対象フロアがAI出力にありません`);
  }
  return {floors, issues, blockers, daysApart};
}
