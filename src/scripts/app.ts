// fonthead.dev — global client behaviour, wired for View Transitions.
// One delegated listener handles favorite/vote across every page; lazy-font
// loading and the font-page size slider re-init on each navigation.
import { actions } from 'astro:actions';

const signedIn = () => document.body.dataset.signedIn === 'true';

// The vote count rolls on change: a short slide+fade (the .fh-count transition
// in CSS was declared but never triggered). Precise, no bounce.
function rollCount(el: HTMLElement, text: string) {
  el.style.transform = 'translateY(-0.5em)';
  el.style.opacity = '0';
  window.setTimeout(() => {
    el.textContent = text;
    el.style.transform = 'translateY(0)';
    el.style.opacity = '1';
  }, 120);
}

async function onFav(btn: HTMLElement) {
  if (!signedIn()) {
    window.location.href = '/sign-in';
    return;
  }
  if (btn.dataset.busy) return; // ignore a second click while the first is in flight
  btn.dataset.busy = '1';
  const id = btn.dataset.fontId!;
  const was = btn.classList.contains('on');
  btn.classList.toggle('on', !was);
  btn.setAttribute('aria-pressed', String(!was));
  try {
    const { data, error } = await actions.toggleFavorite({ fontId: id });
    if (error || !data) {
      btn.classList.toggle('on', was);
      btn.setAttribute('aria-pressed', String(was));
      return;
    }
    btn.classList.toggle('on', data.favorited);
    btn.setAttribute('aria-pressed', String(data.favorited));
  } finally {
    delete btn.dataset.busy;
  }
}

async function onVote(btn: HTMLElement) {
  if (!signedIn()) {
    window.location.href = '/sign-in';
    return;
  }
  if (btn.dataset.busy) return; // ignore a second click while the first is in flight
  btn.dataset.busy = '1';
  const id = btn.dataset.fontId!;
  const countEl = btn.querySelector('[data-count]') as HTMLElement | null;
  const was = btn.classList.contains('on');
  const cur = parseInt((countEl?.textContent || '0').replace(/[^0-9]/g, ''), 10) || 0;
  btn.classList.toggle('on', !was);
  btn.setAttribute('aria-pressed', String(!was));
  if (countEl) rollCount(countEl, (cur + (was ? -1 : 1)).toLocaleString());
  try {
    const { data, error } = await actions.toggleVote({ fontId: id });
    if (error || !data) {
      btn.classList.toggle('on', was);
      btn.setAttribute('aria-pressed', String(was));
      if (countEl) countEl.textContent = cur.toLocaleString();
      return;
    }
    btn.classList.toggle('on', data.voted);
    btn.setAttribute('aria-pressed', String(data.voted));
    if (countEl) countEl.textContent = data.count.toLocaleString();
  } finally {
    delete btn.dataset.busy;
  }
}

async function onReport(btn: HTMLElement) {
  if (!signedIn()) {
    window.location.href = '/sign-in';
    return;
  }
  const id = btn.dataset.fontId!;
  const reason = window.prompt('What looks wrong with this font? A short reason helps.');
  if (!reason || !reason.trim()) return;
  btn.setAttribute('disabled', 'true');
  const { data, error } = await actions.reportFont({ fontId: id, reason: reason.trim() });
  if (error || !data) {
    btn.removeAttribute('disabled');
    btn.textContent = 'report failed, try again';
    return;
  }
  btn.textContent = 'reported, thank you';
}

function wireSocialOnce() {
  if ((window as Window & { __fhSocial?: boolean }).__fhSocial) return;
  (window as Window & { __fhSocial?: boolean }).__fhSocial = true;
  document.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const fav = t.closest('[data-fav]') as HTMLElement | null;
    const vote = t.closest('[data-vote]') as HTMLElement | null;
    const report = t.closest('[data-report]') as HTMLElement | null;
    if (fav) {
      e.preventDefault();
      onFav(fav);
    } else if (vote) {
      e.preventDefault();
      onVote(vote);
    } else if (report) {
      e.preventDefault();
      onReport(report);
    }
  });
}

function lazyFonts() {
  const els = document.querySelectorAll<HTMLElement>('.fh-card [data-font]');
  const apply = (el: HTMLElement) => {
    if (el.dataset.font) el.style.fontFamily = `'${el.dataset.font}', var(--sans)`;
  };
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(
      (entries, obs) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            apply(e.target as HTMLElement);
            obs.unobserve(e.target);
          }
        }
      },
      { rootMargin: '600px 0px' },
    );
    els.forEach((el) => {
      if (!el.dataset.lazyWired) {
        el.dataset.lazyWired = '1';
        io.observe(el);
      }
    });
  } else {
    els.forEach(apply);
  }
}

function wireSlider() {
  const slider = document.getElementById('size') as HTMLInputElement | null;
  const spec = document.getElementById('specimen') as HTMLElement | null;
  const out = document.getElementById('sizeval');
  if (slider && !slider.dataset.wired) {
    slider.dataset.wired = '1';
    slider.addEventListener('input', () => {
      if (spec) spec.style.fontSize = slider.value + 'px';
      if (out) out.textContent = slider.value + ' px';
    });
  }
}

interface Face {
  id: string;
  family: string;
  name: string;
  designer: string;
  treat: string;
  grad?: string;
  flat?: string;
  varset?: string;
  italic?: boolean;
}
let heroTimer: ReturnType<typeof setInterval> | null = null;
let heroPaused = false;

// Paint one face onto the masthead, leaving the (possibly user-typed) text alone.
// The caption credits the face and links to its page (built with textContent, so
// a user-controlled name can never inject markup).
function applyFace(spec: HTMLElement, cap: HTMLElement | null, f: Face) {
  spec.className = 'spec' + (f.treat === 'gradient' ? ' spec--gradient' : f.treat === 'flat' ? ' spec--flat' : '');
  spec.style.fontFamily = `'${f.family}', var(--sans)`;
  spec.style.fontStyle = f.italic ? 'italic' : 'normal';
  spec.style.backgroundImage = f.treat === 'gradient' && f.grad ? f.grad : '';
  spec.style.setProperty('--specflat', f.treat === 'flat' && f.flat ? f.flat : '');
  spec.style.fontVariationSettings = f.treat === 'variable' && f.varset ? f.varset : '';
  if (cap) {
    cap.textContent = '';
    const a = document.createElement('a');
    a.href = `/f/${f.id}`;
    a.textContent = f.name;
    a.style.color = 'inherit';
    a.style.textDecoration = 'none';
    cap.appendChild(a);
    cap.appendChild(document.createTextNode(` · ${f.designer}`));
  }
}

function wireHero() {
  if (heroTimer) {
    clearInterval(heroTimer);
    heroTimer = null;
  }
  const spec = document.getElementById('hero-spec');
  const cap = document.getElementById('hero-cap');
  const dataEl = document.getElementById('hero-faces');
  if (!spec || !dataEl) return;
  let faces: Face[] = [];
  try {
    faces = JSON.parse(dataEl.textContent || '[]');
  } catch {
    return;
  }

  // Type-into: the visitor types their own word and watches it render in every
  // live face. Wired regardless of reduced-motion (typing is not motion); the
  // cycling pauses while the field is focused so it never fights the typist.
  if (!spec.dataset.typeWired) {
    spec.dataset.typeWired = '1';
    spec.addEventListener('focus', () => {
      heroPaused = true;
    });
    spec.addEventListener('blur', () => {
      heroPaused = false;
      if (!spec.textContent || !spec.textContent.trim()) spec.textContent = 'fonthead';
    });
    spec.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        spec.blur();
      }
    });
    spec.addEventListener('paste', (e) => {
      e.preventDefault();
      const text = (e.clipboardData?.getData('text') || '').replace(/\s+/g, ' ').slice(0, 40);
      document.execCommand('insertText', false, text);
    });
  }

  // Credit the first face immediately so the caption is a live link from load.
  if (faces[0]) applyFace(spec, cap, faces[0]);
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  if (faces.length < 2) return;
  let i = 0;
  heroTimer = setInterval(() => {
    if (heroPaused || document.activeElement === spec) return;
    spec.style.opacity = '0';
    if (cap) cap.style.opacity = '0';
    setTimeout(() => {
      i = (i + 1) % faces.length;
      applyFace(spec, cap, faces[i]);
      spec.style.opacity = '1';
      if (cap) cap.style.opacity = '1';
    }, 170);
  }, 2600);
}

function init() {
  lazyFonts();
  wireSlider();
  wireHero();
}

// fires on initial load and after every View Transitions navigation
document.addEventListener('astro:page-load', init);
wireSocialOnce();
