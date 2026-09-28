# Layout Review Editor

Run `node tools/start-review-editor.mjs` from the repository root, then open
`http://127.0.0.1:8781/tools/layout-review.html`. This development-only server
binds to loopback. The editor is not linked from public hall pages.

Enter a store ID to open a schema v3 layout from `data/layouts/`. The 16 migrated
layouts are listed as suggestions and remain `needs_review`. A legacy hall can
also be opened through the read-only adapter. Import a schema v3 JSON file to
review a future generated draft.

Edits save to this browser's IndexedDB as a working draft. The original layout
and published JSON are not changed. The status indicator shows saving, saved,
or failed. Use **下書きをダウンロード** to export the working JSON for a later
review or publication process. **元データに戻す** removes the local draft. The
validator runs after every edit; select a diagnostic to focus its island or
machine. **確認済みにする** is an explicit human action and never publishes data.

Run `node tests/review-model.mjs` and `node tests/review-browser.cjs` for the
model and browser checks. The browser test requires Playwright and Chromium.
