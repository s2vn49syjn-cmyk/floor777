# FLOOR777

パチンコ・スロット店の島図から、機種名・台番号で台の位置を探せる静的Webサイトです。

## 現在の掲載
- HYPER ARROW美原店
- 551台
- 島図座標: 2026-09-18版
- 機種名/台番号: SLOTDASH公開データが取れる場合は最新営業日に自動更新、取得できない場合は静的スナップショットへフォールバック

## 主な機能
- 機種名検索 / 台番号検索
- 検索台ハイライト
- ドラッグ / 拡大縮小
- 島図180°向き切替
- 機種名ラベルON/OFF
- 台タップで最新差枚 / G数 / 3日 / 7日 / 直近7日履歴
- お気に入り / 最近見た店舗
- AdSense差し込み用広告枠
- PWA / SEO / sitemap / robots.txt

## 台データの同期
FLOOR777側にはGoogle Sheetsの秘密情報を置きません。
`slotdash-mihara` 側のGitHub Actionsが、既存の `SPREADSHEET_ID` / `GCP_CREDENTIALS` Secretsを使って `public_data/mihara-stats.json` を毎朝更新します。
FLOOR777はその公開JSONをブラウザから読み込みます。

## GitHub Pages
このフォルダの**中身**を `floor777` リポジトリのルートへアップロードします。
既にPages公開済みなら、同名ファイルを上書きしてCommitするだけです。

## AdSense
審査通過後、`assets/site-config.js` の `adsenseClient` / `adsenseSlot` を設定してください。審査前は空欄のままでOKです。
