// Age gate
const ageGate = document.getElementById('ageGate');
const ageGateEnter = document.getElementById('ageGateEnter');
if (ageGateEnter) {
  ageGateEnter.addEventListener('click', () => {
    localStorage.setItem('gvg_age_verified', 'true');
    ageGate.style.display = 'none';
    document.body.style.overflow = '';
  });
}

// Escape untrusted strings before interpolating into innerHTML/attributes.
// Needed anywhere data can come from outside admin-typed content - e.g. the
// synced distributor catalog - since a raw " or < in a feed value could
// break out of an attribute or inject markup otherwise.
function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// Shared by shop.html and out-of-stock.html (both render the same
// .part-card grid over the same distributor_products_public rows) - was
// duplicated verbatim across both files until a code review flagged the
// drift risk of fixing a bug in one copy and not the other.
//
// Missing/broken images fall back to a plain placeholder instead of a
// broken-image icon - distributor feeds frequently have gaps or dead links.
// Placeholder div is always rendered (hidden by CSS by default) rather than
// injected via onerror, since building nested-quote HTML inside an inline
// event-handler attribute is a real corruption risk - a stray unescaped
// quote there closes the attribute early and can prematurely close the
// surrounding .part-card itself.
function imageHtml(url, alt) {
  if (!url) return '<div class="part-img-wrap"><div class="part-img-placeholder">No Image</div></div>';
  return `<div class="part-img-wrap">
    <img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" loading="lazy" onerror="this.parentElement.classList.add('img-error'); this.remove();">
    <div class="part-img-placeholder">No Image</div>
  </div>`;
}

function itemSearchText(item) {
  return `${item.name} ${item.manufacturer || ''} ${item.caliber || ''}`.toLowerCase();
}

// Fisher-Yates - used for browse-order variety (see shop.html's
// shuffledByStockTier) rather than sorting alphabetically, which clustered
// every numeric-model-name item (Ruger's "10/22 ...", "101 ...") at the top
// of every single page load. rng defaults to Math.random but accepts a
// seeded generator (see mulberry32/sessionShuffleSeed below) so the same
// order can be reproduced across reloads within a browsing session.
function shuffle(arr, rng = Math.random) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Small, fast, deterministic PRNG seeded from a single integer - real bug
// found live: shop.html/out-of-stock.html originally reshuffled with plain
// Math.random() on every loadShop() call, including a same-tab reload or a
// browser back/forward that doesn't restore from bfcache. A customer who
// paged to page 2, navigated away, and came back landed on a completely
// different page 1/2 with no way to find what they'd been looking at.
// Caching the shuffled item array itself isn't viable as the fix - a live
// probe on shop.html's ~26k-item catalog found it serializes to ~8.2MB,
// well past sessionStorage's real-world quota (throws QuotaExceededError),
// so that write was silently failing 100% of the time already. A tiny
// persisted seed avoids that entirely: reusing it reproduces the identical
// shuffle order deterministically without storing any item data at all.
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Returns the same numeric seed for storageKey until ttlMs elapses (so
// browse order still refreshes periodically, matching the original
// freshness goal), generating and persisting a new one otherwise. Falls
// back to an unpersisted seed if sessionStorage is unavailable (private
// browsing, quota) - shuffle order just won't survive a reload in that case.
function sessionShuffleSeed(storageKey, ttlMs) {
  try {
    const raw = sessionStorage.getItem(storageKey);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Date.now() - parsed.savedAt < ttlMs) return parsed.seed;
    }
  } catch {}
  const seed = Math.floor(Math.random() * 2 ** 31) || 1;
  try { sessionStorage.setItem(storageKey, JSON.stringify({ seed, savedAt: Date.now() })); } catch {}
  return seed;
}

// Build pipeline stages - single source of truth, shared by index.html
// (homepage build preview), admin-dashboard.html, and track.html so the
// stage list and progress math can't drift between them.
// 'in-progress' was removed as a pipeline stage (2026-07-21) - Weld/
// Machining/Blasting/Refinishing replaced it with actual granular progress
// instead of one vague bucket sitting next to four specific ones. Its
// label/description entries stay below (but out of the stage arrays and
// admin-dashboard.html's status <select>) purely so any build a stage
// migration hasn't reached yet still renders a real word instead of
// "undefined" - it's no longer a selectable or pipeline-tracked status.
const BUILD_STAGES_NFA = ['intake', 'queued', 'parts-ordered', 'weld', 'machining', 'blasting', 'refinishing', 'testing', 'atf-filed', 'atf-approved', 'ready'];
const BUILD_STAGES_STD = ['intake', 'queued', 'parts-ordered', 'weld', 'machining', 'blasting', 'refinishing', 'testing', 'ready'];

const STATUS_LABELS = {
  'intake': 'Intake', 'queued': 'In Queue', 'parts-ordered': 'Parts Ordered', 'in-progress': 'In Progress',
  'weld': 'Weld', 'machining': 'Machining', 'blasting': 'Blasting', 'refinishing': 'Refinishing',
  'testing': 'Testing', 'atf-filed': 'ATF Filed', 'atf-approved': 'ATF Approved', 'ready': 'Ready'
};

const STATUS_DESCRIPTIONS = {
  'intake':        'Checked in, being assessed',
  'queued':        'Waiting for shop time, nothing started yet',
  'parts-ordered': 'Waiting on parts',
  'in-progress':   'On the bench',
  'weld':          'Welding',
  'machining':     'On the mill/lathe',
  'blasting':      'Media blasting',
  'refinishing':   'Coating/refinishing',
  'testing':       'Function check',
  'atf-filed':     'ATF pending approval',
  'atf-approved':  'ATF approved, ready to transfer',
  'ready':         'Done, ready for pickup'
};

function calcProgress(status, isNfa) {
  const stages = isNfa ? BUILD_STAGES_NFA : BUILD_STAGES_STD;
  const si = stages.indexOf(status);
  return si === -1 ? 0 : Math.round(((si + 1) / stages.length) * 100);
}

// Footer copyright year (avoids the site looking stale every January)
const copyYear = document.getElementById('copyYear');
if (copyYear) copyYear.textContent = new Date().getFullYear();

// Mobile nav toggle
const nav = document.querySelector('.nav');
const hamburger = document.querySelector('.hamburger');
if (hamburger) {
  hamburger.addEventListener('click', () => nav.classList.toggle('nav-mobile-open'));
}

// Mark active nav link + close mobile menu on tap
const links = document.querySelectorAll('.nav-links a');
links.forEach(link => {
  if (link.href === location.href) link.classList.add('active');
  link.addEventListener('click', () => nav.classList.remove('nav-mobile-open'));
});

// Lightbox
const lightbox = document.getElementById('lightbox');
if (lightbox) {
  const lbImg = lightbox.querySelector('.lb-img');
  const lbTitle = lightbox.querySelector('.lb-title');
  const lbSub = lightbox.querySelector('.lb-sub');

  document.querySelectorAll('.gallery-item[data-title]').forEach(item => {
    item.addEventListener('click', () => {
      const src = item.dataset.src;
      const title = item.dataset.title;
      const sub = item.dataset.sub;

      if (src) {
        lbImg.src = src;
        lbImg.alt = title || '';
        lbImg.style.display = '';
      } else {
        lbImg.style.display = 'none';
        lbImg.alt = '';
      }
      lbTitle.textContent = title || '';
      lbSub.textContent = sub || '';
      lightbox.classList.add('open');
      document.body.style.overflow = 'hidden';
    });
  });

  const closeLb = () => {
    lightbox.classList.remove('open');
    document.body.style.overflow = '';
  };

  lightbox.querySelector('.lightbox-close').addEventListener('click', closeLb);
  lightbox.addEventListener('click', e => { if (e.target === lightbox) closeLb(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeLb(); });
}

// Gallery filter
const filterBtns = document.querySelectorAll('.filter-btn');
if (filterBtns.length) {
  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      filterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const cat = btn.dataset.filter;
      document.querySelectorAll('.gallery-item').forEach(item => {
        const show = cat === 'all' || item.dataset.cat === cat;
        item.style.display = show ? '' : 'none';
      });
    });
  });
}

// Contact form - submits to our own /api/contact (Cloudflare Worker + Email
// Routing), not a third-party form service. Replaced Formspree 2026-07-19 -
// it was still pointed at a placeholder form ID that was never swapped for
// a real one, so every submission through this form silently/visibly failed.
const form = document.getElementById('contactForm');
if (form) {
  form.addEventListener('submit', e => {
    e.preventDefault();
    const btn = form.querySelector('button[type="submit"]');
    const originalText = btn.textContent;
    btn.textContent = 'Sending...';
    btn.disabled = true;

    const data = Object.fromEntries(new FormData(form));
    fetch('/api/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
      .then(res => {
        if (!res.ok) throw new Error('Submission failed');
        btn.textContent = 'Message Sent';
        btn.style.background = '#1a5c1a';
        btn.style.borderColor = '#1a5c1a';
        setTimeout(() => {
          btn.textContent = originalText;
          btn.style.background = '';
          btn.style.borderColor = '';
          btn.disabled = false;
          form.reset();
        }, 3000);
      })
      .catch(() => {
        btn.textContent = 'Something went wrong, call us instead';
        btn.style.background = '#8a1a1a';
        btn.style.borderColor = '#8a1a1a';
        setTimeout(() => {
          btn.textContent = originalText;
          btn.style.background = '';
          btn.style.borderColor = '';
          btn.disabled = false;
        }, 4000);
      });
  });
}
