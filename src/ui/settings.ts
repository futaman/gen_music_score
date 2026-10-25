// 表示オプション（docs/spec.md「表示オプション」）。端末ごとに localStorage へ保存する。

import { useEffect, useState } from 'react';
import type { NoteNameStyle } from '../core/theory/names';

export type Device = 'pc' | 'tablet' | 'phone';

export type DisplaySettings = {
  view: 'score' | 'part' | 'selected'; // 総譜／パート譜／選んだパートだけ
  partId?: string; // パート譜のとき
  selectedPartIds?: string[]; // 選んだパートだけのとき
  pitchMode: 'written' | 'concert'; // 移調（記譜音）／実音
  layout: 'page' | 'horizontal' | 'vertical';
  zoom: 'fit' | number; // 50〜200（%）
  noteNames: 'none' | NoteNameStyle;
  measureNumbers: 'system' | 'every' | 'five' | 'none';
  colorBy: 'none' | 'instrument';
  follow: boolean; // 再生中に自動スクロール
  theme: 'system' | 'light' | 'dark';
  hornKeySignature: 'with' | 'without';
  warnings: boolean; // 警告ハイライト（音域外の音を赤く）
  multiRest: boolean; // 全休符が続く小節を数字付きの1つにまとめる
  showEdits: boolean; // 編曲で作った楽譜で、手で直した音に色を付ける
};

export function defaultSettings(device: Device): DisplaySettings {
  return {
    view: device === 'phone' ? 'part' : 'score',
    pitchMode: 'written',
    layout: device === 'pc' ? 'page' : 'vertical',
    zoom: 'fit',
    noteNames: 'none',
    measureNumbers: 'system',
    colorBy: 'none',
    follow: true,
    theme: 'system',
    hornKeySignature: 'with',
    warnings: true,
    multiRest: false,
    showEdits: true,
  };
}

export function detectDevice(): Device {
  const w = window.innerWidth;
  const coarse = window.matchMedia?.('(pointer: coarse)').matches;
  if (w < 600) return 'phone';
  if (coarse && w < 1400) return 'tablet';
  return 'pc';
}

const KEY = 'displaySettings:v1';

function load(device: Device): DisplaySettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...defaultSettings(device), ...(JSON.parse(raw) as Partial<DisplaySettings>) };
  } catch {
    // 保存できない環境（プライベートモードなど）では既定値を使う
  }
  return defaultSettings(device);
}

export function useDisplaySettings(device: Device) {
  const [settings, setSettings] = useState(() => load(device));
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(settings));
    } catch {
      // 保存できなくても表示は続ける
    }
  }, [settings]);
  const update = (patch: Partial<DisplaySettings>) => setSettings((s) => ({ ...s, ...patch }));
  const reset = () => setSettings(defaultSettings(device));
  return { settings, update, reset };
}

export function useDevice(): Device {
  const [device, setDevice] = useState(detectDevice);
  useEffect(() => {
    const on = () => setDevice(detectDevice());
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return device;
}
