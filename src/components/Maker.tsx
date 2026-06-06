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
  detectGeometry,
  guessCharsetFromRows,
  DEFAULT_TRACE,
  TRACE_PRESETS,
  DEFAULT_COLOR_OPTS,
  DEFAULT_CHAR_LINES,
  SAMPLE_CHAR_LINES,
  parseCharset,
  type ColorOpts,
  waitForColorEngine,
  buildColorFontFromImage,
  editColorGlyph,
  editMonoRow,
  makeColorSampleSheet,
  type ColorMode,
  type FontResult,
  type GlyphReport,
  type EditAction,
  type SheetGeometry,
  type MonoRowInfo,
  type SlicerKind,
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

function RangeRow({ label, min, max, value, onChange }: { label: string; min: number; max: number; value: number; onChange: (v: number) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span className="fh-mono" style={{ fontSize: 10.5, color: 'var(--ink-faint)', width: 96 }}>{label}</span>
      <input type="range" aria-label={label} className="fh-range" min={min} max={max} value={value} onChange={(e) => onChange(+e.target.value)} style={{ flex: 1 }} />
      <span className="fh-mono" style={{ fontSize: 10.5, color: 'var(--ink-soft)', width: 20, textAlign: 'right' }}>{value}</span>
    </div>
  );
}

function ToggleRow({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" aria-pressed={on} onClick={() => onChange(!on)} className="fh-mono" style={{ fontSize: 11.5, padding: '6px 12px', borderRadius: 2, cursor: 'pointer', border: `1px solid ${on ? 'var(--ink)' : 'var(--line-2)'}`, background: on ? 'var(--ink)' : 'var(--paper)', color: on ? 'var(--paper)' : 'var(--ink-soft)' }}>
      {label}
      {on ? ' ✓' : ''}
    </button>
  );
}

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
  const [charsetText, setCharsetText] = useState(DEFAULT_CHAR_LINES.join('\n'));
  const [warning, setWarning] = useState('');
  const [detectedRows, setDetectedRows] = useState<number | null>(null);
  const [report, setReport] = useState<GlyphReport[]>([]);
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [editTurd, setEditTurd] = useState(2);
  const [editLeft, setEditLeft] = useState(0);
  const [editRight, setEditRight] = useState(0);
  const [editBusy, setEditBusy] = useState(false);
  const [editErr, setEditErr] = useState('');
  const [preset, setPreset] = useState<'glyph' | 'logo' | 'sketch'>('glyph');
  const [colorOpts, setColorOpts] = useState<ColorOpts>(DEFAULT_COLOR_OPTS);
  const [fineDetail, setFineDetail] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);
  const lastImgRef = useRef<HTMLImageElement | ImageBitmap | null>(null);
  // the live preview face + its blob URL, so each new build/edit tears down the last
  const previewRef = useRef<{ face: FontFace; url: string } | null>(null);
  // the source sheet + detected geometry, drawn back so the user can confirm the cut
  const [sheet, setSheet] = useState<{ url: string; w: number; h: number; geom: SheetGeometry } | null>(null);
  const sheetImgRef = useRef<HTMLImageElement | ImageBitmap | null>(null);
  // mono per-row slicing: diagnostics + which row (if any) is being re-sliced
  const [monoRows, setMonoRows] = useState<MonoRowInfo[]>([]);
  const [rowBusy, setRowBusy] = useState<number | null>(null);
  const [rowErr, setRowErr] = useState('');
  const [rowSlicerSel, setRowSlicerSel] = useState<Record<number, SlicerKind>>({});
  const traceOpts = { ...TRACE_PRESETS[preset], fineDetail };

  const isColor = kind !== 'mono';
  const stages = isColor ? COLOR_STAGES : MONO_STAGES;
  const flaggedCount = report.filter((g) => g.status !== 'ok' || g.flags.length > 0).length;

  const setStage = (i: number, msg: string) => {
    setStageIdx((cur) => (i > cur ? i : cur));
    setLog(msg);
  };

  // Draw the source sheet back at a small size and detect its row/cell geometry,
  // so the user can see the layout the maker found. Best-effort: a failure here
  // never blocks the build. Skipped when the image hasn't changed (e.g. rebuild).
  function captureSheet(img: HTMLImageElement | ImageBitmap) {
    if (sheetImgRef.current === img) return;
    sheetImgRef.current = img;
    try {
      const iw = (img as HTMLImageElement).naturalWidth ?? (img as ImageBitmap).width;
      const ih = (img as HTMLImageElement).naturalHeight ?? (img as ImageBitmap).height;
      const scale = Math.min(1, 520 / iw);
      const cw = Math.max(1, Math.round(iw * scale));
      const ch = Math.max(1, Math.round(ih * scale));
      const c = document.createElement('canvas');
      c.width = cw;
      c.height = ch;
      const cx = c.getContext('2d');
      if (!cx) return;
      cx.drawImage(img as CanvasImageSource, 0, 0, cw, ch);
      const url = c.toDataURL('image/jpeg', 0.82);
      const geom = detectGeometry(img);
      setSheet({ url, w: iw, h: ih, geom });
    } catch {
      /* overlay is a nicety, not a gate */
    }
  }

  async function run(
    getImage: () => Promise<HTMLImageElement | ImageBitmap>,
    charLinesOverride?: string[],
  ) {
    setPhase('working');
    setResult(null);
    setStageIdx(-1);
    setError('');
    setWarning('');
    setDetectedRows(null);
    setPreviewFam('');
    setPublishedId(null);
    setPublishErr('');
    setColrStatus('');
    setReport([]);
    setEditIdx(null);
    setMonoRows([]);
    setRowErr('');
    const rows = charLinesOverride ?? parseCharset(charsetText);
    const t0 = performance.now();
    const fam = family.trim() || 'Handmade';
    try {
      if (!rows.length) throw new Error('add at least one row of characters to the charset');
      let res: FontResult;
      let count = 0;
      let colr = '';
      let warn = '';
      let rep: GlyphReport[] = [];
      if (isColor) {
        await waitForColorEngine();
        const img = await getImage();
        lastImgRef.current = img;
        captureSheet(img);
        setStage(0, 'reading the sheet');
        const cres = await buildColorFontFromImage(img, kind as ColorMode, fam, rows, { ...colorOpts, fineDetail }, (step, message) =>
          setStage(COLOR_STEP_STAGE[step] ?? 1, message),
        );
        res = { otf: cres.otf, woff2: cres.woff2 };
        count = cres.charCount;
        colr = cres.colrStatus;
        setColrStatus(colr);
        warn = cres.rowWarning || (cres.glowWarning ? 'several letters look filled in (counters lost). Check the result, or raise the threshold.' : '');
        rep = cres.report || [];
      } else {
        await waitForEngine();
        const img = await getImage();
        lastImgRef.current = img;
        captureSheet(img);
        const trace = await traceSheet(img, rows, traceOpts, (step, message) =>
          setStage(STEP_STAGE[step] ?? 2, message),
        );
        setDetectedRows(trace.detectedRows);
        if (!trace.glyphs.length) throw new Error('no glyphs traced. Try a cleaner sheet (dark letters on white).');
        count = trace.glyphs.length;
        warn = trace.rowWarning;
        rep = trace.report;
        setMonoRows(trace.rows);
        res = await buildFont(trace.glyphs, { family: fam, formats: ['otf', 'ttf', 'woff2'] }, (step, message) =>
          setStage(STEP_STAGE[step] ?? 3, `${step} · ${message}`),
        );
      }
      if (warn) setWarning(warn);
      setReport(rep);
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
      // a font was just made: let app.ts offer the support nudge (once per browser)
      window.dispatchEvent(new Event('fh:coffee'));
      // live preview from the built woff2 (fall back to otf); COLR renders in colour
      const previewBytes = res.woff2 || res.otf;
      if (previewBytes) {
        const pf = await loadPreviewFont(previewBytes as Uint8Array);
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

  async function loadPreviewFont(bytes: Uint8Array): Promise<string> {
    // tear down the previous preview face + blob URL before adding a new one,
    // so repeated builds and per-glyph edits don't pile up fonts/URLs
    const prev = previewRef.current;
    if (prev) {
      try {
        (document as any).fonts.delete(prev.face);
      } catch {}
      URL.revokeObjectURL(prev.url);
    }
    const url = URL.createObjectURL(new Blob([bytes as BlobPart]));
    const pf = `built-${Date.now()}`;
    const face = new FontFace(pf, `url(${url})`);
    await face.load();
    (document as any).fonts.add(face);
    previewRef.current = { face, url };
    return pf;
  }

  function openEditor(i: number) {
    setEditIdx(i);
    setEditLeft(0);
    setEditRight(0);
    setEditTurd(2);
    setEditErr('');
  }

  async function applyEdit(action: EditAction) {
    if (editIdx == null) return;
    setEditBusy(true);
    setEditErr('');
    try {
      const params =
        action === 'exclude'
          ? { excluded: report[editIdx]?.status !== 'excluded' }
          : action === 'reslice'
            ? { left: editLeft, right: editRight, turd: editTurd }
            : { turd: editTurd };
      const cres = await editColorGlyph(action, editIdx, params);
      setResult({ otf: cres.otf, woff2: cres.woff2 });
      setReport(cres.report || []);
      setColrStatus(cres.colrStatus);
      setGlyphCount(cres.charCount);
      const bytes = cres.woff2 || cres.otf;
      if (bytes) setPreviewFam(await loadPreviewFont(bytes));
      (window as any).__lastBuild = {
        kind,
        glyphCount: cres.charCount,
        colrStatus: cres.colrStatus,
        otf: cres.otf?.length ?? 0,
        ttf: 0,
        woff2: cres.woff2?.length ?? 0,
      };
    } catch (e) {
      // the session rolled back; keep the prior result and tell the user why
      setEditErr(e instanceof Error ? e.message : 'edit failed');
    } finally {
      setEditBusy(false);
    }
  }

  // mono: re-slice one row with a chosen slicer and rebuild the font
  async function applyRowEdit(rowIndex: number, slicer: SlicerKind) {
    setRowBusy(rowIndex);
    setRowErr('');
    try {
      const r = await editMonoRow(rowIndex, slicer, family, traceOpts);
      setResult(r.result);
      setReport(r.report);
      setGlyphCount(r.glyphCount);
      setMonoRows(r.rows);
      const bytes = r.result.woff2 || r.result.otf;
      if (bytes) setPreviewFam(await loadPreviewFont(bytes as Uint8Array));
      (window as any).__lastBuild = {
        kind,
        glyphCount: r.glyphCount,
        colrStatus: 'n/a',
        otf: r.result.otf?.length ?? 0,
        ttf: r.result.ttf?.length ?? 0,
        woff2: r.result.woff2?.length ?? 0,
      };
    } catch (e) {
      // the row rolled back; keep the prior font and say why
      setRowErr(e instanceof Error ? e.message : 're-slice failed');
    } finally {
      setRowBusy(null);
    }
  }

  const onSample = () => {
    setEditIdx(null);
    setCharsetText(SAMPLE_CHAR_LINES.join('\n')); // the sample is exactly these 3 rows
    run(async () => {
      try {
        await (document as any).fonts.load('700 130px "Anton"');
      } catch {
        /* fall back to system font */
      }
      return canvasToImage(isColor ? makeColorSampleSheet() : makeSampleSheet());
    }, SAMPLE_CHAR_LINES);
  };

  function rebuild() {
    const img = lastImgRef.current;
    if (img) run(() => Promise.resolve(img));
  }

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      // Read the per-row cell geometry and build the charset from it, so the row
      // count always matches and letters + digits land exactly (a 4-row split, a
      // 6-row sheet with digits + punctuation, or a 7-row sheet all map right).
      if (isColor) await waitForColorEngine();
      else await waitForEngine();
      const img = await fileToImage(file);
      const geom = detectGeometry(img);
      const cellsPerRow = geom.rows.map((r) => r.cells.length);
      const guessed = guessCharsetFromRows(cellsPerRow);
      setCharsetText(guessed.join('\n'));
      await run(() => Promise.resolve(img), guessed);
      setDetectedRows(geom.rows.length);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not read that image');
      setPhase('error');
    }
  };

  const stageStateOf = (i: number): StageState =>
    stageIdx > i ? 'done' : stageIdx === i ? 'active' : 'queued';

  return (
    <div className="fh-maker-grid">
      {/* left: the sheet / input */}
      <div style={{ padding: '26px 32px 30px', borderRight: '1px solid var(--line)' }}>
        {/* build kind */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 18, flexWrap: 'wrap' }}>
          {KINDS.map((k) => (
            <button
              key={k.id}
              type="button"
              aria-pressed={kind === k.id}
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
            {isColor ? 'colour letters on white' : 'dark letters on white'}
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
          <div className="fh-mono" style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 6 }}>
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

        {/* source overlay: the sheet drawn back with the rows + cells the maker found */}
        {sheet && (
          <div style={{ marginTop: 18 }}>
            <div className="fh-mono" style={{ fontSize: 11, letterSpacing: '.06em', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 7 }}>
              <span style={{ color: 'var(--ink-faint)' }}>DETECTED LAYOUT</span>
              <span style={{ color: 'var(--ink-faint)' }}>
                {sheet.geom.rows.length} rows · {sheet.geom.rows[0]?.cells.length ?? 0} cells in row 1
              </span>
            </div>
            <div style={{ position: 'relative', border: '1px solid var(--line)', borderRadius: 3, overflow: 'hidden', background: 'var(--paper-3)', lineHeight: 0 }}>
              <img src={sheet.url} alt="your sheet with the detected rows and cells" style={{ display: 'block', width: '100%', height: 'auto' }} />
              <svg viewBox={`0 0 ${sheet.w} ${sheet.h}`} preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
                {sheet.geom.rows.map((r, ri) =>
                  r.cells.map((cell, ci) => (
                    <g key={`${ri}-${ci}`}>
                      <rect x={cell[0]} y={r.y0} width={cell[1] - cell[0]} height={r.y1 - r.y0} fill="none" stroke="#ffffff" strokeOpacity={0.85} strokeWidth={2.6} vectorEffect="non-scaling-stroke" />
                      <rect x={cell[0]} y={r.y0} width={cell[1] - cell[0]} height={r.y1 - r.y0} fill="none" stroke="var(--ink)" strokeOpacity={0.9} strokeWidth={1.1} vectorEffect="non-scaling-stroke" />
                    </g>
                  )),
                )}
              </svg>
            </div>
            <div className="fh-mono" style={{ fontSize: 10.5, color: 'var(--ink-faint)', marginTop: 6, lineHeight: 1.5 }}>
              The boxes are the cells the maker found, row by row. If one misses a letter or splits it, fix the charset rows below or nudge the threshold.
            </div>
          </div>
        )}

        <div style={{ marginTop: 22 }}>
          <label className="fh-mono" style={{ fontSize: 11, letterSpacing: '.06em', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 7 }}>
            <span style={{ color: 'var(--ink-faint)' }}>CHARSET · one row per line</span>
            <span style={{ color: detectedRows != null && detectedRows !== parseCharset(charsetText).length ? 'var(--signal)' : 'var(--ink-faint)' }}>
              {parseCharset(charsetText).length} rows{detectedRows != null ? ` · ${detectedRows} detected` : ''}
            </span>
          </label>
          <textarea
            className="fh-input"
            style={{ width: '100%', resize: 'vertical', minHeight: 92, fontFamily: 'var(--mono)', fontSize: 12.5, lineHeight: 1.6, whiteSpace: 'pre', overflowWrap: 'normal' }}
            value={charsetText}
            spellCheck={false}
            aria-label="Charset, one row of characters per line"
            onChange={(e) => setCharsetText(e.target.value)}
          />
          <div className="fh-mono" style={{ fontSize: 10.5, color: 'var(--ink-faint)', marginTop: 6, lineHeight: 1.5 }}>
            Match these rows to what is on your sheet, top to bottom. The maker maps row by row.
          </div>
        </div>

        <div style={{ marginTop: 22 }}>
          <label htmlFor="font-name" className="fh-mono" style={{ fontSize: 11, color: 'var(--ink-faint)', letterSpacing: '.06em', display: 'block', marginBottom: 7 }}>
            NAME
          </label>
          <input
            id="font-name"
            className="fh-input"
            style={{ width: '100%' }}
            value={family}
            onChange={(e) => setFamily(e.target.value)}
            placeholder="your font's name"
          />
        </div>

        {/* advanced: trace preset (mono) or colour knobs */}
        <div style={{ marginTop: 20, borderTop: '1px solid var(--line)', paddingTop: 14 }}>
          <button
            onClick={() => setShowAdvanced((v) => !v)}
            className="fh-mono"
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: 'var(--ink-soft)', letterSpacing: '.04em', padding: 0, display: 'flex', alignItems: 'center', gap: 8 }}
          >
            <span style={{ color: 'var(--ink-faint)', display: 'inline-block', transform: showAdvanced ? 'rotate(45deg)' : 'none', transition: 'transform var(--dur) var(--ease)' }}>+</span>
            advanced
          </button>
          {showAdvanced && (
            <div style={{ marginTop: 12 }}>
              {!isColor ? (
                <div>
                  <label className="fh-mono" style={{ fontSize: 10.5, color: 'var(--ink-faint)', letterSpacing: '.06em', display: 'block', marginBottom: 7 }}>TRACE PRESET</label>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {(['glyph', 'logo', 'sketch'] as const).map((p) => (
                      <button key={p} type="button" aria-pressed={preset === p} onClick={() => setPreset(p)} className="fh-mono" style={{ fontSize: 11.5, padding: '6px 12px', borderRadius: 2, cursor: 'pointer', border: `1px solid ${preset === p ? 'var(--ink)' : 'var(--line-2)'}`, background: preset === p ? 'var(--ink)' : 'var(--paper)', color: preset === p ? 'var(--paper)' : 'var(--ink-soft)' }}>{p}</button>
                    ))}
                  </div>
                  <p className="fh-mono" style={{ fontSize: 10, color: 'var(--ink-faint)', marginTop: 7, lineHeight: 1.5 }}>glyph for clean letters, logo for bolder art, sketch for rough or hand-drawn.</p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
                  {kind === 'flat' && <RangeRow label="colours (K)" min={2} max={6} value={colorOpts.K ?? 3} onChange={(v) => setColorOpts((o) => ({ ...o, K: v }))} />}
                  {kind === 'gradient' && <RangeRow label="gradient stops" min={2} max={8} value={colorOpts.stops ?? 5} onChange={(v) => setColorOpts((o) => ({ ...o, stops: v }))} />}
                  <RangeRow label="background" min={6} max={40} value={colorOpts.bgDist ?? 20} onChange={(v) => setColorOpts((o) => ({ ...o, bgDist: v }))} />
                  {kind === 'gradient' && (
                    <div style={{ display: 'flex', gap: 10 }}>
                      <ToggleRow label="outline" on={!!colorOpts.outline} onChange={(v) => setColorOpts((o) => ({ ...o, outline: v }))} />
                      <ToggleRow label="gloss" on={!!colorOpts.gloss} onChange={(v) => setColorOpts((o) => ({ ...o, gloss: v }))} />
                    </div>
                  )}
                </div>
              )}
              <div style={{ marginTop: 13, paddingTop: 12, borderTop: '1px solid var(--line)' }}>
                <ToggleRow label="fine detail" on={fineDetail} onChange={setFineDetail} />
                <p className="fh-mono" style={{ fontSize: 10, color: 'var(--ink-faint)', marginTop: 7, lineHeight: 1.5 }}>
                  resample each letter at higher resolution before tracing, so serifs and sharp corners survive. Slower.
                </p>
              </div>
              {lastImgRef.current && (
                <button className="fh-btn fh-btn--ghost" disabled={phase === 'working'} onClick={rebuild} style={{ marginTop: 12 }}>
                  rebuild with these settings
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* right: build readout + result */}
      <div style={{ padding: '26px 32px 30px', background: 'var(--paper-2)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <span className="fh-eyebrow">02 · the build</span>
          <span className="fh-mono" style={{ fontSize: 11, color: 'var(--ink-faint)' }}>honest readout · real work</span>
        </div>

        {/* dark terminal readout */}
        <div role="status" aria-live="polite" aria-label="Build progress" style={{ background: 'var(--ink)', borderRadius: 3, padding: '16px 18px', fontFamily: 'var(--mono)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <span style={{ fontSize: 10.5, letterSpacing: '.14em', textTransform: 'uppercase', color: 'rgba(255,255,255,.62)' }}>
              build · fonthead maker
            </span>
            <span style={{ fontSize: 11, color: phase === 'done' ? '#6fcf97' : phase === 'error' ? 'var(--signal)' : 'rgba(255,255,255,.55)' }}>
              {phase === 'done' ? `done · ${elapsed.toFixed(1)}s` : phase === 'working' ? 'running' : phase === 'error' ? 'failed' : 'idle'}
            </span>
          </div>
          {stages.map((s, i) => {
            const st = stageStateOf(i);
            return (
              <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '6px 0', fontSize: 12.5, opacity: st === 'queued' ? 0.55 : 1, transition: 'opacity .3s var(--ease)' }}>
                <span style={{ width: 13, color: st === 'done' ? '#6fcf97' : st === 'active' ? 'var(--signal)' : 'rgba(255,255,255,.62)' }}>
                  {st === 'done' ? '✓' : st === 'active' ? '●' : '·'}
                </span>
                <span style={{ width: 74, color: '#fff' }}>{s.label}</span>
                <span style={{ flex: 1, minWidth: 0, color: 'rgba(255,255,255,.66)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {st === 'active' && log ? log : s.desc}
                </span>
                <span style={{ color: 'rgba(255,255,255,.62)', width: 30, textAlign: 'right' }}>
                  {st === 'done' ? '✓' : st === 'active' ? '···' : '–'}
                </span>
              </div>
            );
          })}
          <div style={{ height: 2, background: 'rgba(255,255,255,.12)', marginTop: 12, borderRadius: 2, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${Math.max(0, Math.min(100, ((stageIdx + 1) / stages.length) * 100))}%`, background: 'var(--signal)', transition: 'width .4s var(--ease)' }} />
          </div>
        </div>

        {/* warning: the font built, but something looks off (row mismatch, lost counters).
            Only while showing a built result – never alongside an error from a later attempt. */}
        {warning && phase === 'done' && (
          <div
            className="fh-mono"
            style={{
              marginTop: 16,
              padding: '11px 13px',
              borderRadius: 2,
              background: '#fbf0db',
              border: '1px solid #e6c27e',
              color: '#7a5b18',
              fontSize: 11.5,
              lineHeight: 1.5,
              display: 'flex',
              gap: 9,
            }}
          >
            <span aria-hidden="true">▲</span>
            <span>{warning}</span>
          </div>
        )}

        {/* result / preview */}
        <div style={{ marginTop: 16, minHeight: 92 }}>
          {phase === 'error' && (
            <p role="alert" className="fh-mono" style={{ fontSize: 12, color: 'var(--signal)', lineHeight: 1.5 }}>{error}</p>
          )}
          {phase === 'done' && result && (
            <div>
              {/* type into your freshly made font: the concept the rest of the site
                  is built on, on the screen where you actually make the font */}
              <div
                style={{
                  fontFamily: previewFam ? `'${previewFam}', var(--sans)` : 'var(--sans)',
                  fontSize: 60,
                  color: 'var(--ink)',
                  lineHeight: 1.04,
                  minHeight: 74,
                  wordBreak: 'break-word',
                }}
              >
                {previewText || family}
              </div>
              <input
                type="text"
                value={previewText}
                onChange={(e) => setPreviewText(e.target.value.slice(0, 60))}
                placeholder="type to preview your font"
                aria-label="Type to preview your font"
                className="fh-input"
                style={{ marginTop: 12, width: '100%', maxWidth: 340 }}
              />
              <div className="fh-mono" style={{ fontSize: 11, color: 'var(--ink-faint)', margin: '10px 0 14px' }}>
                {glyphCount} glyphs · {isColor ? `colour ${colrStatus === 'ok' ? 'COLR/CPAL ✓' : colrStatus || 'mono fallback'}` : 'traced'} · built in your browser
              </div>

              {/* glyph inspection grid: every glyph rendered in the built font + health badge */}
              {report.length > 0 && (
                <div style={{ margin: '0 0 16px' }}>
                  <div className="fh-mono" style={{ fontSize: 10.5, letterSpacing: '.06em', marginBottom: 8, display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--ink-faint)' }}>GLYPHS</span>
                    <span style={{ color: flaggedCount ? '#9a6a12' : '#2f6f5e' }}>{flaggedCount ? `${flaggedCount} flagged` : 'all clean'}</span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(42px, 1fr))', gap: 5 }}>
                    {report.map((g, i) => {
                      const flagged = g.flags.length > 0;
                      const dropped = g.status !== 'ok';
                      const border = dropped ? 'var(--line-2)' : flagged ? '#e6c27e' : 'var(--line)';
                      const tip = `${g.char}${g.flags.length ? ' · ' + g.flags.join(', ') : dropped ? ' · ' + g.status : ''}`;
                      return (
                        <div
                          key={i}
                          title={isColor ? `${tip} · click to fix` : tip}
                          onClick={isColor ? () => openEditor(i) : undefined}
                          role={isColor ? 'button' : undefined}
                          tabIndex={isColor ? 0 : undefined}
                          aria-label={isColor ? `Edit glyph ${g.char}${flagged ? ', flagged' : dropped ? `, ${g.status}` : ''}` : undefined}
                          onKeyDown={
                            isColor
                              ? (e) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    openEditor(i);
                                  }
                                }
                              : undefined
                          }
                          style={{ border: `1px solid ${editIdx === i ? 'var(--ink)' : border}`, borderRadius: 2, background: 'var(--paper)', aspectRatio: '1', display: 'grid', placeItems: 'center', position: 'relative', opacity: dropped ? 0.45 : 1, cursor: isColor ? 'pointer' : 'default' }}
                        >
                          <span style={{ fontFamily: previewFam ? `'${previewFam}', var(--sans)` : 'var(--sans)', fontSize: 24, lineHeight: 1 }}>{g.char}</span>
                          {(flagged || dropped) && (
                            <span style={{ position: 'absolute', top: 2, right: 3, width: 5, height: 5, borderRadius: '50%', background: dropped ? 'var(--ink-faint)' : '#d8a45a' }} />
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* per-glyph editor: re-trace / re-slice / exclude, re-assembles instantly */}
                  {isColor && editIdx != null && report[editIdx] && (
                    <div style={{ marginTop: 12, padding: '14px', border: '1px solid var(--line-2)', borderRadius: 3, background: 'var(--paper)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 12 }}>
                        <div style={{ width: 60, height: 60, border: '1px solid var(--line)', borderRadius: 2, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                          <span style={{ fontFamily: previewFam ? `'${previewFam}', var(--sans)` : 'var(--sans)', fontSize: 38, lineHeight: 1 }}>{report[editIdx].char}</span>
                        </div>
                        <div style={{ flex: 1 }}>
                          <div className="fh-mono" style={{ fontSize: 12, color: 'var(--ink)' }}>
                            editing {report[editIdx].char}
                            {report[editIdx].flags.length ? ` · ${report[editIdx].flags.join(', ')}` : report[editIdx].status !== 'ok' ? ` · ${report[editIdx].status}` : ' · ok'}
                          </div>
                          <div className="fh-mono" style={{ fontSize: 10.5, color: 'var(--ink-faint)', marginTop: 3 }}>
                            re-trace to clear specks, re-slice to fix the cut, or exclude it
                          </div>
                        </div>
                        <button type="button" aria-label="Close glyph editor" className="fh-mono" onClick={() => { setEditIdx(null); setEditErr(''); }} style={{ background: 'none', border: '1px solid var(--line-2)', borderRadius: 2, padding: '4px 9px', fontSize: 14, cursor: 'pointer', color: 'var(--ink-soft)' }}><span aria-hidden="true">×</span></button>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 9 }}>
                        <span className="fh-mono" style={{ fontSize: 10.5, color: 'var(--ink-faint)', width: 48 }}>speckle</span>
                        <input type="range" aria-label="Speckle" className="fh-range" min={0} max={15} value={editTurd} onChange={(e) => setEditTurd(+e.target.value)} style={{ flex: 1 }} />
                        <span className="fh-mono" style={{ fontSize: 10.5, color: 'var(--ink-soft)', width: 18 }}>{editTurd}</span>
                        <button className="fh-btn fh-btn--ghost" disabled={editBusy} onClick={() => applyEdit('retrace')}>re-trace</button>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 11 }}>
                        <span className="fh-mono" style={{ fontSize: 10.5, color: 'var(--ink-faint)', width: 48 }}>edges</span>
                        <span className="fh-mono" style={{ fontSize: 10, color: 'var(--ink-faint)' }}>L</span>
                        <input type="range" aria-label="Left edge" className="fh-range" min={-40} max={40} value={editLeft} onChange={(e) => setEditLeft(+e.target.value)} style={{ flex: 1 }} />
                        <span className="fh-mono" style={{ fontSize: 10, color: 'var(--ink-faint)' }}>R</span>
                        <input type="range" aria-label="Right edge" className="fh-range" min={-40} max={40} value={editRight} onChange={(e) => setEditRight(+e.target.value)} style={{ flex: 1 }} />
                        <button className="fh-btn fh-btn--ghost" disabled={editBusy} onClick={() => applyEdit('reslice')}>re-slice</button>
                      </div>

                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <button className="fh-btn fh-btn--ghost" disabled={editBusy} onClick={() => applyEdit('exclude')}>
                          {report[editIdx].status === 'excluded' ? 'include' : 'exclude'}
                        </button>
                        {editBusy && <span className="fh-mono" style={{ fontSize: 11, color: 'var(--ink-faint)' }}>working…</span>}
                      </div>

                      {editErr && (
                        <p role="alert" className="fh-mono" style={{ fontSize: 11, color: 'var(--signal)', margin: '10px 0 0', lineHeight: 1.5 }}>{editErr}</p>
                      )}
                    </div>
                  )}

                  {/* mono per-row slicing: rescue a row whose cut came out wrong */}
                  {!isColor && monoRows.length > 0 && (
                    <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
                      <div className="fh-mono" style={{ fontSize: 10.5, letterSpacing: '.06em', marginBottom: 8, color: 'var(--ink-faint)' }}>
                        ROWS · re-slice any that came out wrong
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                        {monoRows.map((r) => {
                          const off = r.cellCount !== r.expected || r.forced;
                          const sel = rowSlicerSel[r.index] ?? 'auto';
                          const busy = rowBusy === r.index;
                          return (
                            <div key={r.index} style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap', padding: '7px 9px', border: `1px solid ${off ? '#e6c27e' : 'var(--line)'}`, borderRadius: 2, background: 'var(--paper)' }}>
                              <span className="fh-mono" style={{ fontSize: 11, color: 'var(--ink)', minWidth: 38 }}>row {r.index + 1}</span>
                              <span className="fh-mono" style={{ fontSize: 10.5, color: 'var(--ink-faint)', flex: 1, minWidth: 70, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.chars}</span>
                              <span className="fh-mono" style={{ fontSize: 10.5, color: off ? '#9a6a12' : '#2f6f5e' }}>
                                {r.cellCount}/{r.expected} · {r.slicer}{r.forced ? ' (forced)' : ''}
                              </span>
                              <select
                                value={sel}
                                disabled={busy}
                                aria-label={`Slicer for row ${r.index + 1}`}
                                onChange={(e) => setRowSlicerSel((m) => ({ ...m, [r.index]: e.target.value as SlicerKind }))}
                                className="fh-mono"
                                style={{ fontSize: 10.5, padding: '4px 6px', border: '1px solid var(--line-2)', borderRadius: 2, background: 'var(--paper)', color: 'var(--ink-soft)', cursor: 'pointer' }}
                              >
                                <option value="auto">auto</option>
                                <option value="whitespace">whitespace</option>
                                <option value="anchored">anchored</option>
                                <option value="components">components</option>
                                <option value="ownership">ownership</option>
                              </select>
                              <button className="fh-btn fh-btn--ghost" disabled={busy} onClick={() => applyRowEdit(r.index, sel)}>
                                {busy ? 'slicing…' : 're-slice'}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                      {rowErr && (
                        <p role="alert" className="fh-mono" style={{ fontSize: 11, color: 'var(--signal)', margin: '9px 0 0', lineHeight: 1.5 }}>{rowErr}</p>
                      )}
                      <div className="fh-mono" style={{ fontSize: 10, color: 'var(--ink-faint)', marginTop: 8, lineHeight: 1.5 }}>
                        whitespace cuts on the gaps, anchored forces the exact count, components splits touching letters. A forced row means the gap cut missed the count.
                      </div>
                    </div>
                  )}
                </div>
              )}

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
                        aria-label="Card word (optional)"
                      />
                      <div role="group" aria-label="Visibility" style={{ display: 'flex', border: '1px solid var(--line-2)', borderRadius: 2, overflow: 'hidden' }}>
                        {(['public', 'private'] as const).map((v) => (
                          <button
                            key={v}
                            type="button"
                            aria-pressed={visibility === v}
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
                      <p role="alert" className="fh-mono" style={{ fontSize: 11.5, color: 'var(--signal)', marginTop: 10 }}>{publishErr}</p>
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
