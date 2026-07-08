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
        lbImg.style.display = '';
      } else {
        lbImg.style.display = 'none';
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

// Contact form (submits to Netlify Forms via AJAX so the page doesn't reload)
const form = document.getElementById('contactForm');
if (form) {
  form.addEventListener('submit', e => {
    e.preventDefault();
    const btn = form.querySelector('button[type="submit"]');
    const originalText = btn.textContent;
    btn.textContent = 'Sending...';
    btn.disabled = true;

    fetch('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(new FormData(form)).toString(),
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
