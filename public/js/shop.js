import { api, priceLabel, primaryImage, productHref, siteConfig } from './site.js?v=2';

const grid = document.querySelector('[data-grid]');
const status = document.querySelector('[data-status]');

function card(product, currency) {
  const img = primaryImage(product);
  const tag = (product.tags || [])[0] || '';
  return `
    <a class="card" href="${productHref(product.id)}">
      <div class="card__media">${img ? `<img src="${img}" alt="${escapeHtml(product.title)}" loading="lazy">` : ''}</div>
      <div class="card__body">
        <span class="card__title">${escapeHtml(product.title)}</span>
        <span class="card__price">${priceLabel(product, currency)}</span>
        ${tag ? `<span class="card__tag">${escapeHtml(tag)}</span>` : ''}
      </div>
    </a>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function load() {
  grid.innerHTML = Array.from({ length: 6 }, () => '<div class="skeleton"></div>').join('');
  try {
    const [{ products }, cfg] = await Promise.all([api('/api/products'), siteConfig()]);
    const limit = Number(grid.dataset.limit || 0);
    const list = limit ? products.slice(0, limit) : products;

    if (!list.length) {
      grid.innerHTML = '';
      if (status) status.innerHTML = '<div class="notice"><strong>Nothing published yet.</strong> The Printify shop is empty. Publish a product there and refresh this page.</div>';
      return;
    }
    grid.innerHTML = list.map((p) => card(p, cfg.currency)).join('');
    if (status) status.textContent = '';
  } catch (err) {
    grid.innerHTML = '';
    if (status) status.innerHTML = `<div class="notice"><strong>Couldn't load the shop.</strong> ${escapeHtml(err.message)}</div>`;
  }
}

load();
