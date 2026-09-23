// "Find your dealer" typeahead for the FFL transfer form (pay.html and
// checkout.html). Searches the ATF snapshot via /api/ffl-search; picking a
// result fills the dealer fields, which stay editable for anyone whose
// dealer isn't listed.
(function () {
  const box = document.getElementById('fflSearch');
  const list = document.getElementById('fflSearchResults');
  if (!box || !list) return;
  let timer, seq = 0;

  function fill(r) {
    document.getElementById('fflBusinessName').value = r.businessName;
    document.getElementById('fflLicenseNumber').value = r.license;
    document.getElementById('fflPhone').value = r.phone;
    document.getElementById('fflAddress').value = r.address;
    box.value = r.businessName;
    list.style.display = 'none';
  }

  function render(results, q) {
    list.innerHTML = '';
    if (!results.length) {
      const li = document.createElement('div');
      li.style.cssText = 'padding:10px 12px;color:var(--muted);font-size:13px;';
      li.textContent = `No match for "${q}". Enter your dealer's details below instead.`;
      list.appendChild(li);
    }
    results.forEach(r => {
      const item = document.createElement('button');
      item.type = 'button';
      item.style.cssText = 'display:block;width:100%;text-align:left;padding:10px 12px;background:none;border:0;border-bottom:1px solid var(--border);color:inherit;cursor:pointer;font:inherit;';
      const name = document.createElement('strong');
      name.textContent = r.businessName;
      const addr = document.createElement('div');
      addr.style.cssText = 'font-size:12px;color:var(--muted);';
      addr.textContent = `${r.address}${r.phone ? ' · ' + r.phone : ''}`;
      item.append(name, addr);
      item.addEventListener('click', () => fill(r));
      list.appendChild(item);
    });
    list.style.display = 'block';
  }

  box.addEventListener('input', () => {
    clearTimeout(timer);
    const q = box.value.trim();
    if (q.length < 3) { list.style.display = 'none'; return; }
    timer = setTimeout(async () => {
      const mine = ++seq;
      try {
        const res = await fetch(`/api/ffl-search?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        if (mine === seq && res.ok) render(data.results || [], q);
      } catch { /* typeahead is a convenience; manual entry still works */ }
    }, 250);
  });
  document.addEventListener('click', e => { if (!list.contains(e.target) && e.target !== box) list.style.display = 'none'; });
})();
