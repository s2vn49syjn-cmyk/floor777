# Layout baselines

`layout-golden.json` locks the current legacy seat counts, complete sorted
number sets and exact `[number, [x, y, width, height]]` coordinates. The
fingerprints are SHA-256 hashes of `JSON.stringify` of those ordered values.
`tests/layout-v3.mjs` checks the baseline after the read-only adapter runs.

`golden` contains layouts whose seat counts, complete number sets,
seat-to-position mapping and island placement were confirmed by the user
against current reference materials on 2026-09-28. `candidates` are regression
baselines awaiting that confirmation. The three current golden layouts are
HYPER ARROW Mihara, SUPER COSMO Sakai and Kikuya Sakai Honten. The Cosmo
fingerprint includes the already-published 1011/1101 and 819/918 corrections.
Their island placements are human-confirmed, but the legacy public JSON has no
island boundaries to snapshot, so `islandStructure` remains `null`.

After confirmation, move a store from `candidates` to `golden`, record the
evidence and capture its island structure if available. A layout change should
update the fingerprint only after the source and intended change are reviewed.
