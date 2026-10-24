import { useState } from 'react';
import type { ImportResult } from '../core/musicxml/file';
import { ImportSummary } from './ImportSummary';
import { importInWorker } from './importScore';

type State =
  | { kind: 'idle' }
  | { kind: 'loading'; fileName: string }
  | { kind: 'loaded'; fileName: string; result: ImportResult; ms: number }
  | { kind: 'error'; fileName: string; message: string };

export function App() {
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [over, setOver] = useState(false);

  async function open(file: File) {
    setState({ kind: 'loading', fileName: file.name });
    const bytes = new Uint8Array(await file.arrayBuffer());
    const res = await importInWorker(bytes, file.name);
    setState(
      res.ok
        ? { kind: 'loaded', fileName: file.name, result: res.result, ms: res.ms }
        : { kind: 'error', fileName: file.name, message: res.message },
    );
  }

  return (
    <div className="app">
      <h1>楽譜アプリ</h1>
      <label
        className={`drop${over ? ' over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const f = e.dataTransfer.files[0];
          if (f) open(f);
        }}
      >
        <span>MusicXMLファイル（.musicxml / .xml / .mxl）を選ぶか、ここにドロップ</span>
        <span className="button primary">ファイルを選ぶ</span>
        <input
          type="file"
          accept=".musicxml,.xml,.mxl,application/vnd.recordare.musicxml+xml,application/vnd.recordare.musicxml"
          aria-label="楽譜ファイル"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) open(f);
            e.target.value = '';
          }}
        />
      </label>

      {state.kind === 'loading' && <p className="muted">{state.fileName} を読み込み中…</p>}
      {state.kind === 'error' && (
        <div className="notice error" role="alert">
          {state.fileName}：{state.message}
        </div>
      )}
      {state.kind === 'loaded' && <ImportSummary fileName={state.fileName} result={state.result} ms={state.ms} />}
    </div>
  );
}
