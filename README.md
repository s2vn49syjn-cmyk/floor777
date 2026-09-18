# FLOOR777

パチンコ・スロット店の島図から、機種名・台番号で台の位置を探す静的Webサイトです。

## 現在の掲載
- HYPER ARROW美原店
- 551台
- 島図座標: 2026-09-18版
- 機種名/台番号スナップショット: 2026-09-15版

## 主な機能
- 機種名検索 / 台番号検索
- 検索台ハイライト
- ドラッグ / 拡大縮小
- 島図180°向き切替（端末内に保存）
- 機種名ラベルON/OFF
- お気に入り / 最近見た店舗
- AdSense差し込み用広告枠
- PWA / SEO / sitemap / robots.txt

## GitHub Pages
このZIPの**中身**を `floor777` リポジトリのルートへアップロードし、Settings → Pages → Deploy from a branch → `main` / `/(root)` を選択します。

## AdSense
審査通過後、`assets/site-config.js` の `adsenseClient` / `adsenseSlot` を設定してください。審査前は空欄のままでOKです。

## SLOTDASHとの役割分担
`slotdash-mihara` はデータ収集・分析用。`floor777` は一般公開の島図検索サイトです。スクレイパーやGoogle Sheetsの認証情報はこのリポジトリへ入れません。
