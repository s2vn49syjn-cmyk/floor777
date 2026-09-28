# Review draft preparation

Reuse a saved AI draft without calling any API:

```sh
npm run review:prepare -- --hall super-cosmo-sakai-smoke
```

Process reviewed/sealed Source Packs through OpenAI, automatic validation and draft preparation in one command (API charges may apply; explicit opt-in required):

```sh
npm run review:prepare -- --hall store-one,store-two --generate --confirm-api-cost
```

Stores must already be registered and Source Packs must pass the existing source policy checks. Unchanged generation caches are reused; retries are disabled. Failures are reported per store and produce a nonzero exit code. Failed generation never silently falls back to an old draft. Use the existing source-check/provider dry-run commands to inspect inputs first.

Start or restart `npm run review:open`, then open the returned `reviewPath` under `http://127.0.0.1:8781`. Files live only under `work/review-drafts`; public data is not modified. The CLI verifies registered evidence checksums, rights, and generation source hashes, reruns rollout validation, and registers the prepared path in the private review queue. Recoverable count blockers can return to needs_review; unresolved source/schema blockers remain blocked. Original AI output and audit are preserved. Each content revision has a separate browser draft key, preserving earlier manual edits. Re-running identical preparation restores the same draft. Modified immutable draft files are rejected. Reports include automatic diagnostics and skipped unsafe islands.

The library function `prepareReview(root, hallIds)` only exports files by default; use `{register: true}` for the checked queue update used by the CLI. Neither mode claims visual correspondence. A clean validator report does not establish that estimated counts, missing islands, curves, or rental sections match the source image.

Empty islands with valid in-floor bounding boxes and 1–1000 estimated machines receive evenly spaced, non-overlapping provisional square frames. These are review aids: curves, rotation, row arrangement and actual seat positions still need human review. Missing/unsafe bounds or sub-unit frames remain unresolved. Partial or existing machine lists and human-corrected layouts are preserved. Numbers and names on generated frames stay null, with null confidence. Observed numbers are unchanged; roster numbers are never assigned to inferred slots.

The converter also performs this step for new AI output before validation. Existing reconciliation blockers remain in force. Draft preparation never verifies a layout, imports a human review, promotes, publishes, or merges. Human verification and explicit Goal 6 approvals remain required.
