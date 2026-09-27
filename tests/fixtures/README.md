# Layout baselines

`layout-golden.json` locks the current legacy seat counts, complete sorted
number sets and exact `[number, [x, y, width, height]]` coordinates. The
fingerprints are SHA-256 hashes of `JSON.stringify` of those ordered values.
`tests/layout-v3.mjs` checks the baseline after the read-only adapter runs.

`golden` is reserved for layouts whose seat-to-position correspondence has
documented human confirmation. `candidates` are regression baselines only;
they prevent accidental code changes but **do not assert physical accuracy**.
The three published stores remain candidates because publication, matching
number sets and browser checks do not establish that every seat is at the
correct physical position. Kikuya's project notes also say on-site comparison
has not been done. The physical checks needed for each store are recorded in
the manifest. Island structures are `null` until independently confirmed;
the legacy files do not contain island boundaries.

After confirmation, move a store from `candidates` to `golden`, record the
evidence and capture its island structure if available. A layout change should
update the fingerprint only after the source and intended change are reviewed.
