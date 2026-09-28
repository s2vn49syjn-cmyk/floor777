# Local layout draft generation (Goal 5)

This pipeline creates **review drafts only**. It never downloads third-party pages, writes `data/layouts/`, changes a hall listing, or publishes a layout. Read [SOURCE-POLICY.md](./SOURCE-POLICY.md) before supplying third-party material.

Input is a local batch manifest. Paths are relative to the manifest file:

```json
{
  "stores": [{
    "storeId": "example-hall",
    "storeName": "Example Hall",
    "sources": [
      {"sourceId":"map","sourceType":"store-official","sourceUrl":"https://example.org/map","observedAt":"2026-09-28","retrievedAt":"2026-09-28","floor":"slot-floor","category":"slot","rentalType":"46枚","localArtifactPath":"floor.png","structuredFacts":{"imageQuality":0.9}},
      {"sourceId":"seats","sourceType":"user-supplied-structured","sourceUrl":null,"observedAt":"2026-09-28","retrievedAt":"2026-09-28","floor":"slot-floor","category":"slot","rentalType":"46枚","localArtifactPath":"seats.json"},
      {"sourceId":"observation","sourceType":"manual-observation","sourceUrl":null,"observedAt":"2026-09-28","retrievedAt":"2026-09-28","floor":"slot-floor","category":"slot","rentalType":"46枚","localArtifactPath":"vision.json"}
    ]
  }]
}
```

`seats.json` is `{ "seats": [{"number":101,"machineName":"機種名"}], "expectedCount":1 }`. Legally extracted HTML facts must first be saved as this structured JSON; raw HTML is not fetched or parsed. `vision.json` is `{ "visionOutput": <AI-output-schema observation> }`; its `sourceIds` must refer to source IDs in the manifest. Unknown numbers are `null`, never assigned by sequence. See `ai-output.schema.json` for the exact observation shape.

Run `node tools/generate-layout/index.mjs path/to/batch-manifest.json`. Results are per-store `generated`, `needs_review`, `blocked`, `insufficient_evidence`, or `failed`. A failure in one store does not stop the batch. The output JSON and audit sidecar are stored under ignored `work/layout-drafts/<storeId>/`; the content hash, provider/model, and generator version identify each cache entry. Change any input or the generator version to invalidate the cache. Open a successful JSON draft with the Review Editor's **JSONを読み込む** control, correct flagged items, and save the editor's working draft. There is no automatic promote or publication.

The default `mockProvider` reads a prewritten observation from local JSON to exercise the pipeline without an API key; it does not recognize pixels. The optional `openai` vision provider reads only explicitly usage-reviewed, local Source Pack evidence through the nationwide CLI. See [the nationwide operating guide](../nationwide/README.md#real-local-imagepdf-vision-provider-goal-9) for configuration, cost limits and safe operation. `generateStore` and `generateBatch` still accept any provider object with `id`, `model`, and `generateLayoutFromEvidence(bundle)`. ChatGPT Plus/login credentials are not API credentials. Raw source images and local paths stay in the internal Evidence Bundle, not in the layout JSON.

Run `node tests/ai-layout.mjs` and `node tests/ai-layout-browser.cjs` (the latter needs the repository's Playwright dependency). The Golden evaluator is `evaluateAgainstGolden(candidate, storeId)` in `golden-evaluator.mjs`; current Golden fixtures contain seat-number/position truth but no encoded island boundaries, so island geometry cannot yet be scored against them. All three public Golden records remain untouched.
