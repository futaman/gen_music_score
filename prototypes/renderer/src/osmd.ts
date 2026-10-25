// 比較用：OpenSheetMusicDisplay で同じ楽譜を丸ごと描画し、音高を1つ変えて描き直す時間を測る
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import { unzipSync, strFromU8 } from 'fflate';

declare global {
  interface Window { __osmd: { done: boolean; loadMs?: number; renderMs?: number; editMs?: number; error?: string } }
}
window.__osmd = { done: false };
const file = new URLSearchParams(location.search).get('file') ?? 'musicxml/synthetic-orchestra-500.musicxml';
const status = document.getElementById('status')!;

(async () => {
  try {
    const buf = new Uint8Array(await (await fetch(file)).arrayBuffer());
    let xml: string;
    if (file.endsWith('.mxl')) {
      const files = unzipSync(buf);
      const root = strFromU8(files['META-INF/container.xml']).match(/full-path="([^"]+)"/)![1];
      xml = strFromU8(files[root]);
    } else xml = new TextDecoder().decode(buf);
    const osmd = new OpenSheetMusicDisplay(document.getElementById('score')!, { autoResize: false, backend: 'svg', drawTitle: true });
    let t = performance.now();
    await osmd.load(xml);
    window.__osmd.loadMs = performance.now() - t;
    t = performance.now();
    osmd.render();
    window.__osmd.renderMs = performance.now() - t;
    // 最初の音符の音高を半音上げて描き直す（OSMDは部分描画がないため全体を描き直す）
    const note = osmd.Sheet.SourceMeasures[1].VerticalSourceStaffEntryContainers[0].StaffEntries.find((e) => e)!.VoiceEntries[0].Notes[0];
    t = performance.now();
    note.TransposedPitch = note.Pitch.getTransposedPitch(1);
    osmd.render();
    window.__osmd.editMs = performance.now() - t;
    status.textContent = JSON.stringify(window.__osmd);
  } catch (e) {
    window.__osmd.error = String(e);
    status.textContent = String(e);
  }
  window.__osmd.done = true;
})();
