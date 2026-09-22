import { api, money, addToCart, siteConfig } from './site.js?v=2';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const root = document.querySelector('[data-product]');
const id = new URLSearchParams(location.search).get('id');

let product = null;
let currency = 'usd';
let selectedVariant = null;
let quantity = 1;

/**
 * Printify variant titles are "Color / Size" style. We split them into option
 * columns so the picker reads like a normal product page instead of a 40-item
 * dropdown, and disable combinations that don't exist.
 */
function variantParts(v) {
  return String(v.title).split('/').map((s) => s.trim());
}

function optionColumns() {
  const parts = product.variants.map(variantParts);
  const depth = Math.max(...parts.map((p) => p.length));
  const names = (product.options || []).map((o) => o.name);
  const cols = [];
  for (let i = 0; i < depth; i++) {
    const values = [...new Set(parts.map((p) => p[i]).filter(Boolean))];
    cols.push({ label: names[i] || (depth === 1 ? 'Option' : `Option ${i + 1}`), values, index: i });
  }
  return cols;
}

const selection = [];

function matchingVariants(upTo) {
  return product.variants.filter((v) => {
    const parts = variantParts(v);
    return selection.slice(0, upTo).every((sel, i) => sel == null || parts[i] === sel);
  });
}

function syncVariant() {
  const exact = product.variants.find((v) => {
    const parts = variantParts(v);
    return selection.every((sel, i) => parts[i] === sel);
  });
  selectedVariant = exact || null;
}

function render() {
  const cols = optionColumns();
  const img = (product.images.find((i) => i.isDefault) || product.images[0] || {}).src || '';
  const price = selectedVariant
    ? money(selectedVariant.price, currency)
    : product.minPrice === product.maxPrice
      ? money(product.minPrice, currency)
      : `${money(product.minPrice, currency)} – ${money(product.maxPrice, currency)}`;

  root.innerHTML = `
    <div class="gallery">
      <div class="gallery__main">${img ? `<img src="${img}" alt="${esc(product.title)}" data-main-image>` : ''}</div>
      ${product.images.length > 1 ? `<div class="gallery__thumbs">${product.images.slice(0, 8).map((im, i) =>
        `<button type="button" data-thumb="${esc(im.src)}" aria-pressed="${i === 0}"><img src="${esc(im.src)}" alt=""></button>`).join('')}</div>` : ''}
    </div>
    <div>
      <p class="eyebrow">${esc((product.tags || [])[0] || 'Disc Jerkers')}</p>
      <h1>${esc(product.title)}</h1>
      <p class="price-tag" data-price>${price}</p>

      ${cols.map((col) => `
        <div class="option-group">
          <div class="option-group__label">${esc(col.label)}</div>
          <div class="chips" data-option="${col.index}">
            ${col.values.map((val) => `<button type="button" class="chip" data-value="${esc(val)}" aria-pressed="false">${esc(val)}</button>`).join('')}
          </div>
        </div>`).join('')}

      <div class="option-group">
        <div class="option-group__label">Quantity</div>
        <div class="qty">
          <button type="button" data-qty="-1" aria-label="Decrease quantity">–</button>
          <input type="text" inputmode="numeric" value="1" data-qty-input aria-label="Quantity">
          <button type="button" data-qty="1" aria-label="Increase quantity">+</button>
        </div>
      </div>

      <button class="btn btn--full" data-add disabled>Pick your size</button>
      <p class="muted" data-add-note style="margin-top:12px;font-size:0.85rem"></p>

      ${product.description ? `<div class="prose" style="margin-top:28px">${esc(product.description)}</div>` : ''}

      <ul class="spec-list">
        <li><strong>Printing</strong><span>Made to order by Printify's US partners. Nothing sits in a garage waiting to be unsold.</span></li>
        <li><strong>Ships in</strong><span>2–5 business days to produce, then 3–6 in transit. Faster than finding your disc in the brush.</span></li>
        <li><strong>Returns</strong><span>Misprints and damage replaced free. Email a photo. Blaming the plastic is encouraged.</span></li>
      </ul>
    </div>`;

  wire(cols);
  paintChips(cols);
}

function wire(cols) {
  root.querySelectorAll('[data-thumb]').forEach((btn) => {
    btn.addEventListener('click', () => {
      root.querySelector('[data-main-image]').src = btn.dataset.thumb;
      root.querySelectorAll('[data-thumb]').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
    });
  });

  root.querySelectorAll('[data-option]').forEach((group) => {
    const index = Number(group.dataset.option);
    group.addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (!chip || chip.disabled) return;
      selection[index] = selection[index] === chip.dataset.value ? null : chip.dataset.value;
      for (let i = index + 1; i < selection.length; i++) selection[i] = null;
      syncVariant();
      paintChips(cols);
    });
  });

  root.querySelectorAll('[data-qty]').forEach((btn) => {
    btn.addEventListener('click', () => {
      quantity = Math.max(1, Math.min(20, quantity + Number(btn.dataset.qty)));
      root.querySelector('[data-qty-input]').value = quantity;
    });
  });

  root.querySelector('[data-qty-input]').addEventListener('change', (e) => {
    quantity = Math.max(1, Math.min(20, parseInt(e.target.value, 10) || 1));
    e.target.value = quantity;
  });

  root.querySelector('[data-add]').addEventListener('click', () => {
    if (!selectedVariant) return;
    addToCart({ productId: product.id, variantId: selectedVariant.id, quantity });
    const note = root.querySelector('[data-add-note]');
    note.innerHTML = `In the bag. <a href="/cart.html">Go to cart →</a>`;
  });
}

function paintChips(cols) {
  cols.forEach((col) => {
    const group = root.querySelector(`[data-option="${col.index}"]`);
    const available = new Set(matchingVariants(col.index).map((v) => variantParts(v)[col.index]));
    group.querySelectorAll('.chip').forEach((chip) => {
      const on = selection[col.index] === chip.dataset.value;
      chip.setAttribute('aria-pressed', String(on));
      chip.disabled = !available.has(chip.dataset.value) && !on;
    });
  });

  const btn = root.querySelector('[data-add]');
  const priceEl = root.querySelector('[data-price]');
  if (selectedVariant) {
    priceEl.textContent = money(selectedVariant.price, currency);
    btn.disabled = false;
    btn.textContent = `Add to cart — ${money(selectedVariant.price * quantity, currency)}`;
  } else {
    btn.disabled = true;
    btn.textContent = 'Pick your size';
  }
}

async function load() {
  if (!id) {
    root.innerHTML = '<div class="notice"><strong>Nothing to show.</strong> No product was specified. <a href="/shop.html">Back to the shop →</a></div>';
    return;
  }
  try {
    const [{ product: p }, cfg] = await Promise.all([api(`/api/products/${encodeURIComponent(id)}`), siteConfig()]);
    product = p;
    currency = cfg.currency;
    document.title = `${p.title} — Disc Jerkers`;
    selection.length = Math.max(...p.variants.map((v) => variantParts(v).length));
    selection.fill(null);
    // Single-option products: preselect so the page is one click to buy.
    if (p.variants.length === 1) {
      variantParts(p.variants[0]).forEach((val, i) => { selection[i] = val; });
      syncVariant();
    }
    render();
  } catch (err) {
    root.innerHTML = `<div class="notice"><strong>That one went OB.</strong> ${esc(err.message)} <a href="/shop.html">Back to the shop →</a></div>`;
  }
}

load();
