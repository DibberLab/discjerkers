'use strict';

/**
 * Normalizes a raw Printify product into the shape the storefront uses.
 * Printify prices are integer cents. Only enabled + available variants ship.
 */
function normalizeProduct(raw) {
  const images = (raw.images || [])
    .filter((i) => i.src)
    .map((i) => ({ src: i.src, variantIds: i.variant_ids || [], isDefault: Boolean(i.is_default) }));

  const variants = (raw.variants || [])
    .filter((v) => v.is_enabled && v.is_available !== false)
    .map((v) => ({
      id: v.id,
      title: v.title,
      price: v.price,
      sku: v.sku,
      options: v.options || [],
    }));

  const optionNames = (raw.options || []).map((o) => ({
    name: o.name,
    type: o.type,
    values: (o.values || []).map((val) => ({ id: val.id, title: val.title, colors: val.colors || [] })),
  }));

  const prices = variants.map((v) => v.price).filter((n) => Number.isFinite(n));

  return {
    id: String(raw.id),
    title: raw.title || 'Untitled',
    description: stripHtml(raw.description || ''),
    descriptionHtml: raw.description || '',
    tags: raw.tags || [],
    images,
    variants,
    options: optionNames,
    minPrice: prices.length ? Math.min(...prices) : null,
    maxPrice: prices.length ? Math.max(...prices) : null,
    visible: raw.visible !== false,
    blueprintId: raw.blueprint_id,
    printProviderId: raw.print_provider_id,
  };
}

function stripHtml(html) {
  return String(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ---------------------------------------------------------------------------
// Demo catalog — used only when PRINTIFY_API_TOKEN is unset, so the design can
// be reviewed before the real shop exists. Ids are obviously fake on purpose.
// ---------------------------------------------------------------------------
const PLACEHOLDER = (label, accent) =>
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800">` +
      `<rect width="800" height="800" fill="#11170f"/>` +
      `<circle cx="400" cy="360" r="215" fill="none" stroke="${accent}" stroke-width="10" opacity="0.85"/>` +
      `<ellipse cx="400" cy="360" rx="170" ry="66" fill="none" stroke="#7f8c8d" stroke-width="5" opacity="0.6"/>` +
      `<ellipse cx="400" cy="360" rx="62" ry="24" fill="${accent}" opacity="0.7"/>` +
      `<text x="400" y="620" text-anchor="middle" font-family="Impact,Haettenschweiler,sans-serif" font-size="74" fill="#eef1e8" letter-spacing="2">${label}</text>` +
      `<text x="400" y="678" text-anchor="middle" font-family="monospace" font-size="24" fill="#7f8c8d" letter-spacing="6">SAMPLE ART</text>` +
    `</svg>`
  );

const DEMO_PRODUCTS = [
  demo('demo-death-by-disc', 'Death By Disc Tee', 'The house design. A robed reaper cat, a driver, and a basket that has seen things. Heavyweight cotton.', 2800, ['Tees'], '#a3e635'),
  demo('demo-player-b', 'Player B Ace Tee', 'For the throw after the terrible throw. Not an ace, but a solid Player B ace.', 2800, ['Tees'], '#d35400'),
  demo('demo-pocket-spaghetti', 'Pocket Spaghetti Hoodie', 'Fleece-lined, deep pockets, no questions asked about what is in them during back-to-back rounds.', 5400, ['Hoodies'], '#a3e635'),
  demo('demo-first-available', 'First Available Tee', 'A tribute to the tree four feet in front of the tee pad that eats 80% of all forehands.', 2800, ['Tees'], '#7f8c8d'),
  demo('demo-tuna-can', 'Tuna Can Cap', 'Structured six-panel. Stability and form over pure length. Girthy. Unbothered.', 3200, ['Hats'], '#d35400'),
  demo('demo-blame-plastic', 'Blame The Plastic Towel', 'It was never you. It was the plastic. Keep it dry anyway.', 2200, ['Accessories'], '#a3e635'),
];

function demo(id, title, description, price, tags, accent) {
  const sizes = ['S', 'M', 'L', 'XL', '2XL'];
  const variants = sizes.map((s, i) => ({
    id: 900000 + Math.abs(hash(id)) % 1000 + i,
    title: `Void Black / ${s}`,
    price: price + (s === '2XL' ? 200 : 0),
    sku: `${id}-${s}`,
    options: [],
  }));
  const label = title.split(' ')[0].toUpperCase();
  return {
    id,
    title,
    description,
    descriptionHtml: `<p>${description}</p>`,
    tags,
    images: [{ src: PLACEHOLDER(label, accent), variantIds: [], isDefault: true }],
    variants,
    options: [
      { name: 'Color', type: 'color', values: [{ id: 0, title: 'Void Black', colors: ['#090c09'] }] },
      { name: 'Size', type: 'size', values: sizes.map((s, i) => ({ id: i, title: s, colors: [] })) },
    ],
    minPrice: price,
    maxPrice: price + 200,
    visible: true,
    demo: true,
  };
}

function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i) | 0;
  return h;
}

module.exports = { normalizeProduct, stripHtml, DEMO_PRODUCTS };
