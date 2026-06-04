import { useEffect, useRef, useState } from 'react';

// The honest build readout: binarize, slice, trace, build, with a mechanical
// linear progress bar. In M1 this is a DESIGN PREVIEW with illustrative
// timings (no engine yet). M2 wires it to the real tracer running in a Web
// Worker and these numbers become real.

interface Step {
  k: string;
  d: string;
  t: number;
  ms: number;
}
const STEPS: Step[] = [
  { k: 'binarize', d: 'threshold · otsu adaptive', t: 1.1, ms: 1100 },
  { k: 'slice', d: '26 cells · baseline locked', t: 0.9, ms: 900 },
  { k: 'trace', d: 'contours · vectorise', t: 1.6, ms: 1600 },
  { k: 'build', d: 'metrics · pack otf woff2', t: 1.3, ms: 1300 },
];
const TOTAL = STEPS.reduce((a, s) => a + s.ms, 0);

export default function BuildReadout({ resultFamily }: { resultFamily?: string }) {
  const reduce =
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const [done, setDone] = useState(reduce ? STEPS.length : 0);
  const [run, setRun] = useState(0);
  const [prog, setProg] = useState(reduce ? 100 : 0);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (reduce) return;
    setDone(0);
    setProg(0);
    const raf = requestAnimationFrame(() => {
      if (barRef.current) barRef.current.style.transition = `width ${TOTAL}ms linear`;
      setProg(100);
    });
    let acc = 0;
    const timers: ReturnType<typeof setTimeout>[] = [];
    STEPS.forEach((s, i) => {
      acc += s.ms;
      timers.push(setTimeout(() => setDone(i + 1), acc));
    });
    return () => {
      cancelAnimationFrame(raf);
      timers.forEach(clearTimeout);
    };
  }, [run, reduce]);

  const finished = done >= STEPS.length;

  return (
    <div>
      <div style={{ background: 'var(--ink)', borderRadius: 3, padding: '16px 18px', fontFamily: 'var(--mono)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <span style={{ fontSize: 10.5, letterSpacing: '.14em', textTransform: 'uppercase', color: 'rgba(255,255,255,.4)' }}>
            build · preview
          </span>
          <span style={{ fontSize: 11, color: finished ? '#6fcf97' : 'rgba(255,255,255,.55)' }}>
            {finished ? 'done · 4.9s' : 'running'}
          </span>
        </div>
        {STEPS.map((s, i) => {
          const st = i < done ? 'done' : i === done ? 'active' : 'queued';
          return (
            <div
              key={s.k}
              style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '6px 0', fontSize: 12.5, opacity: st === 'queued' ? 0.38 : 1, transition: 'opacity .3s var(--ease)' }}
            >
              <span style={{ width: 13, color: st === 'done' ? '#6fcf97' : st === 'active' ? 'var(--signal)' : 'rgba(255,255,255,.5)' }}>
                {st === 'done' ? '✓' : st === 'active' ? '●' : '·'}
              </span>
              <span style={{ width: 74, color: '#fff' }}>{s.k}</span>
              <span style={{ flex: 1, color: 'rgba(255,255,255,.55)' }}>{s.d}</span>
              <span style={{ color: st === 'done' ? 'rgba(255,255,255,.55)' : st === 'active' ? 'var(--signal)' : 'rgba(255,255,255,.35)', width: 46, textAlign: 'right' }}>
                {st === 'done' ? s.t.toFixed(1) + 's' : st === 'active' ? '···' : '—'}
              </span>
            </div>
          );
        })}
        <div style={{ height: 2, background: 'rgba(255,255,255,.12)', marginTop: 12, borderRadius: 2, overflow: 'hidden' }}>
          <div ref={barRef} style={{ height: '100%', width: prog + '%', background: 'var(--signal)' }} />
        </div>
      </div>

      <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ height: 64, display: 'flex', alignItems: 'center' }}>
          <span
            className="spec"
            style={{
              fontFamily: resultFamily ? `'${resultFamily}', var(--sans)` : 'var(--sans)',
              fontSize: 52,
              color: 'var(--ink)',
              opacity: finished ? 1 : 0.25,
              filter: finished ? 'none' : 'blur(2px)',
              transition: 'opacity .5s var(--ease), filter .5s var(--ease)',
            }}
          >
            Handmade
          </span>
        </div>
        <button
          onClick={() => setRun((r) => r + 1)}
          className="fh-mono"
          style={{ fontSize: 11.5, color: 'var(--ink-soft)', background: 'none', border: '1px solid var(--line-2)', borderRadius: 2, padding: '7px 12px', cursor: 'pointer' }}
        >
          ↺ replay
        </button>
      </div>
    </div>
  );
}
