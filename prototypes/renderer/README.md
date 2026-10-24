# 描画の試作（ステップ0）

Verovio で楽譜を数小節ずつ描画し、音符をタップ→音高を変える→再描画の時間を測る使い捨ての試作。結果は `docs/decisions/0001-renderer.md`。

```sh
npm ci
npm run dev        # http://localhost:5173/ （?file=musicxml/...&size=8&scale=35）
npm run build
npm run bench      # Playwrightで3つの画面サイズを計測（FILES=..., SIZE=... で指定）
node bench/osmd.mjs  # OSMDとの比較（先に npm run build）
```

- 操作：音符をタップ（クリック）して選択 → ▲▼（PCは↑↓キー）で音高、「♯ 付け外し」でレイアウトし直す編集
- 画面右下に、直前の編集にかかった時間が出る
- テスト素材は `../../test-assets/` をそのまま配信している
