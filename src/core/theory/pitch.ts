// 音高。「音名・変化記号・オクターブ」で持ち、MIDI番号は計算で出す（C4 = 60）。

export type Step = 'C' | 'D' | 'E' | 'F' | 'G' | 'A' | 'B';
export type Alter = -2 | -1 | 0 | 1 | 2;
export type Pitch = { step: Step; alter: Alter; octave: number };

export const STEPS: readonly Step[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const STEP_SEMITONES: Record<Step, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export const stepIndex = (step: Step) => STEPS.indexOf(step);
export const stepSemitone = (step: Step) => STEP_SEMITONES[step];

export function isAlter(n: number): n is Alter {
  return Number.isInteger(n) && n >= -2 && n <= 2;
}

export function pitch(step: Step, alter: number, octave: number): Pitch {
  if (!isAlter(alter)) throw new RangeError(`変化記号は -2〜2 のみ: ${step}${alter}`);
  return { step, alter, octave };
}

export function midi(p: Pitch): number {
  return (p.octave + 1) * 12 + STEP_SEMITONES[p.step] + p.alter;
}

/** C0 を 0 とした全音階上の位置（音名だけで数える） */
export function diatonicIndex(p: Pitch): number {
  return p.octave * 7 + stepIndex(p.step);
}

export function pitchEquals(a: Pitch, b: Pitch): boolean {
  return a.step === b.step && a.alter === b.alter && a.octave === b.octave;
}

const ACCIDENTAL_TEXT: Record<Alter, string> = { [-2]: '𝄫', [-1]: '♭', 0: '', 1: '♯', 2: '𝄪' };

/** 表示用：'B♭3' */
export function formatPitch(p: Pitch): string {
  return `${p.step}${ACCIDENTAL_TEXT[p.alter]}${p.octave}`;
}

/** 'C4' 'Bb3' 'B♭3' 'F#5' 'Cx4' 'Ebb2' を読む（設定ファイル用） */
export function parsePitch(text: string): Pitch {
  const m = /^([A-G])(bb|b|♭♭|♭|𝄫|##|#|♯♯|♯|x|𝄪)?(-?\d+)$/.exec(text.trim());
  if (!m) throw new Error(`音高として読めません: ${text}`);
  const acc = m[2] ?? '';
  const alter = (
    { '': 0, b: -1, '♭': -1, bb: -2, '♭♭': -2, '𝄫': -2, '#': 1, '♯': 1, '##': 2, '♯♯': 2, x: 2, '𝄪': 2 } as const
  )[acc as 'b'];
  return pitch(m[1] as Step, alter, Number(m[3]));
}

/** 全音階上の位置とMIDI番号から音高を綴る。変化記号が ±2 を超えるなら null */
export function spellFromDiatonic(diatonic: number, midiNumber: number): Pitch | null {
  const octave = Math.floor(diatonic / 7);
  const step = STEPS[((diatonic % 7) + 7) % 7];
  const alter = midiNumber - ((octave + 1) * 12 + STEP_SEMITONES[step]);
  return isAlter(alter) ? { step, alter, octave } : null;
}

/** 異名同音で変化記号の少ない綴りにする（例：B♯3 → C4、F𝄪 → G） */
export function simplifyEnharmonic(p: Pitch, prefer: 'sharp' | 'flat' = p.alter < 0 ? 'flat' : 'sharp'): Pitch {
  if (p.alter === 0) return p;
  const m = midi(p);
  const candidates = [-1, 0, 1]
    .map((d) => spellFromDiatonic(diatonicIndex(p) + d, m))
    .filter((c): c is Pitch => c !== null)
    .sort((a, b) => Math.abs(a.alter) - Math.abs(b.alter));
  const best = Math.abs(candidates[0].alter);
  const ties = candidates.filter((c) => Math.abs(c.alter) === best);
  return ties.find((c) => (prefer === 'flat' ? c.alter <= 0 : c.alter >= 0)) ?? ties[0];
}
