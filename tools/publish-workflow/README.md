# Layout promotion and publish preparation (Goal 6)

This is a **per-store, explicit** workflow. AI generation and Review Editor output are drafts; neither changes public data. Every command defaults to dry-run. `--execute` is required for a write; publishing and rollback additionally require `--confirm`. No batch discovery or automatic verification/publication exists.

Use the Review Editor's **下書きをダウンロード** button to export a schema v3 JSON after reviewing it. The exported file is the `draftPath` for promotion. An unchanged reviewed layout may be explicitly marked verified in the editor; a human-corrected layout carries `review.humanModified`. Either marker alone is insufficient: the promotion request must also name the reviewer, dates, source review and approval.

Example `promote.json` (a local control file; do not include credentials):

```json
{
  "storeId": "example-hall", "draftPath": "example-hall-review-draft.json",
  "reviewer": "reviewer-name", "reviewedAt": "2026-09-28T10:00:00Z",
  "approvalNote": "Checked machine count, numbers and positions against current evidence",
  "category": "slot", "rentalType": "46枚",
  "sourceSummary": "Store-provided floor map and permitted number list",
  "promoteReason": "Human review completed",
  "sourcePolicyReviewed": true, "manualApprovalChecked": true,
  "acceptWarnings": [], "provider": "mock", "model": "fixture-observation-v1",
  "sourceHashes": ["source-sha256"]
}
```

```text
node tools/promote-layout.mjs --store example-hall --input promote.json
node tools/promote-layout.mjs --store example-hall --input promote.json --execute
node tools/stage-layout-publish.mjs --store example-hall --input stage.json --execute
node tools/publish-layout.mjs --store example-hall --input publish.json
node tools/publish-layout.mjs --store example-hall --input publish.json --execute --confirm
node tools/rollback-layout.mjs --store example-hall --input rollback.json --execute --confirm
```

`stage.json` is `{ "storeId":"example-hall", "layoutVersion":"v0001" }`. `publish.json` also requires `publishedBy`. `rollback.json` requires `rollbackBy`; add `"scope":"promotion"` to undo an unpublished promotion without touching public files. Omit `layoutVersion` only when the latest active candidate is intended; it is safer to specify it. Use `--manifest batch.json` for an array of entries, each with `storeId` and the command's `action`; one store's failure does not stop the others. Relative `draftPath` values are resolved beside the input/manifest file. The command prints a JSON diff and diagnostics on dry-run.

Internal locations are `work/layout-drafts/`, `work/publish-staging/<storeId>/<version>/`, and `work/publish-state/index.json` with per-version backups. These are Git-ignored and contain review metadata, source hashes, version links and events. The public layout remains strict schema v3; workflow metadata is separate. Successful explicit publication writes only the selected store's `data/layouts/<storeId>.json`, its existing positions JSON, and that store's entry in `data/halls.json`. It reuses the existing hall data and shared page; it does not regenerate other pages. A missing page, missing hall/position data, mismatched seat numbers, `noindex` page metadata, hall data still marked `draft-unverified`, unknown numbers, unaccepted warnings, unclear source approval, or multiple floors blocks staging/publication. No `verified` status is inferred from confidence.

Rollback restores the previous layout and positions and the previous listing entry for that store; other stores' listing entries remain as they are. Backup files must be retained. The index is a local operational record, so preserve `work/publish-state/` together with deployment artifacts and commit the intended public changes through the normal Git review/deployment process. A successful local `publish` command prepares files for publication; it does **not** deploy or push them by itself. Review the diff before deployment. Source-use constraints from [Goal 5's policy](../generate-layout/SOURCE-POLICY.md) still apply.
