import { useRef, useState } from 'react';
import { actions } from 'astro:actions';
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
  waitForColorEngine,
  buildColorFontFromImage,
  makeColorSampleSheet,
  type ColorMode,
  type FontResult,
} from '../lib/maker';

type Phase = 'idle' | 'working' | 'done' | 'error';
type StageState = 'queued' | 'active' | 'done';
type Kind = 'mono' | 'gradient' | 'flat';

const MONO_STAGES = [
  { key: 'binarize', label: 'binarize', desc: 'threshold · otsu adaptive' },
  { key: 'slice', label: 'slice', desc: 'rows · cells · baseline' },
  { key: 'trace', label: 'trace', desc: 'contours · vectorise' },
  { key: 'build', label: 'build', desc: 'opentype · pack otf ttf woff2' },
];
const COLOR_STAGES = [
  { key: 'binarize', label: 'read', desc: 'sheet · background' },
  { key: 'separate', label: 'separate', desc: 'palette · colour masks' },
  { key: 'paint', label: 'paint', desc: 'COLR / CPAL layers' },
  { key: 'pack', label: 'pack', desc: 'opentype · woff2' },
];

// engine step -> stage index (mono)
const STEP_STAGE: Record<string, number> = {
  binarize: 0,
  slice: 1,
  trace: 2,
  otf: 3, sidebearings: 3, hint: 3, 'hint-embed': 3, ttf: 3, woff: 3, woff2: 3,
};
// engine step -> stage index (colour)
const COLOR_STEP_STAGE: Record<string, number> = { separate: 1, build: 2 };

const KINDS: { id: Kind; label: string }[] = [
  { id: 'mono', label: 'monochrome' },
  { id: 'gradient', label: 'colour · gradient' },
  { id: 'flat', label: 'colour · flat' },
];

export default function Maker({ signedIn = false }: { signedIn?: boolean }) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [family, setFamily] = useState('Handmade');
  const [specimenWord, setSpecimenWord] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [publishing, setPublishing] = useState(false);
  const [publishedId, setPublishedId] = useState<string | null>(null);
  const [publishErr, setPublishErr] = useState('');
  const [stageIdx, setStageIdx] = useState(-1);
  const [log, setLog] = useState<string>('');
  const [result, setResult] = useState<FontResult | null>(null);
  const [glyphCount, setGlyphCount] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState('');
  const [previewFam, setPreviewFam] = useState('');
  const [previewText, setPreviewText] = useState('Handmade');
  const [kind, setKind] = useState<Kind>('mono');
  const [colrStatus, setColrStatus] = useState('');
  const dropRef = useRef<HTMLDivElement>(null);

  const isColor = kind !== 'mono';
  const stages = isColor ? COLOR_STAGES : MONO_STAGES;

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
    setPublishedId(null);
    setPublishErr('');
    setColrStatus('');
    const t0 = performance.now();
    const fam = family.trim() || 'Handmade';
    try {
      let res: FontResult;
      let count = 0;
      let colr = '';
      if (isColor) {
        await waitForColorEngine();
        const img = await getImage();
        setStage(0, 'reading the sheet');
        const cres = await buildColorFontFromImage(img, kind as ColorMode, fam, (step, message) =>
          setStage(COLOR_STEP_STAGE[step] ?? 1, message),
        );
        res = { otf: cres.otf, woff2: cres.woff2 };
        count = cres.charCount;
        colr = cres.colrStatus;
        setColrStatus(colr);
      } else {
        await waitForEngine();
        const img = await getImage();
        const glyphs = await traceSheet(img, ROW_CHARS, DEFAULT_TRACE, (step, message) =>
          setStage(STEP_STAGE[step] ?? 2, message),
        );
        if (!glyphs.length) throw new Error('no glyphs traced — try a cleaner sheet (dark letters on white)');
        count = glyphs.length;
        res = await buildFont(glyphs, { family: fam, formats: ['otf', 'ttf', 'woff2'] }, (step, message) =>
          setStage(STEP_STAGE[step] ?? 3, `${step} · ${message}`),
        );
      }
      setGlyphCount(count);
      setStageIdx(stages.length);
      setResult(res);
      setElapsed((performance.now() - t0) / 1000);
      // verification hook (harmless)
      (window as any).__lastBuild = {
        kind,
        glyphCount: count,
        colrStatus: isColor ? colr : 'n/a',
        otf: res.otf?.length ?? 0,
        ttf: res.ttf?.length ?? 0,
        woff2: res.woff2?.length ?? 0,
      };
      // live preview from the built woff2 (fall back to otf); COLR renders in colour
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

  async function publish() {
    if (!result?.otf || !result?.woff2) return;
    setPublishing(true);
    setPublishErr('');
    try {
      const fd = new FormData();
      fd.set('name', family.trim() || 'Handmade');
      fd.set('specimenWord', specimenWord.trim());
      fd.set('visibility', visibility);
      fd.set('glyphCount', String(glyphCount));
      fd.set('treat', kind === 'mono' ? 'normal' : kind);
      fd.set('otf', new File([result.otf as BlobPart], 'font.otf', { type: 'font/otf' }));
      fd.set('woff2', new File([result.woff2 as BlobPart], 'font.woff2', { type: 'font/woff2' }));
      if (result.ttf) fd.set('ttf', new File([result.ttf as BlobPart], 'font.ttf', { type: 'font/ttf' }));
      const { data, error } = await actions.publishFont(fd);
      if (error) {
        setPublishErr(error.message || 'publish failed');
      } else if (data) {
        setPublishedId(data.id);
      }
    } catch (e) {
      setPublishErr(e instanceof Error ? e.message : 'publish failed');
    } finally {
      setPublishing(false);
    }
  }

  const onSample = () =>
    run(async () => {
      try {
        await (document as any).fonts.load('700 130px "Anton"');
      } catch {
        /* fall back to system font */
      }
      return canvasToImage(isColor ? makeColorSampleSheet() : makeSampleSheet());
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
        {/* build kind */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 18, flexWrap: 'wrap' }}>
          {KINDS.map((k) => (
            <button
              key={k.id}
              onClick={() => setKind(k.id)}
              className="fh-mono"
              disabled={phase === 'working'}
              style={{
                fontSize: 12,
                padding: '7px 12px',
                borderRadius: 2,
                cursor: 'pointer',
                border: `1px solid ${kind === k.id ? 'var(--ink)' : 'var(--line-2)'}`,
                background: kind === k.id ? 'var(--ink)' : 'var(--paper)',
                color: kind === k.id ? 'var(--paper)' : 'var(--ink-soft)',
                transition: 'all var(--dur) var(--ease)',
              }}
            >
              {k.label}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <span className="fh-eyebrow">01 · the sheet</span>
          <span className="fh-mono" style={{ fontSize: 11, color: 'var(--ink-faint)' }}>
            {isColor ? 'colour letters on white · 3 rows' : 'dark letters on white · 3 rows'}
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
          {stages.map((s, i) => {
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
            <div style={{ height: '100%', width: `${Math.max(0, Math.min(100, ((stageIdx + 1) / stages.length) * 100))}%`, background: 'var(--signal)', transition: 'width .4s var(--ease)' }} />
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
                {glyphCount} glyphs · {isColor ? `colour ${colrStatus === 'ok' ? 'COLR/CPAL ✓' : colrStatus || 'mono fallback'}` : 'traced'} · built in your browser
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

              {/* publish to the library */}
              <div style={{ marginTop: 22, paddingTop: 20, borderTop: '1px solid var(--line)' }}>
                <span className="fh-eyebrow" style={{ display: 'block', marginBottom: 12 }}>03 · publish to the library</span>
                {publishedId ? (
                  <div>
                    <p className="fh-mono" style={{ fontSize: 12.5, color: '#2f6f5e', margin: '0 0 12px' }}>
                      published as {visibility}. live on your maker page{visibility === 'public' ? ' and the wall' : ''}.
                    </p>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <a className="fh-btn" href={`/f/${publishedId}`}>view the font page&nbsp;&nbsp;&rarr;</a>
                      {visibility === 'public' && (
                        <a className="fh-btn fh-btn--ghost" href="/">see it on the wall</a>
                      )}
                    </div>
                  </div>
                ) : !signedIn ? (
                  <p className="fh-mono" style={{ fontSize: 12, color: 'var(--ink-faint)', lineHeight: 1.6 }}>
                    <a href="/sign-in" style={{ color: 'var(--ink)' }}>Sign in</a> to publish this font to the library.
                  </p>
                ) : (
                  <div>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                      <input
                        className="fh-input"
                        style={{ flex: 1, minWidth: 160 }}
                        value={specimenWord}
                        onChange={(e) => setSpecimenWord(e.target.value)}
                        placeholder="card word (optional)"
                      />
                      <div style={{ display: 'flex', border: '1px solid var(--line-2)', borderRadius: 2, overflow: 'hidden' }}>
                        {(['public', 'private'] as const).map((v) => (
                          <button
                            key={v}
                            onClick={() => setVisibility(v)}
                            className="fh-mono"
                            style={{ fontSize: 12, padding: '9px 16px', border: 'none', cursor: 'pointer', background: visibility === v ? 'var(--ink)' : 'var(--paper)', color: visibility === v ? 'var(--paper)' : 'var(--ink-soft)', transition: 'all var(--dur) var(--ease)' }}
                          >
                            {v}
                          </button>
                        ))}
                      </div>
                      <button className="fh-btn" onClick={publish} disabled={publishing}>
                        {publishing ? 'publishing…' : 'publish  →'}
                      </button>
                    </div>
                    {publishErr && (
                      <p className="fh-mono" style={{ fontSize: 11.5, color: 'var(--signal)', marginTop: 10 }}>{publishErr}</p>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
          {phase === 'idle' && (
            <p className="fh-mono" style={{ fontSize: 11.5, color: 'var(--ink-faint)', lineHeight: 1.6 }}>
              Drop a sheet or try the sample. Everything builds in your browser, nothing is uploaded.
              Monochrome gives otf, ttf, and woff2; colour gives a COLR/CPAL otf and woff2.
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
