declare module 'verovio/wasm' {
  export default function createVerovioModule(): Promise<unknown>;
}
declare module 'verovio/esm' {
  export class VerovioToolkit {
    constructor(module: unknown);
    getVersion(): string;
    getLog(): string;
    setOptions(o: Record<string, unknown>): void;
    getAvailableOptions(): Record<string, unknown>;
    loadData(data: string): boolean;
    renderToSVG(page?: number, xmlDeclaration?: boolean): string;
    edit(action: { action: string; param: Record<string, unknown> }): boolean;
    redoLayout(): void;
    redoPagePitchPosLayout(): void;
    getPageCount(): number;
    getMEI(o?: Record<string, unknown>): string;
  }
}
