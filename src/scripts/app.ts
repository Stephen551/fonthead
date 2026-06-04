// fonthead.dev — global client behaviour, wired for View Transitions.
// One delegated listener handles favorite/vote across every page; lazy-font
// loading and the font-page size slider re-init on each navigation.
import { actions } from 'astro:actions';

const signedIn = () => document.body.dataset.signedIn === 'true';

async function onFav(btn: HTMLElement) {
  if (!signedIn()) {
    window.location.href = '/sign-in';
    return;
  }
  const id = btn.dataset.fontId!;
  const was = btn.classList.contains('on');
  btn.classList.toggle('on', !was);
  btn.setAttribute('aria-pressed', String(!was));
  const { data, error } = await actions.toggleFavorite({ fontId: id });
  if (error || !data) {
    btn.classList.toggle('on', was);
    btn.setAttribute('aria-pressed', String(was));
    return;
  }
  btn.classList.toggle('on', data.favorited);
  btn.setAttribute('aria-pressed', String(data.favorited));
}

async function onVote(btn: HTMLElement) {
  if (!signedIn()) {
    window.location.href = '/sign-in';
    return;
  }
  const id = btn.dataset.fontId!;
  const countEl = btn.querySelector('[data-count]') as HTMLElement | null;
  const was = btn.classList.contains('on');
  const cur = parseInt((countEl?.textContent || '0').replace(/[^0-9]/g, ''), 10) || 0;
  btn.classList.toggle('on', !was);
  btn.setAttribute('aria-pressed', String(!was));
  if (countEl) countEl.textContent = (cur + (was ? -1 : 1)).toLocaleString();
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

function wireHero() {
  if (heroTimer) {
    clearInterval(heroTimer);
    heroTimer = null;
  }
  const spec = document.getElementById('hero-spec');
  const cap = document.getElementById('hero-cap');
  const dataEl = document.getElementById('hero-faces');
  if (!spec || !dataEl) return;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  let faces: Face[] = [];
  try {
    faces = JSON.parse(dataEl.textContent || '[]');
  } catch {
    return;
  }
  if (faces.length < 2) return;
  let i = 0;
  heroTimer = setInterval(() => {
    spec.style.opacity = '0';
    if (cap) cap.style.opacity = '0';
    setTimeout(() => {
      i = (i + 1) % faces.length;
      const f = faces[i];
      spec.className = 'spec' + (f.treat === 'gradient' ? ' spec--gradient' : f.treat === 'flat' ? ' spec--flat' : '');
      spec.style.fontFamily = `'${f.family}', var(--sans)`;
      spec.style.fontStyle = f.italic ? 'italic' : 'normal';
      spec.style.backgroundImage = f.treat === 'gradient' && f.grad ? f.grad : '';
      spec.style.setProperty('--specflat', f.treat === 'flat' && f.flat ? f.flat : '');
      spec.style.fontVariationSettings = f.treat === 'variable' && f.varset ? f.varset : '';
      if (cap) cap.textContent = `${f.name} · ${f.designer}`;
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
