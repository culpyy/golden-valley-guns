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
const BUILD_STAGES_NFA = ['intake', 'parts-ordered', 'weld', 'machining', 'blasting', 'refinishing', 'testing', 'atf-filed', 'atf-approved', 'ready'];
const BUILD_STAGES_STD = ['intake', 'parts-ordered', 'weld', 'machining', 'blasting', 'refinishing', 'testing', 'ready'];

const STATUS_LABELS = {
  'intake': 'Intake', 'parts-ordered': 'Parts Ordered', 'in-progress': 'In Progress',
  'weld': 'Weld', 'machining': 'Machining', 'blasting': 'Blasting', 'refinishing': 'Refinishing',
  'testing': 'Testing', 'atf-filed': 'ATF Filed', 'atf-approved': 'ATF Approved', 'ready': 'Ready'
};

const STATUS_DESCRIPTIONS = {
  'intake':        'Checked in — being assessed',
  'parts-ordered': 'Waiting on parts',
  'in-progress':   'On the bench',
  'weld':          'Welding',
  'machining':     'On the mill/lathe',
  'blasting':      'Media blasting',
  'refinishing':   'Coating/refinishing',
  'testing':       'Function check',
  'atf-filed':     'ATF pending approval',
  'atf-approved':  'ATF approved — ready to transfer',
  'ready':         'Done — ready for pickup'
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

// Fade-in on scroll
const observer = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.style.opacity = '1';
      entry.target.style.transform = 'translateY(0)';
    }
  });
}, { threshold: 0.08 });

document.querySelectorAll('.fade-in').forEach(el => {
  el.style.opacity = '0';
  el.style.transform = 'translateY(24px)';
  el.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
  observer.observe(el);
});

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
        btn.textContent = 'Something went wrong — call us instead';
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
