# 料金計算の正本

- 料金設定・計算アルゴリズムの正本は別リポジトリ `mea-tattoo/pricing-core`。
- 通常の画面修正で `vendor/pricing.js`、`pricing-lock.json` を直接変更しない。画面に独自の料金計算を追加しない。
- 料金検討は正本の検討用ブランチで行う。本番へ反映するのはユーザーが確定した案だけ。
- 確定後は正本のmainの正確なSHAを `Apply confirmed pricing` に渡す。各HTMLへのAIによる転記はしない。
- API v1を維持すれば料金設定・計算方式の変更を取り込める。APIを変更する場合は画面側の対応と検査を同じ移行で行う。
- `npm test` と `npm run check:pricing` に合格させる。反映完了は公開URLの確認まで。
- シートは参考・比較用。シートから自動で現行料金を上書きしない。
