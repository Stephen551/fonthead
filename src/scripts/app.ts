// fonthead.dev — global client behavior, wired for View Transitions.
// One delegated listener handles favorite/vote across every page; lazy-font
// loading and the font-page size slider re-init on each navigation.
import { actions } from 'astro:actions';

const signedIn = () => document.body.dataset.signedIn === 'true';

// Send a signed-out visitor to sign in, remembering where they were so the
// vote/favorite they tried lands them back on the same font, not on /account.
function toSignIn() {
  const next = encodeURIComponent(location.pathname + location.search);
  window.location.href = '/sign-in?next=' + next;
}

// Announce a transient result to assistive tech via the global polite live
// region, so an optimistic toggle that rolls back is never silent.
function announce(msg: string) {
  const el = document.getElementById('fh-status');
  if (!el) return;
  el.textContent = '';
  window.setTimeout(() => {
    el.textContent = msg;
  }, 40);
}

// The vote count rolls on change: a short slide+fade (the .fh-count transition
// in CSS was declared but never triggered). Precise, no bounce.
function rollCount(el: HTMLElement, text: string) {
  el.style.transform = 'translateY(-0.4em)';
  el.style.opacity = '0';
  // swap once the out-transition has completed (matches the .13s in CSS), so the
  // roll reads as out-then-in rather than swapping mid-move.
  window.setTimeout(() => {
    el.textContent = text;
    el.style.transform = 'translateY(0)';
    el.style.opacity = '1';
  }, 140);
}

async function onFav(btn: HTMLElement) {
  if (!signedIn()) {
    toSignIn();
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
      announce('Could not update favorite, try again.');
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
    toSignIn();
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
      announce('Could not update the vote, try again.');
      return;
    }
    btn.classList.toggle('on', data.voted);
    btn.setAttribute('aria-pressed', String(data.voted));
    if (countEl) countEl.textContent = data.count.toLocaleString();
  } finally {
    delete btn.dataset.busy;
  }
}

// Report uses a styled, focus-managed dialog (never window.prompt, which breaks
// the visual language and blocks the thread). The dialog markup lives on the
// font page; this opens it, traps focus, and submits the reason to the action.
let reportBtn: HTMLElement | null = null;
let reportReturn: HTMLElement | null = null;

function onReport(btn: HTMLElement) {
  if (!signedIn()) {
    toSignIn();
    return;
  }
  const dlg = document.getElementById('fh-report');
  if (!dlg) return;
  reportBtn = btn;
  reportReturn = document.activeElement as HTMLElement | null;
  const ta = document.getElementById('fh-report-text') as HTMLTextAreaElement | null;
  const msg = document.getElementById('fh-report-msg');
  if (ta) ta.value = '';
  if (msg) msg.textContent = '';
  dlg.hidden = false;
  requestAnimationFrame(() => ta?.focus());
}

function closeReport() {
  const dlg = document.getElementById('fh-report');
  if (dlg) dlg.hidden = true;
  reportReturn?.focus?.();
  reportReturn = null;
}

async function submitReport() {
  const ta = document.getElementById('fh-report-text') as HTMLTextAreaElement | null;
  const msg = document.getElementById('fh-report-msg');
  const send = document.getElementById('fh-report-send') as HTMLButtonElement | null;
  const reason = (ta?.value || '').trim();
  if (!reason) {
    if (msg) msg.textContent = 'add a short reason';
    ta?.focus();
    return;
  }
  const id = reportBtn?.dataset.fontId;
  if (!id) return;
  if (send) send.disabled = true;
  const { data, error } = await actions.reportFont({ fontId: id, reason });
  if (send) send.disabled = false;
  if (error || !data) {
    if (msg) msg.textContent = 'report failed, try again';
    announce('Report failed, try again.');
    return;
  }
  if (reportBtn) reportBtn.textContent = 'reported, thank you';
  announce('Reported, thank you.');
  closeReport();
}

// Wire the report dialog once: send, cancel, close, Escape, backdrop, Tab-trap.
function wireReportOnce() {
  if ((window as Window & { __fhReport?: boolean }).__fhReport) return;
  (window as Window & { __fhReport?: boolean }).__fhReport = true;
  document.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('#fh-report-send')) return submitReport();
    if (t.closest('#fh-report-x') || t.closest('#fh-report-cancel')) return closeReport();
    const dlg = document.getElementById('fh-report');
    if (dlg && !dlg.hidden && t === dlg) closeReport(); // click the backdrop, not the card
  });
  document.addEventListener('keydown', (e) => {
    const dlg = document.getElementById('fh-report');
    if (!dlg || dlg.hidden) return;
    if (e.key === 'Escape') {
      closeReport();
      return;
    }
    if (e.key === 'Tab') {
      const f = Array.from(dlg.querySelectorAll<HTMLElement>('button, textarea, a[href]')).filter(
        (el) => !(el as HTMLButtonElement).disabled,
      );
      if (!f.length) return;
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  });
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
  // live face. The cycling keeps running while the field is focused, so the typed
  // word morphs across every face as you type (that is the whole promise).
  if (!spec.dataset.typeWired) {
    spec.dataset.typeWired = '1';
    spec.addEventListener('blur', () => {
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
    i = (i + 1) % faces.length;
    // While the visitor is typing, swap the face instantly: the crossfade would
    // blink their word out for a moment, so keep the text steady and just change
    // the face under it. When idle, use the soft crossfade.
    if (document.activeElement === spec) {
      applyFace(spec, cap, faces[i]);
      return;
    }
    spec.style.opacity = '0';
    if (cap) cap.style.opacity = '0';
    setTimeout(() => {
      applyFace(spec, cap, faces[i]);
      spec.style.opacity = '1';
      if (cap) cap.style.opacity = '1';
    }, 170);
  }, 2600);
}

// Governs the standalone type-into specimens (the wall feature band and the
// font page) the way the hero is: no newlines, single-line paste, and a hard
// length cap so an edit can never grow the layout unboundedly.
function wireTypeInto() {
  const els = document.querySelectorAll<HTMLElement>('[data-typeinto], #specimen');
  els.forEach((el) => {
    if (el.dataset.tiWired) return;
    el.dataset.tiWired = '1';
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        el.blur();
      }
    });
    el.addEventListener('paste', (e) => {
      e.preventDefault();
      const text = (e.clipboardData?.getData('text') || '').replace(/\s+/g, ' ').slice(0, 60);
      document.execCommand('insertText', false, text);
    });
    el.addEventListener('input', () => {
      const t = el.textContent || '';
      if (t.length > 60) {
        el.textContent = t.slice(0, 60);
        const r = document.createRange();
        r.selectNodeContents(el);
        r.collapse(false);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(r);
      }
    });
  });
}

// Support nudge: shown once per session after a font is downloaded (a click on a
// font page's .fh-dl link). The card only exists when COFFEE_URL is set in
// Base.astro, so this is inert until then. sessionStorage so it returns on a fresh
// visit, but not twice in a session. Deliberately NOT triggered on the maker page:
// a floating card there overlaps the publish/download controls and blocks them.
function wireCoffeeOnce() {
  const SEEN = 'fh-coffee-seen';
  const seen = () => {
    try {
      return !!sessionStorage.getItem(SEEN);
    } catch {
      return false;
    }
  };
  const mark = () => {
    try {
      sessionStorage.setItem(SEEN, '1');
    } catch {
      /* private mode: skip persistence */
    }
  };
  const show = () => {
    const c = document.getElementById('fh-coffee');
    if (!c || c.dataset.shown === '1' || seen()) return;
    c.dataset.shown = '1';
    c.hidden = false;
    requestAnimationFrame(() => c.classList.add('in'));
  };
  const dismiss = () => {
    mark();
    const c = document.getElementById('fh-coffee');
    if (c) {
      c.classList.remove('in');
      setTimeout(() => {
        c.hidden = true;
      }, 320);
    }
  };
  document.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('#fh-coffee-x')) return dismiss();
    if (t.closest('#fh-coffee-link')) return mark(); // clicked through; do not nag again
    if (t.closest('.fh-dl')) setTimeout(show, 500); // a font page download
  });
}

function init() {
  lazyFonts();
  wireSlider();
  wireHero();
  wireTypeInto();
}

// fires on initial load and after every View Transitions navigation
document.addEventListener('astro:page-load', init);
wireSocialOnce();
wireCoffeeOnce();
wireReportOnce();
