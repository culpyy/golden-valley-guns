// Shawn's own stock must lead the shop grid, ahead of the distributor
// catalog. Extracts shuffledByStockTier straight out of shop.html and runs it
// against fixtures, so the test checks the shipped code rather than a copy.
// Run: node .scratch/check-shop-order.mjs
import fs from 'node:fs';

const html = fs.readFileSync('shop.html', 'utf8');
const main = fs.readFileSync('js/main.js', 'utf8');

const grab = (src, name) => {
  const i = src.indexOf(`function ${name}(`);
  if (i < 0) throw new Error(`${name} not found`);
  let depth = 0, j = src.indexOf('{', i);
  for (let k = j; k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}' && --depth === 0) return src.slice(i, k + 1);
  }
  throw new Error(`${name} unbalanced`);
};

// Real implementations, pulled from the files that ship.
const fns = [grab(main, 'shuffle'), grab(main, 'mulberry32'), grab(html, 'itemSource'), grab(html, 'shuffledByStockTier')].join('\n');
const STOCK_ORDER_SRC = /const STOCK_ORDER = \{[^}]+\};/.exec(html)?.[0];
if (!STOCK_ORDER_SRC) throw new Error('STOCK_ORDER not found');

const run = new Function(`
  ${STOCK_ORDER_SRC}
  const SHUFFLE_SEED_TTL_MS = 180000;
  // Browser-only in the real page; fixed here so ordering is deterministic.
  function sessionShuffleSeed() { return 12345; }
  ${fns}
  return shuffledByStockTier;
`)();

let fail = 0;
const t = (name, cond, detail = '') => {
  if (cond) console.log('ok   ' + name);
  else { console.log(`FAIL ${name}${detail ? ': ' + detail : ''}`); fail++; }
};

const own = (n, stock) => ({ id: 'own' + n, name: 'Own ' + n, stock, _own: true });
const dist = (n, stock) => ({ id: 'd' + n, name: 'Dist ' + n, stock });

// A realistic mix: a handful of his items against a catalog that dwarfs them.
const items = [
  ...Array.from({ length: 200 }, (_, i) => dist(i, 'in_stock')),
  ...Array.from({ length: 50 }, (_, i) => dist(200 + i, 'out')),
  own(1, 'in_stock'), own(2, 'out'), own(3, 'limited'), own(4, 'in_stock'), own(5, 'call')
];
const out = run(items);

t('nothing is lost or duplicated', out.length === items.length && new Set(out.map(i => i.id)).size === items.length,
  `${out.length} of ${items.length}`);

const firstDist = out.findIndex(i => !i._own);
const lastOwn = out.map(i => !!i._own).lastIndexOf(true);
t('every one of his items precedes every distributor item', lastOwn < firstDist,
  `last own at ${lastOwn}, first distributor at ${firstDist}`);

t('his items fill the first page (24)', out.slice(0, 5).every(i => i._own),
  'first 5: ' + out.slice(0, 5).map(i => i.id).join(','));

const ownOrder = out.filter(i => i._own).map(i => i.stock);
t('within his items, in_stock leads and out sinks',
  ownOrder.indexOf('in_stock') < ownOrder.indexOf('limited') &&
  ownOrder.indexOf('limited') < ownOrder.indexOf('call') &&
  ownOrder.indexOf('call') < ownOrder.indexOf('out'), ownOrder.join(','));

const distOrder = out.filter(i => !i._own).map(i => i.stock);
t('distributor items keep their stock tiering', distOrder.lastIndexOf('in_stock') < distOrder.indexOf('out'),
  `last in_stock ${distOrder.lastIndexOf('in_stock')}, first out ${distOrder.indexOf('out')}`);

// Same seed must give the same order, or pagination would reshuffle mid-browse.
t('ordering is stable for a given seed', JSON.stringify(run(items).map(i => i.id)) === JSON.stringify(out.map(i => i.id)));

// An all-distributor catalog (nothing of his listed) must still work.
const noOwn = run(items.filter(i => !i._own));
t('handles a catalog with none of his own items', noOwn.length === 250);

// Unknown stock values fall into the last tier of their own group, not out of
// the array entirely.
const weird = run([own(9, undefined), dist(9, 'bogus'), own(10, 'in_stock')]);
t('unknown stock values still place', weird.length === 3 && weird[0].id === 'own10' && !weird[2]._own,
  weird.map(i => i.id + ':' + i.stock).join(' '));

console.log(fail ? `\n${fail} FAIL` : '\nshop ordering: his stock leads');
process.exit(fail ? 1 : 0);
