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

## Source Packs and ongoing population (Goal 8)

The source policy above still applies. A Source Pack is one private folder per hall under `work/nationwide/sources/<hallId>/`; it is ignored by Git. `manifest.json` records each source's type, optional provenance URL (never fetched), observation/import dates, owner, rights-review note/date, local filename, and SHA-256 checksum. Keep map images, PDFs, structured machine lists, mock/vision observations and notes in this folder. Add one source entry per local file. A map image/PDF is required for generation. A structured JSON observation can assist the mock provider, but it is not a substitute for the map. Do not put these source files in public `data/layouts/`.

```text
npm run nationwide:source-template -- --hall example-tokyo
npm run nationwide:source-check -- --hall example-tokyo
npm run nationwide:source-seal -- --hall example-tokyo
npm run nationwide:source-seal -- --hall example-tokyo --execute
npm run nationwide:source-status -- --prefecture 東京都 --source-state source_needed
npm run nationwide:process -- --hall example-tokyo
npm run nationwide:process -- --hall example-tokyo --execute
npm run nationwide:process -- --prefecture 東京都 --limit 5 --execute
npm run nationwide:process -- --hall example-tokyo --execute --force
npm run nationwide:review-queue
npm run nationwide:review-import -- --input review.json --execute
npm run nationwide:handoff-candidates
npm run nationwide:dashboard
```

Template creation does not overwrite a manifest. It sets `usageReviewed: false`, with no permission inferred. After a person checks the exact source and its allowed use, they must explicitly fill `usageReviewed: true`, `usageReviewedAt`, `usageNote`, `sourceOwner`, source/floor metadata and local file paths. Run `source-seal --execute` to record the actual checksums; sealing never changes the rights decision. `source-check` reports missing evidence as `source_needed` and invalid/tampered evidence as `blocked`. A mismatch, unreviewed source or missing map prevents AI input. To replace registered evidence, use a new `sourceId` so previous evidence remains traceable.

`process` is read-only by default. With `--execute`, it imports checked packs into private evidence storage and invokes the Goal 5 generator through the Goal 7 pipeline. It continues after a failed hall, records a per-run result in `work/nationwide/population-runs/`, and skips unchanged drafts through the content cache. `--force` requests regeneration; it does not override source, review or public safety gates. Published halls are read-only. The bundled provider is still a **mock** consuming a local `visionOutput` JSON. It does not analyze pixels; real image interpretation requires a separately configured, policy-reviewed provider. No external API key or website access is required in CI.

The review queue shows the draft path and local Review Editor URL. Save the editor's JSON, then submit metadata with the existing `review --input review.json --execute` command. A review with `unresolvedCount > 0` is stored under `work/nationwide/review-in-progress/` and remains `needs_review`; only zero unresolved items, valid layout and explicit verification become `human_verified`. `handoff-candidates` recalculates Source Pack integrity and layout validation and **only lists** eligible halls. It never invokes Goal 6 promote, stage or publish. A separate explicit `handoff` action and Goal 6 review are still required.

The nationwide master currently seeds the 19 existing halls from local public metadata, without changing those public files. Source Packs, drafts, reviews, run logs and status are separated per hall under ignored `work/`; this allows later movement to SQLite/PostgreSQL and object storage without mixing evidence with published layouts or daily performance. Keep this private work directory in backups. Future layout version records can add `layoutVersion`, `effectiveFrom`, `effectiveTo`, `observedAt` and `recordedAt`; no historical period is inferred from the current floor map.

## Real local image/PDF vision provider (Goal 9)

`mock` remains the default and requires no API key. `openai` uses the [OpenAI Responses API image input](https://developers.openai.com/api/docs/guides/images-vision), [local PDF input](https://developers.openai.com/api/docs/guides/file-inputs) and [JSON-schema response format](https://developers.openai.com/api/docs/guides/structured-outputs). It never fetches a source URL. Only files copied from a checked, explicitly usage-reviewed Source Pack into private evidence storage may be sent. Images/PDFs and full API responses are never written to Git or the public site. The canonical observation format is `tools/generate-layout/ai-output.schema.json`; the response is validated locally even if the API returns JSON. The existing schema has optional geometry fields, so the API uses non-strict schema guidance and local validation remains mandatory.

For a PDF with multiple pages, add `"pages": [2]` to its source entry in the Source Pack manifest (1-based numbering). A single-page PDF may omit `pages`. Pages are split locally before the API call; an unselected multi-page PDF is blocked. One source entry is one local PNG, JPEG or PDF; add separate entries for a machine list or another image. Record the actual source usage decision, then run `source-seal --execute` and `source-check` as described above.

Set `OPENAI_API_KEY` in your local environment or secret manager, never in a repository file, manifest, fixture or commit. In PowerShell, `$env:OPENAI_API_KEY = Read-Host 'OPENAI_API_KEY' -MaskInput` prompts without echoing the value. `FLOOR777_VISION_MODEL` sets the model; `--model` overrides it for a command. The default is `gpt-4.1`, which must be available to your API account.

```text
npm run nationwide:process -- --hall example-tokyo --provider openai --dry-run-provider
npm run nationwide:process -- --hall example-tokyo --provider openai --execute
npm run nationwide:process -- --prefecture 東京都 --limit 5 --provider openai --model gpt-4.1 --execute
npm run nationwide:process -- --hall example-tokyo --provider openai --execute --force
```

The first command performs local Source Pack and input-size/page checks **without** an API call or API key. `--execute` is required to send evidence; each selected hall is processed separately so one failure does not stop the batch. `--force` bypasses the content cache, but never bypasses usage review or other safety checks. Cost controls are `--max-files` (default 4), `--max-image-bytes` (8 MiB), `--max-pdf-pages` (3), `--timeout-ms` (90000), and `--max-retries` (1, at most 2). Total input is capped at 20 MiB. PDF and images consume visual input tokens, so inspect dry-run file/page totals before execution. The cache key includes provider, model, generator version and source content; changing the model or evidence creates a new private draft.

AI coordinates are normalized 0–1; draft conversion uses fixed logical units for the Review Editor, independent of source pixels. Illegible numbers remain `null`; low-resolution images, unrecognized island structure, contradictory seat lists, schema errors and multi-floor outputs are flagged or blocked. A multi-floor observation is retained as a private blocked draft for review and cannot reach Goal 6. Confidence never verifies or publishes a hall. Inspect `nationwide:review-queue`, start `npm run review:open`, import the draft path shown there, fix the layout and export the reviewed JSON. The normal human review and Goal 6 approval steps remain separate.

`npm run test:vision-provider` uses an injected fake transport and does not require a key. An optional real API smoke test is `npm run test:vision-smoke -- --hall example-tokyo --confirm-api-cost`; it requires a valid local Source Pack and key, may incur cost, and writes only a private draft. It is deliberately excluded from standard tests and CI.
