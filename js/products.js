const PRODUCTS = [
  {
    id: 'magpul-moe-grip',
    name: 'Magpul MOE Pistol Grip',
    cat: 'parts',
    desc: 'Drop-in AR-15 / M16 grip. Aggressive texture, storage compartment. Available in black and FDE.',
    price: 22,
    badge: null,
    stock: 'in_stock'
  },
  {
    id: 'magpul-pmag-3pack',
    name: 'Magpul PMAG 30 — 3 Pack',
    cat: 'parts',
    desc: 'Gen M3 30-round AR-15 / M4 magazines. Anti-tilt follower, constant-curve geometry. Black.',
    price: 38,
    badge: null,
    stock: 'limited'
  },
  {
    id: 'otis-elite-cleaning',
    name: 'Otis Elite Cleaning System',
    cat: 'parts',
    desc: 'Breech-to-muzzle cleaning for pistols, rifles, and shotguns. Everything you need in a compact case.',
    price: 45,
    badge: null,
    stock: 'in_stock'
  },
  {
    id: 'bcm-charging-handle',
    name: 'BCM Gunfighter Charging Handle',
    cat: 'parts',
    desc: 'Mod 4 medium latch. Mil-spec dimensions, commercial finish. Drop-in for standard AR-15 uppers.',
    price: 65,
    badge: null,
    stock: 'in_stock'
  }
];

const STOCK_CONFIG = {
  in_stock: { label: 'In Stock',      color: '#2d7a3a' },
  limited:  { label: 'Limited Stock', color: '#C8951A' },
  call:     { label: 'Call to Check', color: '#888888' },
  out:      { label: 'Out of Stock',  color: '#6b2222' }
};

const CAT_LABELS = {
  parts: 'Parts & Accessories'
};
