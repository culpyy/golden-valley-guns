// Cart state for the Authorize.net checkout flow. localStorage-backed, no
// server round-trip until checkout.html submits to /api/checkout - prices
// shown here are for display only, the Worker re-prices everything against
// Supabase before charging the card (see src/api/checkout.js).
//
// Only Shawn's own hand-curated parts (products table, category != 'firearms')
// ever get an Add to Cart button (see shop.html's productCardHtml) - this
// module itself doesn't enforce that, it just stores whatever it's given.

const CART_KEY = 'gvg_cart';

function getCart() {
  try {
    const raw = localStorage.getItem(CART_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveCart(cart) {
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
  document.dispatchEvent(new CustomEvent('cart:updated', { detail: { cart } }));
}

// item: { id, name, price, image_url }
function addToCart(item, qty = 1) {
  const cart = getCart();
  const existing = cart.find(i => i.id === item.id);
  if (existing) {
    existing.qty += qty;
  } else {
    cart.push({ id: item.id, name: item.name, price: parseFloat(item.price), image_url: item.image_url || null, qty });
  }
  saveCart(cart);
}

function removeFromCart(id) {
  saveCart(getCart().filter(i => i.id !== id));
}

function updateQty(id, qty) {
  const cart = getCart();
  const item = cart.find(i => i.id === id);
  if (!item) return;
  if (qty < 1) {
    saveCart(cart.filter(i => i.id !== id));
    return;
  }
  item.qty = qty;
  saveCart(cart);
}

function clearCart() {
  saveCart([]);
}

function cartTotal() {
  return getCart().reduce((sum, i) => sum + i.price * i.qty, 0);
}

function cartCount() {
  return getCart().reduce((sum, i) => sum + i.qty, 0);
}

// Every page that includes cart.js gets a live badge on any element with
// [data-cart-count] - shop.html's nav is the main consumer, but cart.html and
// checkout.html link back through the same nav markup so this just works there too.
function renderCartBadge() {
  const count = cartCount();
  document.querySelectorAll('[data-cart-count]').forEach(el => {
    el.textContent = count;
    el.style.display = count > 0 ? 'flex' : 'none';
  });
}

document.addEventListener('cart:updated', renderCartBadge);
document.addEventListener('DOMContentLoaded', renderCartBadge);
