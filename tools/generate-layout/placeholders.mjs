// Conservative review aids inside the observed bounding box, not detected seats.
export function materializePlaceholders(input) {
  const layout = structuredClone(input), generated = [], skipped = [];
  if (layout.generation?.source !== 'ai' || layout.review?.humanModified ||
      ['verified', 'human_corrected'].includes(layout.verification?.status)) return {layout, generated, skipped};
  const ids = new Set(layout.floors.flatMap(f => [...f.unassignedMachines, ...f.islands.flatMap(i => i.machines)]).map(m => m.id));
  for (const floor of layout.floors) for (const island of floor.islands) {
    if (island.machines.length || !island.machineCount) continue;
    const g = island.geometry, count = island.machineCount;
    if (!Number.isInteger(count) || count < 1 || count > 1000 || !g ||
        ![g.x, g.y, g.width, g.height, floor.width, floor.height].every(Number.isFinite) ||
        g.width <= 0 || g.height <= 0 || g.x < 0 || g.y < 0 ||
        g.x + g.width > floor.width || g.y + g.height > floor.height) {
      skipped.push({floorId: floor.id, islandId: island.id, reason: 'unsafe_or_missing_bounds'}); continue;
    }
    const horizontal = g.width >= g.height;
    const pitch = (horizontal ? g.width : g.height) / count;
    const size = Math.min(28, pitch * 0.8, (horizontal ? g.height : g.width) * 0.8);
    if (size < 1) {skipped.push({floorId: floor.id, islandId: island.id, reason: 'frames_too_small'}); continue;}
    island.machines = Array.from({length: count}, (_, index) => {
      let id = `${floor.id}:${island.id}:provisional-${index + 1}`;
      while (ids.has(id)) id += '-p';
      ids.add(id);
      const x = horizontal ? g.x + pitch * (index + 0.5) : g.x + g.width / 2;
      const y = horizontal ? g.y + g.height / 2 : g.y + pitch * (index + 0.5);
      return {id, number: null, machineName: null, position: [x - size / 2, y - size / 2, size, size], confidence: null};
    });
    generated.push({floorId: floor.id, islandId: island.id, count});
    layout.verification.notes.push(`${floor.id}/${island.id}: 推定台数と島の外接枠から仮配置。曲線・回転・実位置は未確認、台番号は未確定です。`);
  }
  if (generated.length) {
    layout.verification.status = 'needs_review';
    layout.verification.lastVerifiedAt = null;
  }
  return {layout, generated, skipped};
}
