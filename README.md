# 楽譜作成・編曲アプリ

既存の楽譜（MusicXML）を読み込み、移調と別編成への編曲をブラウザ上で行うWebアプリ。

- 仕様：[`docs/spec.md`](docs/spec.md)
- 開発計画：[`docs/dev-plan.md`](docs/dev-plan.md)
- 判断の記録：[`docs/decisions/`](docs/decisions/)

## 開発

```sh
npm ci
npm run dev            # 開発サーバー
npm run check          # 型・lint・整形・単体テストをまとめて
npm run test:e2e       # 画面テスト（PC・タブレット・スマホの画面サイズ）
npm run check:musescore  # MuseScore 3 を使った往復確認（mscore3 が必要。CIでは動かさない）
```

## 構成

| 場所                      | 中身                                                 |
| ------------------------- | ---------------------------------------------------- |
| `src/core/theory/`        | 分数・音高・音程（度数）・調号                       |
| `src/core/model/`         | 内部データの型（schemaVersion 1）と版の変換          |
| `src/core/musicxml/`      | MusicXML の読み込み・書き出し・往復比較              |
| `src/core/instruments.ts` | 楽器定義（`config/instruments.json`）と楽器の推定    |
| `src/workers/`            | Web Worker（読み込み）                               |
| `src/ui/`                 | 画面（React）                                        |
| `config/`                 | 楽器・編成の設定                                     |
| `test-assets/`            | テスト素材（ライセンスは `test-assets/LICENSES.md`） |
| `prototypes/renderer/`    | 描画の試作（ステップ0）                              |
