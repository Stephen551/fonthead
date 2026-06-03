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

function wireSocialOnce() {
  if ((window as Window & { __fhSocial?: boolean }).__fhSocial) return;
  (window as Window & { __fhSocial?: boolean }).__fhSocial = true;
  document.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const fav = t.closest('[data-fav]') as HTMLElement | null;
    const vote = t.closest('[data-vote]') as HTMLElement | null;
    if (fav) {
      e.preventDefault();
      onFav(fav);
    } else if (vote) {
      e.preventDefault();
      onVote(vote);
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

function init() {
  lazyFonts();
  wireSlider();
}

// fires on initial load and after every View Transitions navigation
document.addEventListener('astro:page-load', init);
wireSocialOnce();
