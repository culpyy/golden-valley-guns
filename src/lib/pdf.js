// Server-side PDF version of the shipping reference slip - mirrors the
// clean single-card look of intake.html's @media print stylesheet (plain
// white page, one bordered box, black text) rather than the site's own
// dark/gold theme, since this is meant to be printed on paper and put in a
// box, not viewed on screen.
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const PAGE_WIDTH = 612; // US Letter, points
const PAGE_HEIGHT = 792;
const MARGIN = 54;

function wrapText(text, font, size, maxWidth) {
  const words = text.split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export async function buildIntakeSlipPdf({ name, phone, email, intakeCode, serviceLabel, firearmType, caliber, isNfa, notes }) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const black = rgb(0, 0, 0);
  const gray = rgb(0.45, 0.45, 0.45);

  const left = MARGIN;
  const right = PAGE_WIDTH - MARGIN;
  const innerWidth = right - left;
  let y = PAGE_HEIGHT - MARGIN - 10;

  const hairline = (yPos) => page.drawLine({ start: { x: left, y: yPos }, end: { x: right, y: yPos }, thickness: 0.5, color: gray });
  const label = (text, yPos) => page.drawText(text, { x: left, y: yPos, size: 8, font: bold, color: gray });

  page.drawText('GOLDEN VALLEY GUNS LLC', { x: left, y, size: 18, font: bold, color: black });
  y -= 18;
  page.drawText('Shipping Reference Slip', { x: left, y, size: 10, font, color: gray });
  y -= 14;
  hairline(y);
  y -= 32;

  const codeBoxHeight = 58;
  page.drawRectangle({ x: left, y: y - codeBoxHeight, width: innerWidth, height: codeBoxHeight, borderColor: black, borderWidth: 1.5 });
  label('REFERENCE CODE', y - 20);
  page.drawText(intakeCode, { x: left + 14, y: y - 44, size: 22, font: bold, color: black });
  y -= codeBoxHeight + 24;

  page.drawText('Print this page and put it inside the box.', { x: left, y, size: 10, font: bold, color: black });
  y -= 28;

  label('SHIP TO', y);
  y -= 16;
  for (const line of ['Golden Valley Guns LLC', '7088 W Jupiter Dr', 'Golden Valley, AZ 86413']) {
    page.drawText(line, { x: left, y, size: 11, font, color: black });
    y -= 14;
  }
  y -= 14;

  label('FROM', y);
  y -= 16;
  for (const line of [name, phone, email].filter(Boolean)) {
    page.drawText(line, { x: left, y, size: 11, font, color: black });
    y -= 14;
  }
  y -= 12;

  hairline(y);
  y -= 24;

  label("WHAT YOU'RE SENDING", y);
  y -= 18;
  const detailCol2 = left + 130;
  const detailRow = (rowLabel, value) => {
    if (!value) return;
    page.drawText(rowLabel, { x: left, y, size: 10, font, color: gray });
    page.drawText(value, { x: detailCol2, y, size: 10, font, color: black });
    y -= 16;
  };
  detailRow('Service', serviceLabel);
  detailRow('Firearm Type', firearmType);
  detailRow('Caliber', caliber);
  detailRow('NFA Item', isNfa ? 'Yes' : '');

  if (notes) {
    page.drawText('Notes', { x: left, y, size: 10, font, color: gray });
    y -= 14;
    for (const line of wrapText(notes, font, 10, innerWidth - 4)) {
      page.drawText(line, { x: left, y, size: 10, font, color: black });
      y -= 13;
    }
    y -= 4;
  }

  y -= 10;
  hairline(y);
  y -= 20;
  page.drawText('Questions, or shipping an NFA item? Call or text (928) 727-0893.', { x: left, y, size: 9, font, color: gray });

  return doc.save();
}

function formatDate(d) {
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

// Server-side invoice PDF attached to order/payment confirmation emails
// (checkout.js, pay.js) - gives a purchase an official paper record beyond
// just the HTML email body, and for an FFL transfer, puts the receiving
// dealer's full address on record for the customer too, not just in
// Shawn's admin notification.
export async function buildInvoicePdf({
  orderNumber, date, customerName, customerEmail, customerPhone,
  items, subtotal, taxAmount, total,
  isFirearm, fulfillmentMethod, transferFfl, shippingMethod, shippingAddress
}) {
  const doc = await PDFDocument.create();
  let page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const black = rgb(0, 0, 0);
  const gray = rgb(0.45, 0.45, 0.45);

  const left = MARGIN;
  const right = PAGE_WIDTH - MARGIN;
  const innerWidth = right - left;
  let y = PAGE_HEIGHT - MARGIN - 10;

  const hairline = (yPos) => page.drawLine({ start: { x: left, y: yPos }, end: { x: right, y: yPos }, thickness: 0.5, color: gray });
  const label = (text, yPos) => page.drawText(text, { x: left, y: yPos, size: 8, font: bold, color: gray });
  const rightText = (text, yPos, size, f, color) => {
    page.drawText(text, { x: right - f.widthOfTextAtSize(text, size), y: yPos, size, font: f, color });
  };
  // A long cart (many line items, or long item names that wrap) can run
  // past the bottom of a single page - pdf-lib doesn't clip or warn, it
  // just draws at whatever y coordinate it's given, silently losing
  // content off the visible page. This starts a fresh page whenever the
  // next block wouldn't fit above the margin.
  const ensureSpace = (needed) => {
    if (y - needed < MARGIN) {
      page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      y = PAGE_HEIGHT - MARGIN - 10;
    }
  };

  page.drawText('GOLDEN VALLEY GUNS LLC', { x: left, y, size: 18, font: bold, color: black });
  rightText('INVOICE', y, 14, bold, gray);
  y -= 18;
  page.drawText('7088 W Jupiter Dr, Golden Valley, AZ 86413', { x: left, y, size: 9, font, color: gray });
  rightText(`Order #${orderNumber}`, y, 10, bold, black);
  y -= 13;
  rightText(formatDate(date), y, 9, font, gray);
  y -= 14;
  hairline(y);
  y -= 24;

  label('BILL TO', y);
  y -= 16;
  for (const line of [customerName, customerEmail, customerPhone].filter(Boolean)) {
    page.drawText(line, { x: left, y, size: 11, font, color: black });
    y -= 14;
  }
  y -= 10;
  hairline(y);
  y -= 22;

  const qtyColX = right - 190;
  const unitColX = right - 130;
  label('ITEM', y);
  page.drawText('QTY', { x: qtyColX, y, size: 8, font: bold, color: gray });
  page.drawText('PRICE', { x: unitColX, y, size: 8, font: bold, color: gray });
  rightText('TOTAL', y, 8, bold, gray);
  y -= 16;

  const nameMaxWidth = qtyColX - left - 10;
  for (const item of items) {
    const nameLines = wrapText(item.name, font, 10, nameMaxWidth);
    ensureSpace(13 * nameLines.length + 3);
    const lineTotal = item.price * item.qty;
    page.drawText(nameLines[0] || '', { x: left, y, size: 10, font, color: black });
    page.drawText(String(item.qty), { x: qtyColX, y, size: 10, font, color: black });
    page.drawText(`$${item.price.toFixed(2)}`, { x: unitColX, y, size: 10, font, color: black });
    rightText(`$${lineTotal.toFixed(2)}`, y, 10, font, black);
    y -= 13;
    for (const extra of nameLines.slice(1)) {
      page.drawText(extra, { x: left, y, size: 10, font, color: black });
      y -= 13;
    }
    y -= 3;
  }

  ensureSpace(60);
  y -= 6;
  hairline(y);
  y -= 20;

  const totalsRow = (rowLabel, value, isGrandTotal) => {
    const text = `${rowLabel}   $${value.toFixed(2)}`;
    rightText(text, y, isGrandTotal ? 12 : 10, isGrandTotal ? bold : font, isGrandTotal ? black : gray);
    y -= isGrandTotal ? 20 : 15;
  };
  totalsRow('Subtotal', subtotal, false);
  if (taxAmount > 0) totalsRow('AZ Sales Tax (5.6%)', taxAmount, false);
  totalsRow('Total', total, true);

  ensureSpace(130);
  y -= 8;
  hairline(y);
  y -= 22;

  if (isFirearm && fulfillmentMethod === 'ffl_transfer' && transferFfl) {
    label('TRANSFERRING TO', y);
    y -= 16;
    for (const line of [transferFfl.businessName, `FFL #${transferFfl.licenseNumber}`, transferFfl.phone, transferFfl.address]) {
      page.drawText(line, { x: left, y, size: 11, font, color: black });
      y -= 14;
    }
    y -= 4;
    for (const line of wrapText('A NICS background check and ATF Form 4473 are required in person before this firearm transfers to you.', font, 9, innerWidth)) {
      page.drawText(line, { x: left, y, size: 9, font, color: gray });
      y -= 12;
    }
  } else if (isFirearm) {
    label('PICKUP', y);
    y -= 16;
    for (const line of wrapText('Ready for pickup at our shop. A NICS background check and ATF Form 4473 are required in person before this firearm transfers to you.', font, 10, innerWidth)) {
      page.drawText(line, { x: left, y, size: 10, font, color: black });
      y -= 14;
    }
  } else if (shippingMethod === 'ship' && shippingAddress) {
    label('SHIP TO', y);
    y -= 16;
    for (const line of [shippingAddress.line1, shippingAddress.line2, `${shippingAddress.city}, ${shippingAddress.state} ${shippingAddress.zip}`].filter(Boolean)) {
      page.drawText(line, { x: left, y, size: 11, font, color: black });
      y -= 14;
    }
  } else {
    label('PICKUP', y);
    y -= 16;
    page.drawText('Ready for pickup at our shop whenever works for you.', { x: left, y, size: 10, font, color: black });
    y -= 14;
  }

  ensureSpace(50);
  y -= 14;
  hairline(y);
  y -= 20;
  page.drawText('Questions? Call or text (928) 727-0893.', { x: left, y, size: 9, font, color: gray });

  return doc.save();
}

export function bytesToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}
