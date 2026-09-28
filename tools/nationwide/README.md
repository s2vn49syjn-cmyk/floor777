# Nationwide layout work queue (Goal 7)

This is an **internal, local-only** production line. It does not crawl sites or publish stores. Read [the source policy](../generate-layout/SOURCE-POLICY.md) before importing a file. Store records, source images/PDFs, generated drafts, reviews, and handoff requests live under ignored `work/`; keep that directory in operational backups. Public layout JSON, pages, `data/halls.json`, and daily performance data are never written by these commands.

`node tools/nationwide.mjs stats` or `queue` reads the 19 existing stores without modifying them. `init --execute` saves that seed as `work/nationwide/master.json` (3 published, 16 existing review drafts). Further stores are registered through a JSON input and a dry-run first:

```text
node tools/nationwide.mjs register --input store.json
node tools/nationwide.mjs register --input store.json --execute
```

`store.json`: `{ "hallId":"example-tokyo", "name":"Example", "prefecture":"東京都", "municipality":"千代田区", "address":null, "slotSupported":true }`. IDs must be lowercase ASCII letters/digits with hyphens. Duplicate IDs or matching store identity are rejected.

Source registration only accepts an existing local PNG, JPEG, PDF, or structured JSON file. Its `localFile` is relative to the source input JSON. Registration copies it into internal evidence storage, hashes it and records provenance. A URL is metadata; it is never fetched.

```json
{
  "sourceId":"floor-map", "sourceType":"store-official", "sourceUrl":"https://example.org/map",
  "observedAt":"2026-09-28", "importedAt":"2026-09-28", "floor":"slot-floor",
  "category":"slot", "rentalType":"46枚", "usageReviewed":true,
  "usageNote":"Permission and use checked by operator", "localFile":"floor.png"
}
```

```text
node tools/nationwide.mjs source --store example-tokyo --input floor-source.json --execute
node tools/nationwide.mjs review-source --store example-tokyo --input usage-review.json --execute
node tools/nationwide.mjs generate --store example-tokyo --execute
node tools/nationwide.mjs generate --prefecture 東京都 --limit 100 --execute
node tools/nationwide.mjs generate --store example-tokyo --execute --force
node tools/nationwide.mjs queue --state needs_review --prefecture 東京都
node tools/nationwide.mjs queue --ungenerated
node tools/nationwide.mjs stats
```

`generate` without `--execute` is a read-only plan. Actual runs continue after one store fails, log results under `work/nationwide/runs/`, and use Goal 5's input hash/version cache. Repeating an unchanged run skips its existing draft; `--force` explicitly regenerates. The included provider is Goal 5's **mock**, which consumes a local `visionOutput` JSON; it does **not** read pixels. A future real provider must meet the same interface and source-use policy. Missing evidence, unreviewed usage, unresolved numbers, large differences, and multiple floors do not become verified or published because of a confidence score.

Queue rows show source/usage readiness, generation, validator result, number-set match, unresolved count, review state, draft path, and the local Review Editor URL. Start the editor with `node tools/start-review-editor.mjs`, import the draft JSON using its file control, correct it, run validation, explicitly mark verified, and download the reviewed JSON. The queue does not expose the editor to public users.

Human review import requires an input such as `{ "hallId":"example-tokyo", "reviewedPath":"review-export.json", "reviewedBy":"name", "reviewedAt":"2026-09-28T10:00:00Z", "reviewNotes":"Checked all seats", "unresolvedCount":0 }`:

```text
node tools/nationwide.mjs review --input review.json --execute
node tools/nationwide.mjs handoff --input approval.json --execute
```

`approval.json` contains `hallId`, `approvedBy`, `approvalNote`, and `promoteReason`. Handoff revalidates the reviewed file and writes a **Goal 6 promotion request only** to `work/nationwide/goal6-requests/`. It never runs promote, stage, publish, or deploy. A separate, explicit Goal 6 dry-run and approval is still required. The current public UI is single-floor slot-only; multi-floor layouts are preserved in the draft but blocked from handoff. Layout versions and daily performance data remain separate.
