import { useEffect, useState } from 'react';

// The masthead. One word, "fonthead", re-rendered every few seconds in a
// different face from the library. The only colour in the white room. This is
// the daily-feature slot; M1 cold-start cycles the house/seed set.

export interface HeroFace {
  id: string;
  family: string; // the @font-face family, e.g. fh-monoton
  name: string;
  designer: string;
  treat: 'normal' | 'gradient' | 'flat' | 'variable';
  grad?: string;
  flat?: string;
  varset?: string;
  italic?: boolean;
}

function faceStyle(f: HeroFace): React.CSSProperties {
  const s: React.CSSProperties = { fontFamily: `'${f.family}', var(--sans)` };
  if (f.italic) s.fontStyle = 'italic';
  if (f.treat === 'gradient' && f.grad) s.backgroundImage = f.grad;
  if (f.treat === 'flat' && f.flat) (s as Record<string, string>)['--specflat'] = f.flat;
  if (f.treat === 'variable' && f.varset) s.fontVariationSettings = f.varset;
  return s;
}

const faceClass = (f: HeroFace) =>
  'spec' + (f.treat === 'gradient' ? ' spec--gradient' : f.treat === 'flat' ? ' spec--flat' : '');

export default function CyclingWordmark({ faces }: { faces: HeroFace[] }) {
  const [i, setI] = useState(0);
  const [show, setShow] = useState(true);

  useEffect(() => {
    if (!faces.length) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) return;
    let idx = 0;
    const t = setInterval(() => {
      setShow(false);
      setTimeout(() => {
        idx = (idx + 1) % faces.length;
        setI(idx);
        setShow(true);
      }, 170);
    }, 2600);
    return () => clearInterval(t);
  }, [faces.length]);

  const f = faces[i] ?? faces[0];
  if (!f) return null;

  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ height: 210, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div
          className={faceClass(f)}
          style={{
            ...faceStyle(f),
            fontSize: 148,
            lineHeight: 0.9,
            whiteSpace: 'nowrap',
            opacity: show ? 1 : 0,
            transition: 'opacity .17s var(--ease)',
          }}
        >
          fonthead
        </div>
      </div>
      <div
        className="fh-mono"
        style={{
          marginTop: 8,
          fontSize: 12,
          color: 'var(--ink-faint)',
          letterSpacing: '.02em',
          display: 'flex',
          gap: 14,
          justifyContent: 'center',
          alignItems: 'center',
          height: 18,
        }}
      >
        <span>one word, every face on the wall</span>
        <span style={{ color: 'var(--line-3)' }}>·</span>
        <span
          style={{ color: 'var(--ink-soft)', opacity: show ? 1 : 0, transition: 'opacity .17s var(--ease)' }}
        >
          {f.name} · {f.designer}
        </span>
      </div>
    </div>
  );
}
