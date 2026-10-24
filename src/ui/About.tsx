/** このアプリについて：使っているライブラリと音源のライセンス表示 */
export function About() {
  return (
    <details className="about">
      <summary>このアプリについて</summary>
      <p className="muted">
        楽譜（MusicXML）を読み込み、表示・再生・移調・編曲するアプリです（開発中）。ホーム画面に追加すると、アプリのように使えます。
      </p>
      <h3>使っているもの</h3>
      <ul className="compact">
        <li>
          楽譜の描画：<a href="https://www.verovio.org/">Verovio</a>（LGPL-3.0）
        </li>
        <li>
          再生の音源：FluidR3_GM（Frank Wen、MIT ライセンス）から作ったサンプル（
          <a href={`${import.meta.env.BASE_URL}samples/LICENSE.txt`}>ライセンス全文</a>）
        </li>
        <li>再生：Tone.js（MIT）</li>
        <li>画面：React（MIT）</li>
        <li>MusicXML の解析：txml（MIT）、.mxl の展開：fflate（MIT）</li>
      </ul>
    </details>
  );
}
