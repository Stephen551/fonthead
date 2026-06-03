import { useRef, useState } from 'react';
import {
  waitForEngine,
  traceSheet,
  buildFont,
  downloadFont,
  makeSampleSheet,
  canvasToImage,
  fileToImage,
  DEFAULT_TRACE,
  ROW_CHARS,
  type FontResult,
} from '../lib/maker';

type Phase = 'idle' | 'working' | 'done' | 'error';
type StageState = 'queued' | 'active' | 'done';

const STAGES = [
  { key: 'binarize', label: 'binarize', desc: 'threshold · otsu adaptive' },
  { key: 'slice', label: 'slice', desc: 'rows · cells · baseline' },
  { key: 'trace', label: 'trace', desc: 'contours · vectorise' },
  { key: 'build', label: 'build', desc: 'opentype · pack otf ttf woff2' },
] as const;

// engine step -> stage index
const STEP_STAGE: Record<string, number> = {
  binarize: 0,
  slice: 1,
  trace: 2,
  otf: 3, sidebearings: 3, hint: 3, 'hint-embed': 3, ttf: 3, woff: 3, woff2: 3,
};

export default function Maker() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [family, setFamily] = useState('Handmade');
  const [stageIdx, setStageIdx] = useState(-1);
  const [log, setLog] = useState<string>('');
  const [result, setResult] = useState<FontResult | null>(null);
  const [glyphCount, setGlyphCount] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState('');
  const [previewFam, setPreviewFam] = useState('');
  const [previewText, setPreviewText] = useState('Handmade');
  const dropRef = useRef<HTMLDivElement>(null);

  const setStage = (i: number, msg: string) => {
    setStageIdx((cur) => (i > cur ? i : cur));
    setLog(msg);
  };

  async function run(getImage: () => Promise<HTMLImageElement | ImageBitmap>) {
    setPhase('working');
    setResult(null);
    setStageIdx(-1);
    setError('');
    setPreviewFam('');
    const t0 = performance.now();
    try {
      await waitForEngine();
      const img = await getImage();
      const glyphs = await traceSheet(img, ROW_CHARS, DEFAULT_TRACE, (step, message) =>
        setStage(STEP_STAGE[step] ?? 2, message),
      );
      if (!glyphs.length) throw new Error('no glyphs traced — try a cleaner sheet (dark letters on white)');
      setGlyphCount(glyphs.length);
      const fam = family.trim() || 'Handmade';
      const res = await buildFont(glyphs, { family: fam, formats: ['otf', 'ttf', 'woff2'] }, (step, message) =>
        setStage(STEP_STAGE[step] ?? 3, `${step} · ${message}`),
      );
      setStageIdx(STAGES.length);
      setResult(res);
      setElapsed((performance.now() - t0) / 1000);
      // verification hook (harmless): byte lengths of the built formats
      (window as any).__lastBuild = {
        glyphCount: glyphs.length,
        otf: res.otf?.length ?? 0,
        ttf: res.ttf?.length ?? 0,
        woff2: res.woff2?.length ?? 0,
      };
      // live preview from the built woff2 (fall back to otf)
      const previewBytes = res.woff2 || res.otf;
      if (previewBytes) {
        const url = URL.createObjectURL(new Blob([previewBytes as BlobPart]));
        const pf = `built-${Date.now()}`;
        const face = new FontFace(pf, `url(${url})`);
        await face.load();
        (document as any).fonts.add(face);
        setPreviewFam(pf);
        setPreviewText(fam);
      }
      setPhase('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase('error');
    }
  }

  const onSample = () =>
    run(async () => {
      try {
        await (document as any).fonts.load('700 130px "Anton"');
      } catch {
        /* fall back to system font */
      }
      return canvasToImage(makeSampleSheet());
    });

  const onFile = (file: File | undefined) => {
    if (file) run(() => fileToImage(file));
  };

  const stageStateOf = (i: number): StageState =>
    stageIdx > i ? 'done' : stageIdx === i ? 'active' : 'queued';

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0, alignItems: 'stretch' }}>
      {/* left: the sheet / input */}
      <div style={{ padding: '26px 32px 30px', borderRight: '1px solid var(--line)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <span className="fh-eyebrow">01 · the sheet</span>
          <span className="fh-mono" style={{ fontSize: 11, color: 'var(--ink-faint)' }}>
            dark letters on white · 3 rows
          </span>
        </div>

        <div
          ref={dropRef}
          onDragOver={(e) => {
            e.preventDefault();
            dropRef.current?.style.setProperty('border-color', 'var(--ink)');
          }}
          onDragLeave={() => dropRef.current?.style.setProperty('border-color', 'var(--line-2)')}
          onDrop={(e) => {
            e.preventDefault();
            dropRef.current?.style.setProperty('border-color', 'var(--line-2)');
            onFile(e.dataTransfer.files?.[0]);
          }}
          style={{
            border: '1px dashed var(--line-2)',
            borderRadius: 3,
            background: 'var(--paper-3)',
            padding: '38px 16px',
            textAlign: 'center',
            transition: 'border-color var(--dur) var(--ease)',
          }}
        >
          <div className="fh-mono" style={{ fontSize: 13, color: 'var(--ink-soft)' }}>
            drop an alphabet sheet
          </div>
          <div className="fh-mono" style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 6 }}>
            png or jpg · rows of A–Z, a–z, 0–9
          </div>
          <label
            className="fh-btn fh-btn--ghost"
            style={{ marginTop: 16, cursor: 'pointer', display: 'inline-flex' }}
          >
            choose a file
            <input
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={(e) => onFile(e.target.files?.[0] ?? undefined)}
            />
          </label>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 16 }}>
          <button className="fh-btn fh-btn--ghost" onClick={onSample} disabled={phase === 'working'}>
            try a sample sheet
          </button>
          <span className="fh-mono" style={{ fontSize: 11, color: 'var(--ink-faint)' }}>
            renders + traces a demo alphabet
          </span>
        </div>

        <div style={{ marginTop: 22 }}>
          <label className="fh-mono" style={{ fontSize: 11, color: 'var(--ink-faint)', letterSpacing: '.06em', display: 'block', marginBottom: 7 }}>
            NAME
          </label>
          <input
            className="fh-input"
            style={{ width: '100%' }}
            value={family}
            onChange={(e) => setFamily(e.target.value)}
            placeholder="your font's name"
          />
        </div>
      </div>

      {/* right: build readout + result */}
      <div style={{ padding: '26px 32px 30px', background: 'var(--paper-2)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <span className="fh-eyebrow">02 · the build</span>
          <span className="fh-mono" style={{ fontSize: 11, color: 'var(--ink-faint)' }}>honest readout · real work</span>
        </div>

        {/* dark terminal readout */}
        <div style={{ background: 'var(--ink)', borderRadius: 3, padding: '16px 18px', fontFamily: 'var(--mono)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <span style={{ fontSize: 10.5, letterSpacing: '.14em', textTransform: 'uppercase', color: 'rgba(255,255,255,.4)' }}>
              build · fonthead maker
            </span>
            <span style={{ fontSize: 11, color: phase === 'done' ? '#6fcf97' : phase === 'error' ? 'var(--signal)' : 'rgba(255,255,255,.55)' }}>
              {phase === 'done' ? `done · ${elapsed.toFixed(1)}s` : phase === 'working' ? 'running' : phase === 'error' ? 'failed' : 'idle'}
            </span>
          </div>
          {STAGES.map((s, i) => {
            const st = stageStateOf(i);
            return (
              <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '6px 0', fontSize: 12.5, opacity: st === 'queued' ? 0.38 : 1, transition: 'opacity .3s var(--ease)' }}>
                <span style={{ width: 13, color: st === 'done' ? '#6fcf97' : st === 'active' ? 'var(--signal)' : 'rgba(255,255,255,.5)' }}>
                  {st === 'done' ? '✓' : st === 'active' ? '●' : '·'}
                </span>
                <span style={{ width: 74, color: '#fff' }}>{s.label}</span>
                <span style={{ flex: 1, color: 'rgba(255,255,255,.55)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {st === 'active' && log ? log : s.desc}
                </span>
                <span style={{ color: st === 'done' ? 'rgba(255,255,255,.55)' : 'rgba(255,255,255,.3)', width: 30, textAlign: 'right' }}>
                  {st === 'done' ? '✓' : st === 'active' ? '···' : '—'}
                </span>
              </div>
            );
          })}
          <div style={{ height: 2, background: 'rgba(255,255,255,.12)', marginTop: 12, borderRadius: 2, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${Math.max(0, Math.min(100, ((stageIdx + 1) / STAGES.length) * 100))}%`, background: 'var(--signal)', transition: 'width .4s var(--ease)' }} />
          </div>
        </div>

        {/* result / preview */}
        <div style={{ marginTop: 16, minHeight: 92 }}>
          {phase === 'error' && (
            <p className="fh-mono" style={{ fontSize: 12, color: 'var(--signal)', lineHeight: 1.5 }}>{error}</p>
          )}
          {phase === 'done' && result && (
            <div>
              <div
                style={{
                  fontFamily: previewFam ? `'${previewFam}', var(--sans)` : 'var(--sans)',
                  fontSize: 46,
                  color: 'var(--ink)',
                  lineHeight: 1.1,
                  minHeight: 56,
                  wordBreak: 'break-word',
                }}
              >
                {previewText || family}
              </div>
              <div className="fh-mono" style={{ fontSize: 11, color: 'var(--ink-faint)', margin: '8px 0 16px' }}>
                {glyphCount} glyphs traced · built in your browser
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {(['otf', 'ttf', 'woff2'] as const).map((fmt) =>
                  result[fmt] ? (
                    <button
                      key={fmt}
                      className="fh-btn"
                      onClick={() => downloadFont(result[fmt] as Uint8Array, family.trim() || 'Handmade', fmt)}
                    >
                      download {fmt}
                    </button>
                  ) : null,
                )}
              </div>
            </div>
          )}
          {phase === 'idle' && (
            <p className="fh-mono" style={{ fontSize: 11.5, color: 'var(--ink-faint)', lineHeight: 1.6 }}>
              Drop a sheet or try the sample. The build runs entirely in your browser, no upload to a
              server. You get installable otf, ttf, and woff2 files.
            </p>
          )}
          {phase === 'working' && (
            <p className="fh-mono" style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>{log || 'working…'}</p>
          )}
        </div>
      </div>
    </div>
  );
}
