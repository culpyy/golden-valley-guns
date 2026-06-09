const PRODUCTS = [
  {
    id: 'geissele-ssa-e',
    name: 'Geissele SSA-E Trigger',
    cat: 'parts',
    desc: 'Super Semi-Automatic Enhanced. Two-stage flat bow. One of the best drop-in AR triggers on the market.',
    price: 240,
    badge: null,
    stock: 'in_stock'
  },
  {
    id: 'bcm-charging-handle',
    name: 'BCM Gunfighter Charging Handle',
    cat: 'parts',
    desc: 'Mod 4 medium latch. Mil-spec dimensions, commercial finish. Direct drop-in for standard AR-15 uppers.',
    price: 65,
    badge: null,
    stock: 'in_stock'
  },
  {
    id: 'magpul-moe-grip',
    name: 'Magpul MOE Pistol Grip',
    cat: 'parts',
    desc: 'Drop-in AR-15 / M16 grip. Aggressive texture, integrated storage compartment. Available in black and FDE.',
    price: 22,
    badge: 'new',
    stock: 'in_stock'
  },
  {
    id: 'bfg-vickers-sling',
    name: 'Blue Force Gear Vickers Sling',
    cat: 'accessories',
    desc: 'VCAS padded sling. Single-point and two-point configurable. Industry standard for a reason.',
    price: 70,
    badge: null,
    stock: 'in_stock'
  },
  {
    id: 'magpul-pmag-3pack',
    name: 'Magpul PMAG 30 — 3 Pack',
    cat: 'accessories',
    desc: 'Gen M3 30-round AR-15 / M4 magazines. Anti-tilt follower, constant-curve geometry. Comes in black.',
    price: 38,
    badge: null,
    stock: 'limited'
  },
  {
    id: 'magpul-ms1-sling',
    name: 'Magpul MS1 Sling',
    cat: 'accessories',
    desc: 'Convertible single-point / two-point sling. Nylon webbing, stainless hardware. Works on most platforms.',
    price: 36,
    badge: null,
    stock: 'in_stock'
  },
  {
    id: 'holosun-507c',
    name: 'Holosun 507C X2',
    cat: 'optics',
    desc: 'Red dot / circle-dot reticle. Solar + battery backup. Multi-reticle system. Compatible with most pistol cuts.',
    price: 280,
    badge: null,
    stock: 'in_stock'
  },
  {
    id: 'primary-arms-slx',
    name: 'Primary Arms SLx 1-6x ACSS',
    cat: 'optics',
    desc: '1-6x24 LPVO with ACSS reticle. True 1x at low end, illuminated. Strong choice for a do-everything AR setup.',
    price: 320,
    badge: 'new',
    stock: 'in_stock'
  },
  {
    id: 'otis-elite-cleaning',
    name: 'Otis Elite Cleaning System',
    cat: 'cleaning',
    desc: 'Breech-to-muzzle system for pistols, rifles, and shotguns. Compact case, everything you need to run a full cleaning.',
    price: 45,
    badge: null,
    stock: 'in_stock'
  },
  {
    id: 'slip-2000-ewl',
    name: 'Slip 2000 EWL Oil — 4oz',
    cat: 'cleaning',
    desc: 'Extreme weapons lubricant. Runs clean and stays put. Works in heat, cold, and dirty environments.',
    price: 14,
    badge: null,
    stock: 'in_stock'
  },
  {
    id: 'federal-556',
    name: 'Federal 5.56 NATO — 20rd',
    cat: 'ammo',
    desc: 'XM193 55gr FMJ. Standard velocity, brass case, boxer primed. Pickup only or local delivery — call to check availability.',
    price: 14,
    badge: null,
    stock: 'call'
  },
  {
    id: 'hornady-762x39',
    name: 'Hornady 7.62x39 — 20rd',
    cat: 'ammo',
    desc: 'SST 123gr. Steel case. Designed for the AK platform. Call ahead to confirm stock before ordering.',
    price: 18,
    badge: null,
    stock: 'call'
  }
];

const STOCK_CONFIG = {
  in_stock: { label: 'In Stock',      color: '#2d7a3a' },
  limited:  { label: 'Limited Stock', color: '#C8951A' },
  call:     { label: 'Call to Check', color: '#888888' },
  out:      { label: 'Out of Stock',  color: '#6b2222' }
};

const CAT_LABELS = {
  parts:       'Parts',
  accessories: 'Accessories',
  optics:      'Optics',
  cleaning:    'Cleaning',
  ammo:        'Ammo'
};
