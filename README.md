# Mea Tattoo Pricing Core

アーティスト向け・顧客向け料金計算機が共有する、外部依存のない料金エンジンです。料金表は `config.json`、計算処理は `src/engine.cjs` を正本とします。ブラウザー版も同じ処理から生成するため、画面ごとに計算式を複製する必要はありません。

この変更は開発用の草案です。変更は作業ブランチと Draft PR で確認し、利用者の確認前に本番公開・本番ブランチへのマージ・公開参照先の切り替えを行いません。

## ファイル

| ファイル | 役割 |
| --- | --- |
| `config.json` | 料金帯、補正率、形状の閾値、丸め単位、同時施術割の正本 |
| `src/engine.cjs` | CommonJS で読み込める共通計算処理 |
| `scripts/build.cjs` | ブラウザー版と検証用 manifest の決定的な生成 |
| `dist/pricing.js` | ブラウザー・CommonJS・AMD で利用できる生成物 |
| `dist/manifest.json` | 生成物のファイル名、API バージョン、料金バージョン、SHA-256 |
| `test/contracts.test.cjs` | 料金変更後も実行する API・計算順序・配布物の契約テスト |
| `test/legacy-v1.test.cjs` | 既存 v1 料金との一致を確認する回帰テスト |
| `test/fixtures/legacy-v1.cjs` | 移行前の HTML から抽出した固定の計算式・料金表 |
| `test/fixtures/legacy-v1-manifest.json` | 抽出元 HTML の SHA-256 と v1 料金設定の指紋 |

実行時の通信や外部ライブラリはありません。Node.js 18 以上でビルドとテストを実行できます。`npm install` は不要です。

```sh
npm run build
npm test
```

`dist` を直接編集しないでください。ビルド結果に時刻や環境依存のパスを含めないため、同じソースから同じバイト列と SHA-256 が生成されます。テストは再ビルドして、配布物が正本と一致することも確認します。

## 読み込み

ブラウザーでは同梱したローカルファイルを読み込み、グローバルの `MeaPricing` を使用します。

```html
<script src="assets/pricing.js"></script>
<script>
  const calc = MeaPricing.calculate({
    long: 80, short: 50,
    whitespace: 'notApplicable',
    complexity: 'veryComplex', color: 'fourToSix'
  }, 'artist');
  console.log(calc.rounded); // v1: 40000
</script>
```

CommonJS では `require('./src/engine.cjs')` または `require('./dist/pricing.js')` で同じ API を利用できます。配布物を画面側へコピーするときは `dist/manifest.json` のハッシュを照合します。

## 公開 API

`apiVersion` は呼び出し形式の互換性を示す数値で、現行は `1` です。`version` は料金ルールの識別子で、現行は `'v1'` です。`config` と、その参照を公開する `BASE_BANDS`、`RATE`、`SHAPE_RATIO` は子要素まで凍結されています。

| API | 戻り値・動作 |
| --- | --- |
| `base(mm)` | 該当する `{size,min,max,price}` のコピー。対象外は `{special:true}` |
| `rate(type,value,size)` | 補正率。未選択・未知のキーは `0`。XXS は全補正 `0` |
| `shapeFromRatio(ratio)` | 短辺÷長辺の比率を形状キーへ変換。百分率ではなく `0.34` のような比率を渡す |
| `calculate(input, profile='artist')` | 計算明細オブジェクト。入力不備・自動計算対象外は `null` |
| `maxAffordableLength(budget, options)` | 顧客向け条件で予算内となる最大整数 mm。該当なし・不正な条件は `0` |
| `summarize([{calc,combined}, ...])` | `{subtotal,discount,total,complete,separatelyPricedCount}` |

### `calculate`

`input` は `{long, short?, shape?, whitespace?, complexity?, color?}` です。寸法は正の整数を渡します。数値文字列・小数・0・非有限値は受け付けません。アーティスト画面にある数値入力の丸め・1〜300mm への補正は、これまでどおり画面側の `normalizeNumber` が担当します。230mm 超は自動計算対象外となります。

`short` がある場合は、`short <= long` を確認して寸法比から形状を決定します。両方指定されていても `shape` より寸法を優先します。予算計算などでは `short` を省略して既知の `shape` を指定できます。この場合、明細の `short` は `null` です。

`artist` は余白補正を使用し、余白・複雑さ・カラーの未選択または省略を `''`、補正率を `0` として扱います。`customer` は複雑さとカラーの選択が必須で、入力された余白は適用しません。未知の選択肢や未知の profile は `null` を返します。

明細のフィールドは、元のアーティスト画面の計算結果と同じです。

```text
long, short, size, bandMin, bandMax, basePrice,
shape, shapeRate, whitespace, whitespaceRate,
complexity, complexityRate, color, colorRate,
shapeAmount, whitespaceAmount, complexityAmount, colorAmount,
afterShape, afterWhitespace, afterComplexity, raw, rounded
```

基準価格 → 形状 → 余白 → 複雑さ → カラーの順に、直前の金額へ補正を掛けます。途中で丸めず、最後に `Math.round(raw / 1000) * 1000` で丸めます。元の浮動小数点の演算順序も維持します。補正率の合算、乗算のまとめ直し、途中の整数化は互換性を変えるため行いません。

### 予算と合計

`maxAffordableLength` の options は `{shape,complexity,color}` です。料金が寸法に対して常に増加するとは限らないため、全ての対象整数寸法を調べて最大値を返します。短辺の表示には `SHAPE_RATIO` を使用できます。

`summarize` は最初の施術を必ず別料金として数えます。2 件目以降で `combined: true` の施術は加算せず、割引対象件数にも含めません。その施術の `calc` が `null` でも合計の完成状態を妨げません。別料金の施術が未計算の場合は対象件数に含め、`complete: false` にします。

v1 では別料金の施術が 2 件以上で一度だけ 5,000 円を割り引き、合計の下限は 0 円です。画面の割引表記は `config.sameDayDiscount.amount` を参照してください。`complete: false` のときも計算できた分の数値は返すため、画面は `complete` を確認し、完成した合計として表示しないようにします。

## テストと今後の料金変更

v1 回帰テストでは次を元の HTML から抽出した固定の処理と比較します。

- 9 料金帯 × 4 形状 × 5 余白 × 5 複雑さ × 3 カラー = 2,700 条件の全明細
- 長辺・短辺の 1〜300mm 全整数組み合わせ 90,000 組を両 profile で確認
- 全料金境界、形状閾値の直前・一致・直後、未選択を含む 2,484 条件
- 顧客向け明示形状の 13,800 条件、予算スライダーの 6,240 条件と範囲外予算
- 合算・未入力・最初の施術・一律割引を含む 1,365 通りの合計

料金変更時は正本の `config.json` を編集し、料金ルールの `version` を `v2` などへ更新して再ビルドします。旧版との一致テストを通すために v1 fixture を書き換えてはいけません。必要なら別ファイルで新しい版の回帰基準を追加します。

v1 の指紋は `version` と `apiVersion` を除く全料金設定から計算します。`version === 'v1'` のまま設定を変更すると失敗します。また、版名だけを変更して設定が v1 のままの場合も、v1 の回帰テストを継続します。これにより、版名だけの更新で計算順序の差異を見落とすことを防ぎます。

`contracts.test.cjs` は料金の固定金額を前提にせず、設定から求めた演算順序、入力検証、顧客向け余白除外、最大予算寸法、合算条件、設定の不変性、配布形式と SHA-256 を確認します。料金変更後もこれらのテストを継続して実行します。API の破壊的変更は料金変更とは別に検討し、呼び出し側と `apiVersion` を合わせて更新します。
