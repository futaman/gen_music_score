# テスト素材の入手元とライセンス

| ファイル | 曲 | 入手元 | ライセンス | 作成ソフト | 用途 |
| --- | --- | --- | --- | --- | --- |
| `musicxml/mozart-k464-1-allegro.mxl` | モーツァルト 弦楽四重奏曲第18番 イ長調 K.464 第1楽章 | [OpenScore String Quartets](https://github.com/OpenScore/StringQuartets)（MuseScore ID 7093885） | CC0 1.0 | MuseScore 3.6.2 | 移調テスト（イ長調）。K.331の代わり |
| `musicxml/mozart-k387.mxl` | モーツァルト 弦楽四重奏曲第14番 ト長調 K.387（全楽章） | 同上（ID 7103818） | CC0 1.0 | MuseScore 3.6.2 | 弦4部→木管5部の編曲テスト。アイネ・クライネの代わり |
| `musicxml/beethoven-op18-1.mxl` | ベートーヴェン 弦楽四重奏曲第1番 Op.18-1（全楽章） | 同上（ID 8071278） | CC0 1.0 | MuseScore 3.6.2 | 実データでの大きめの読み込み（約950小節×4パート） |
| `musicxml/synthetic-orchestra-500.musicxml` | 合成（音楽的な意味なし） | `scripts/gen-synthetic-orchestra.mjs` で生成 | 自作 | 自作スクリプト | 性能テスト。運命 第1楽章と同じ規模（2管・18パート・500小節・B♭クラ／E♭ホルンの移調あり） |

## まだ手に入っていないもの（ブラウザで musescore.com から取得する）

この開発環境からは musescore.com・IMSLP・Mutopia に接続できないため、以下は手動で取得して追加する。

- [ ] ベートーヴェン 交響曲第5番 第1楽章（OpenScore、CC0）
- [ ] モーツァルト アイネ・クライネ・ナハトムジーク 第1楽章（CC0）
- [ ] モーツァルト ピアノソナタ K.331 第1楽章（CC0）
- [ ] MuseScore以外のソフト（Dorico／Sibelius／Finale）が書き出したMusicXML
