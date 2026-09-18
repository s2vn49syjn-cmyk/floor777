# FLOOR777 v2 ステータス

- ブランド: FLOOR777
- 公開方式: GitHub Pages / 静的サイト
- 初期店舗: HYPER ARROW美原店
- 登録台数: 551台
- 島図座標: 2026-09-18 `positions.json`
- 機種配置: SLOTDASH公開JSONの最新営業日を優先、未同期時は静的スナップショット
- 台データ: 最新差枚 / 最新G数 / 3日差枚 / 3日平均G / 7日差枚 / 7日平均G / 直近7日履歴
- データ更新: slotdash-miharaの毎朝スクレイピング後に公開JSONを自動コミット
- FLOOR777側にGoogle認証情報は置かない
- 向き180°切替、機種名表示ON/OFF
- AdSense: ID未設定のためプレースホルダー

## 初回確認
1. `slotdash-mihara/public_data/mihara-stats.json` が生成される
2. FLOOR777美原店ページ上部に「台データ YYYY/MM/DD」が表示される
3. 821番台などをタップして差枚・G数が表示される
4. 3日/7日データが不足時は「—」になる
5. 機種入替をまたぐ期間は3日/7日集計を出さない
