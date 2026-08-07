// Shared building blocks for customer-facing HTML emails. Inline-styled
// throughout - email clients strip <style> blocks and ignore most external
// CSS, so every rule has to live on the element itself. Deliberately a
// single flat white card, not nested boxes, matching the print slip's
// clean look rather than the site's own dark/gold theme (this is read in
// an inbox, not on the page).
export function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Table-based (not div+max-width) so width actually holds in Outlook
// desktop, which largely ignores CSS max-width on block elements but
// respects a table's width attribute/style.
export function emailShell(innerHtml) {
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f4f4;">
  <tr>
    <td align="center" style="padding:32px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#ffffff;border:1px solid #dddddd;border-radius:6px;">
        <tr>
          <td style="padding:28px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
            <div style="color:#8B6914;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin-bottom:20px;">Golden Valley Guns LLC</div>
            ${innerHtml}
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`;
}

export function emailGreeting(firstName) {
  return `<p style="color:#1a1a1a;font-size:15px;margin:0 0 16px;">Hi ${escapeHtml(firstName)},</p>`;
}

export function emailParagraph(html) {
  return `<p style="color:#444444;font-size:14px;line-height:1.6;margin:0 0 16px;">${html}</p>`;
}

// A prominent single value - order number, price, reference code. Matches
// the intake email's reference-code treatment.
export function emailHighlight(value) {
  return `<div style="font-size:22px;font-weight:700;letter-spacing:1px;color:#1a1a1a;margin:0 0 16px;">${escapeHtml(value)}</div>`;
}

// Label/value rows for an order summary, shipping detail, etc. Rows is an
// array of [label, value] pairs; falsy values are skipped.
export function emailInfoBox(rows) {
  const lines = rows.filter(([, v]) => v).map(([label, value]) => `
    <tr>
      <td style="padding:4px 0;color:#888888;font-size:13px;">${escapeHtml(label)}</td>
      <td style="padding:4px 0;color:#1a1a1a;font-size:13px;text-align:right;">${escapeHtml(value)}</td>
    </tr>`).join('');
  return `
  <div style="background:#f8f8f8;border:1px solid #eeeeee;border-radius:6px;padding:16px;margin:0 0 16px;">
    <table role="presentation" style="width:100%;border-collapse:collapse;">${lines}</table>
  </div>`;
}

// A line-item list (qty, name, price) followed by subtotal/tax/total rows.
// `items` is [{ qty, name, price }]; `totals` is [[label, value], ...] in
// display order (e.g. Subtotal, Tax, Total) - last row is bolded as the
// grand total.
export function emailOrderSummary(items, totals) {
  const itemRows = items.map(i => `
    <tr>
      <td style="padding:6px 0;color:#1a1a1a;font-size:13px;">${i.qty} &times; ${escapeHtml(i.name)}</td>
      <td style="padding:6px 0;color:#1a1a1a;font-size:13px;text-align:right;white-space:nowrap;">$${i.price.toFixed(2)}${i.qty > 1 ? ' each' : ''}</td>
    </tr>`).join('');
  const totalRows = totals.filter(([, v]) => v != null).map(([label, value], idx, arr) => {
    const isLast = idx === arr.length - 1;
    const weight = isLast ? '700' : '400';
    const color = isLast ? '#1a1a1a' : '#666666';
    return `
    <tr>
      <td style="padding:4px 0;color:${color};font-size:13px;font-weight:${weight};border-top:${isLast ? '1px solid #eeeeee' : 'none'};padding-top:${isLast ? '8px' : '4px'};">${escapeHtml(label)}</td>
      <td style="padding:4px 0;color:${color};font-size:13px;font-weight:${weight};text-align:right;white-space:nowrap;border-top:${isLast ? '1px solid #eeeeee' : 'none'};padding-top:${isLast ? '8px' : '4px'};">$${value.toFixed(2)}</td>
    </tr>`;
  }).join('');
  return `
  <div style="background:#f8f8f8;border:1px solid #eeeeee;border-radius:6px;padding:16px;margin:0 0 16px;">
    <table role="presentation" style="width:100%;border-collapse:collapse;">${itemRows}${totalRows}</table>
  </div>`;
}

export function emailButton(url, label) {
  return `
  <table role="presentation" style="margin:0 0 16px;">
    <tr><td style="background:#8B6914;border-radius:6px;">
      <a href="${escapeHtml(url)}" style="display:inline-block;padding:12px 24px;color:#ffffff;font-size:14px;font-weight:700;text-decoration:none;">${escapeHtml(label)}</a>
    </td></tr>
  </table>
  <p style="color:#888888;font-size:12px;line-height:1.5;margin:0 0 16px;word-break:break-all;">Or paste this link into your browser: <a href="${escapeHtml(url)}" style="color:#8B6914;">${escapeHtml(url)}</a></p>`;
}

export function emailFooterNote(extraHtml = '') {
  return `<p style="color:#888888;font-size:13px;line-height:1.6;margin:20px 0 0;">${extraHtml}Questions? Call or text us at <a href="tel:9287270893" style="color:#8B6914;text-decoration:none;">(928) 727-0893</a>.</p>`;
}
