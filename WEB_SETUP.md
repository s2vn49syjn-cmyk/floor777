# FLOOR777 台データ対応版 更新手順

## 1. FLOOR777を更新
1. `FLOOR777-v2.zip` を解凍
2. GitHubの `floor777` リポジトリを開く
3. Add file → Upload files
4. ZIPそのものではなく、解凍した中身を全部アップロード
5. 同名ファイルは上書きして Commit changes

Pages設定は既に済んでいるため、通常は設定変更不要です。

## 2. SLOTDASHに自動同期パッチを追加
別添の `slotdash-floor777-sync-patch.zip` を解凍し、既存 `slotdash-mihara` に次を反映します。

- `export_public_data.py` を追加
- `.github/workflows/scrape.yml` を上書き

既存の `SPREADSHEET_ID` / `GCP_CREDENTIALS` Secretsをそのまま使います。FLOOR777側へSecretをコピーする必要はありません。

## 3. 初回同期
`slotdash-mihara` → Actions → みんレポ自動スクレイピング → Run workflow → `normal`

完了後、`slotdash-mihara/public_data/mihara-stats.json` が作成されていれば成功です。
FLOOR777を再読み込みすると、台をタップした詳細欄に差枚・G数・3日/7日データが表示されます。

公開URL:
https://s2vn49syjn-cmyk.github.io/floor777/
