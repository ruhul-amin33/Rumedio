/* RumeDio Shop frontend - vanilla JS single page app (hash routing). */
(() => {
  'use strict';

  /* ---------- helpers ---------- */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => '৳' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 });
  const view = $('#view');

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } }
  };
  const state = {
    cart: store.get('bg_cart', []),
    user: store.get('bg_user', null),
    token: store.get('bg_token', null),
    cats: [],
    next: null
  };
  let timers = [];
  let renderId = 0;

  async function api(path, opts = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (state.token) headers.Authorization = 'Bearer ' + state.token;
    let res;
    const isGet = !opts.method || opts.method === 'GET';
    for (let attempt = 0; ; attempt++) {
      try {
        res = await fetch('/api' + path, { ...opts, headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
      } catch {
        throw Object.assign(new Error('No internet connection. Please check and retry.'), { status: 0 });
      }
      // Database busy (503) hole GET request 2 bar nijei abar chesta kore
      if (res.status === 503 && isGet && attempt < 2) { await new Promise((r) => setTimeout(r, 800 * (attempt + 1))); continue; }
      break;
    }
    let data = null;
    try { data = await res.json(); } catch { /* not json */ }
    if (!res.ok) {
      if (res.status === 401 && state.token && !path.startsWith('/auth/login')) logout(true);
      throw Object.assign(new Error((data && data.error) || 'Something went wrong. Please try again.'), { status: res.status });
    }
    return data;
  }

  /* ---------- delivery / support settings (server theke ashe, /api/config) ---------- */
  state.cfg = { siteName: 'RumeDio Shop', freeShipMin: 1500, feeDhaka: 60, feeOutside: 120, freeShipOutside: false, supportEmail: 'ruhulamineasy@gmail.com', supportPhone: '', topbarText: '', footerText: '' };
  const shipFor = (zone, sub) => {
    const c = state.cfg;
    if (zone === 'outside') return c.freeShipOutside && sub >= c.freeShipMin ? 0 : c.feeOutside;
    return sub >= c.freeShipMin ? 0 : c.feeDhaka;
  };
  const deliveryHint = () => {
    const c = state.cfg;
    return `Delivery: inside Dhaka ${money(c.feeDhaka)}, outside Dhaka ${money(c.feeOutside)}. Free ${c.freeShipOutside ? '' : 'inside Dhaka '}on orders over ${money(c.freeShipMin)}.`;
  };
  function applyConfig() {
    const c = state.cfg;
    $$('[data-site-name]').forEach((el) => { el.textContent = c.siteName; });
    $$('.logo-mark').forEach((el) => { el.textContent = (c.siteName.trim()[0] || 'S').toUpperCase(); });
    if (!/^\/(product|category)/.test(location.hash.replace(/^#/, ''))) document.title = `${c.siteName} - Shop online in Bangladesh`;
    $$('[data-support-mail]').forEach((el) => { el.textContent = c.supportEmail; if (el.tagName === 'A') el.href = 'mailto:' + c.supportEmail; });
    $$('[data-support-phone]').forEach((el) => {
      el.hidden = !c.supportPhone;
      if (c.supportPhone) { el.textContent = c.supportPhone; el.href = 'tel:' + c.supportPhone.replace(/[^\d+]/g, ''); }
    });
    const t = $('#topMsg');
    if (t) t.textContent = c.topbarText || `Dhaka ${money(c.feeDhaka)} · Outside Dhaka ${money(c.feeOutside)} · Free ${c.freeShipOutside ? '' : 'in Dhaka '}over ${money(c.freeShipMin)}`;
    const f = $('#footNote');
    if (f) f.textContent = c.footerText || 'Your everyday marketplace. Real products, honest prices, delivered to your door.';
  }
  async function loadConfig() {
    try { const d = await api('/config'); state.cfg = { ...state.cfg, ...d.config }; } catch { /* default gulo cholbe */ }
    applyConfig();
  }

  function toast(msg, type = '') {
    const el = document.createElement('div');
    el.className = 'toast ' + type;
    el.textContent = msg;
    $('#toasts').appendChild(el);
    setTimeout(() => el.remove(), 3200);
  }

  /* ---------- cart & auth state ---------- */
  const saveCart = () => { store.set('bg_cart', state.cart); updateHeader(); };
  const cartCount = () => state.cart.reduce((n, i) => n + i.qty, 0);
  const subtotal = () => state.cart.reduce((n, i) => n + i.price * i.qty, 0);

  // colour/size wala product hole (id + colour + size) alada line; stock = oi option er stock
  function addToCart(p, qty = 1, sel = {}) {
    const color = sel.color || '', size = sel.size || '';
    const avail = (color || size) && sel.stock != null ? sel.stock : p.stock;
    const max = Math.max(1, Math.min(20, avail));
    const found = state.cart.find((i) => i.id === p.id && (i.size || '') === size && (i.color || '') === color);
    if (found) { found.qty = Math.min(max, found.qty + qty); found.stock = avail; }
    else state.cart.push({ id: p.id, title: p.title, price: p.price, old_price: p.old_price, image_url: p.image_url, icon: p.icon, stock: avail, color, color_hex: sel.hex || null, size, qty: Math.min(max, qty) });
    saveCart();
  }
  const optText = (i) => [i.color, i.size && `Size ${i.size}`].filter(Boolean).join(', ');
  const itemLine = (i) => `${esc(i.title)}${optText(i) ? ` <span class="muted">(${esc(optText(i))})</span>` : ''} × ${i.qty}`;

  function setSession(data) {
    state.token = data.token; state.user = data.user;
    store.set('bg_token', data.token); store.set('bg_user', data.user);
    updateHeader();
  }
  function logout(expired) {
    state.token = null; state.user = null;
    store.del('bg_token'); store.del('bg_user');
    updateHeader();
    if (expired) { toast('Session expired. Please log in again', 'err'); location.hash = '#/login'; }
  }

  function updateHeader() {
    const n = cartCount();
    const badge = $('#cartCount');
    badge.textContent = n > 99 ? '99+' : n;
    badge.hidden = n === 0;
    const link = $('#accountLink');
    link.classList.toggle('logged', !!state.user);
    if (state.user) {
      $('#accountLabel').textContent = state.user.name.split(' ')[0];
      link.setAttribute('href', state.user.role === 'admin' ? '#/admin' : '#/orders');
    } else {
      $('#accountLabel').textContent = 'Login';
      link.setAttribute('href', '#/login');
    }
  }

  /* ---------- UI pieces ---------- */
  const tile = (p) => `<div class="tile t${(p.id || 0) % 6}" aria-hidden="true"><span>${esc(p.icon || '🛍️')}</span></div>`;
  // Cloudinary chobi hole auto-optimize (f_auto,q_auto) + size chhoto kore data/bandwidth bachay
  const cl = (u, w) => (/^https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/v\d+\//.test(u || '')
    ? u.replace('/image/upload/', `/image/upload/f_auto,q_auto,c_limit,w_${w}/`) : u);
  const img = (p, w = 500) => p.image_url
    ? `<img src="${esc(cl(p.image_url, w))}" alt="${esc(p.title)}" loading="lazy" data-id="${p.id || 0}" data-icon="${esc(p.icon || '🛍️')}">`
    : tile(p);
  const discount = (p) => (p.old_price && p.old_price > p.price ? Math.round((1 - p.price / p.old_price) * 100) : 0);
  const soldOut = (p) => !!p.is_out_of_stock || p.stock <= 0;
  const showStock = (p) => !(p.hide_stock || state.cfg.hideStock);
  const fmtSold = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M' : n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : String(n));
  const starsHtml = (r) => `<span class="stars" style="--r:${Number(r)}" role="img" aria-label="${Number(r).toFixed(1)} out of 5">★★★★★</span>`;
  // rating 0 hole ba sold 0 hole ta dekhano hoy na (admin theke customise kora jay)
  const ratingMeta = (p) => (Number(p.rating) > 0 ? `${starsHtml(p.rating)}<span>${Number(p.rating).toFixed(1)}</span>` : '') + (p.sold > 0 ? `<span>${fmtSold(p.sold)} sold</span>` : '');

  function card(p) {
    const d = discount(p), out = soldOut(p);
    return `<a class="card${out ? ' is-out' : ''}" href="#/product/${p.id}">
      <div class="card-img">${img(p)}${d && !out ? `<span class="badge">-${d}%</span>` : ''}${out ? '<span class="soldout-tag">Sold out</span>' : ''}</div>
      <div class="card-body">
        <h3 class="card-title">${esc(p.title)}</h3>
        <div class="price">${money(p.price)}</div>
        ${d ? `<div class="old">${money(p.old_price)}</div>` : ''}
        <div class="meta">${ratingMeta(p)}</div>
      </div></a>`;
  }
  const skeletonGrid = (n = 10) => `<div class="grid">${'<div class="sk sk-card"></div>'.repeat(n)}</div>`;
  const stockPill = (p) => (soldOut(p) ? '<span class="pill pill-out">Out of stock</span>'
    : !showStock(p) ? '' : p.stock <= 5 ? `<span class="pill pill-low">Only ${p.stock} left</span>` : '<span class="pill pill-ok">In stock</span>');

  const errorBox = (e) => `<div class="wrap section"><div class="panel empty">
    <div class="em">⚠️</div><h2>We couldn't load this page</h2><p>${esc(e.message)}</p>
    <button class="btn" data-act="retry">Try again</button></div></div>`;

  function setView(html) { view.innerHTML = html; window.scrollTo(0, 0); }

  /* image fallback: broken image -> emoji tile */
  document.addEventListener('error', (e) => {
    const t = e.target;
    if (t.tagName === 'IMG' && t.dataset.icon) {
      const d = document.createElement('div');
      d.className = 'tile t' + ((+t.dataset.id || 0) % 6);
      d.innerHTML = `<span>${esc(t.dataset.icon)}</span>`;
      t.replaceWith(d);
    }
  }, true);

  /* ---------- pages ---------- */
  let catsAt = 0;
  async function loadCats(fresh) {
    if (state.cats.length && !fresh && Date.now() - catsAt < 60000) return state.cats;
    catsAt = Date.now();
    const d = await api('/categories' + (fresh ? '?_=' + Date.now() : ''));
    state.cats = d.categories;
    return state.cats;
  }

  /* ---------- slideshow ---------- */
  const DEFAULT_SLIDES = [
    { title: 'Everything you need, one place', subtitle: 'সারা দেশে ক্যাশ অন ডেলিভারি', button_text: 'Start shopping', button_link: '#/shop', theme: 'green', emoji: '📱 🎧 👟', image_url: null },
    { title: 'Flash sale, up to 40% off', subtitle: 'Fresh deals refresh every day.', button_text: 'See the deals', button_link: '#/sale', theme: 'saffron', emoji: '⚡ 🏷️', image_url: null },
    { title: 'Free delivery in Dhaka over ৳1,500', subtitle: 'Add a little more, pay nothing to ship.', button_text: 'Browse products', button_link: '#/shop', theme: 'dark', emoji: '📦 🚚', image_url: null }
  ];
  const safeCssUrl = (u) => String(u).replace(/[\s'"()\\]/g, encodeURIComponent);
  const dotsTone = (s) => (s.theme === 'saffron' && !s.image_url ? 'dark' : 'light');
  function slideHtml(s, on) {
    const bg = s.image_url ? cl(s.image_url, 1600) : '';
    const link = /^(#\/|https?:\/\/)/i.test(s.button_link || '') ? s.button_link : '';
    const ext = /^https?:/i.test(link);
    const btn = s.theme === 'saffron' && !bg ? 'btn' : 'btn-accent';
    return `<div class="slide theme-${esc(s.theme)}${bg ? ' has-img' : ''}${on ? ' on' : ''}"${bg ? ` style="--slide-img:url('${safeCssUrl(bg)}')"` : ''}>
      <div><h1>${esc(s.title)}</h1>${s.subtitle ? `<p>${esc(s.subtitle)}</p>` : ''}${s.button_text && link ? `<a class="btn ${btn}" href="${esc(link)}"${ext ? ' target="_blank" rel="noopener"' : ''}>${esc(s.button_text)}</a>` : ''}</div>
      ${!bg && s.emoji ? `<div class="art" aria-hidden="true">${esc(s.emoji)}</div>` : ''}</div>`;
  }

  /* generic "grid with load more" */
  function gridLoader(el, moreBtn, urlFor, emptyHtml) {
    let page = 1, busy = false;
    async function load() {
      if (busy) return; busy = true; moreBtn.disabled = true;
      try {
        const d = await api(urlFor(page));
        if (page === 1) el.innerHTML = '';
        el.insertAdjacentHTML('beforeend', d.products.map(card).join(''));
        if (page === 1 && !d.products.length) el.outerHTML = emptyHtml;
        moreBtn.parentElement.hidden = page * d.limit >= d.total;
        page++;
      } catch (e) { toast(e.message, 'err'); }
      busy = false; moreBtn.disabled = false;
    }
    moreBtn.addEventListener('click', load);
    load();
  }

  async function pageHome() {
    const my = renderId;
    setView(`<div class="wrap"><div class="sk" style="height:18rem;margin-top:1rem"></div></div><div class="wrap section">${skeletonGrid()}</div>`);
    const [cats, sale, sd] = await Promise.all([loadCats(), api('/products?sale=1&limit=10&sort=popular'),
      api('/slides').catch(() => ({ slides: null }))]);
    if (my !== renderId) return;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const slides = sd.slides === null ? DEFAULT_SLIDES : sd.slides; // null = migration hoyni, default dekhao
    setView(`
      <div class="wrap home-top${slides.length ? '' : ' no-hero'}">
        <nav class="panel side-cats" aria-label="Categories">
          ${cats.map((c) => `<a href="#/category/${esc(c.slug)}"><span class="em">${esc(c.icon)}</span>${esc(c.name)}</a>`).join('')}
        </nav>
        <div>
          <div class="chips">${cats.map((c) => `<a class="chip" href="#/category/${esc(c.slug)}"><span>${esc(c.icon)}</span>${esc(c.name)}</a>`).join('')}</div>
          ${slides.length ? `<section class="hero" data-dots="${dotsTone(slides[0])}" aria-roledescription="carousel" aria-label="Offers" style="margin-top:.6rem">
            ${slides.map((sl, i) => slideHtml(sl, i === 0)).join('')}
            ${slides.length > 1 ? `<div class="dots">${slides.map((_, i) => `<button aria-label="Slide ${i + 1}" aria-current="${i === 0}"></button>`).join('')}</div>` : ''}
          </section>` : ''}
        </div>
      </div>

      ${sale.products.length ? `<section class="wrap section">
        <div class="flash">
          <div class="flash-head">
            <h2>Flash sale</h2>
            <div class="countdown" aria-label="Time left today">Ends in <b id="cdH">00</b><b id="cdM">00</b><b id="cdS">00</b></div>
            <a class="link" href="#/sale">See all</a>
          </div>
          <div class="rail-wrap at-start" id="saleRailWrap">
            <div class="rail" id="saleRail">${sale.products.map(card).join('')}</div>
            <div class="rail-nav prev"><button type="button" data-rail-scroll="-1" aria-label="Scroll left" disabled>‹</button></div>
            <div class="rail-nav next"><button type="button" data-rail-scroll="1" aria-label="Scroll right">›</button></div>
          </div>
        </div></section>` : ''}

      <section class="wrap section">
        <div class="sec-head"><h2>Shop by category</h2></div>
        <div class="cat-grid">${cats.map((c) => `<a class="cat-tile" href="#/category/${esc(c.slug)}"><span class="em">${esc(c.icon)}</span>${esc(c.name)}</a>`).join('')}</div>
      </section>

      <section class="wrap section">
        <div class="sec-head"><h2>Just for you</h2><a class="link" href="#/shop">View all</a></div>
        <div class="grid" id="homeGrid">${'<div class="sk sk-card"></div>'.repeat(8)}</div>
        <div class="more"><button class="btn btn-ghost" id="homeMore">Load more</button></div>
      </section>`);
    window.scrollTo(0, 0);

    gridLoader($('#homeGrid'), $('#homeMore'), (p) => `/products?sort=popular&limit=12&page=${p}`, '<div class="empty">No products yet.</div>');

    // hero slider
    const sl = $$('.slide'), dots = $$('.dots button'), hero = $('.hero');
    if (sl.length > 1) {
      let cur = 0;
      const show = (i) => {
        cur = (i + sl.length) % sl.length;
        sl.forEach((x, k) => x.classList.toggle('on', k === cur));
        dots.forEach((d, k) => d.setAttribute('aria-current', String(k === cur)));
        hero.dataset.dots = dotsTone(slides[cur]);
      };
      dots.forEach((d, i) => d.addEventListener('click', () => show(i)));
      if (!reduce) timers.push(setInterval(() => show(cur + 1), 5500));
    }

    // horizontal rails (Flash sale etc.): round arrow buttons, hide at each end, remember scroll fraction
    $$('.rail-wrap').forEach((wrap) => {
      const rail = $('.rail', wrap);
      const update = () => {
        const max = rail.scrollWidth - rail.clientWidth;
        wrap.classList.toggle('at-start', rail.scrollLeft <= 2);
        wrap.classList.toggle('at-end', rail.scrollLeft >= max - 2);
        $$('[data-rail-scroll]', wrap).forEach((b) => { b.disabled = max <= 2; });
        $('[data-rail-scroll="-1"]', wrap).disabled = rail.scrollLeft <= 2;
        $('[data-rail-scroll="1"]', wrap).disabled = rail.scrollLeft >= max - 2;
      };
      rail.addEventListener('scroll', update, { passive: true });
      $$('[data-rail-scroll]', wrap).forEach((b) => b.addEventListener('click', () => {
        rail.scrollBy({ left: rail.clientWidth * 0.85 * +b.dataset.railScroll, behavior: reduce ? 'auto' : 'smooth' });
      }));
      update();
    });

    // countdown to midnight
    if ($('#cdH')) {
      const tick = () => {
        const now = new Date(), end = new Date(now); end.setHours(24, 0, 0, 0);
        const s = Math.max(0, Math.floor((end - now) / 1000));
        const p2 = (n) => String(n).padStart(2, '0');
        $('#cdH').textContent = p2(Math.floor(s / 3600));
        $('#cdM').textContent = p2(Math.floor((s % 3600) / 60));
        $('#cdS').textContent = p2(s % 60);
      };
      tick(); timers.push(setInterval(tick, 1000));
    }
  }

  async function pageList(mode, arg, params) {
    const my = renderId;
    const cats = await loadCats();
    if (my !== renderId) return;
    let title = 'All products', base = '';
    if (mode === 'category') {
      const c = cats.find((x) => x.slug === arg);
      title = c ? c.name : 'Category'; base = `&category=${encodeURIComponent(arg)}`;
    } else if (mode === 'search') {
      const q = params.get('q') || '';
      title = `Results for "${q}"`; base = `&q=${encodeURIComponent(q)}`;
    } else if (mode === 'sale') { title = 'Flash sale'; base = '&sale=1'; }

    setView(`<div class="wrap section">
      <div class="crumbs"><a href="#/">Home</a> / ${esc(title)}</div>
      <div class="list-head"><h1>${esc(title)}</h1>
        <label class="muted" style="font-size:var(--fs-200)">Sort by
          <select class="select" id="sort">
            <option value="popular">Popularity</option><option value="new">Newest</option>
            <option value="price_asc">Price: low to high</option><option value="price_desc">Price: high to low</option>
            <option value="rating">Rating</option></select></label></div>
      <div id="listWrap"><div class="grid" id="listGrid">${'<div class="sk sk-card"></div>'.repeat(10)}</div>
      <div class="more"><button class="btn btn-ghost" id="listMore">Load more</button></div></div></div>`);

    const empty = `<div class="panel empty"><div class="em">🔍</div><h2>No products found</h2>
      <p>Try a different word or browse all categories.</p><a class="btn" href="#/shop">Browse all</a></div>`;
    const start = () => {
      const wrap = $('#listWrap');
      wrap.innerHTML = '<div class="grid" id="listGrid"></div><div class="more"><button class="btn btn-ghost" id="listMore">Load more</button></div>';
      gridLoader($('#listGrid'), $('#listMore'), (p) => `/products?limit=20&page=${p}&sort=${$('#sort').value}${base}`, empty);
    };
    start();
    $('#sort').addEventListener('change', start);
  }

  async function pageProduct(id) {
    const my = renderId;
    setView('<div class="wrap section"><div class="sk" style="height:26rem"></div></div>');
    const { product: p, related } = await api('/products/' + id);
    if (my !== renderId) return;
    const d = discount(p), out = soldOut(p);
    const hasSizes = Array.isArray(p.sizes) && p.sizes.length > 0;
    const hasColors = Array.isArray(p.colors) && p.colors.length > 0;
    const variants = p.variants || [];
    const images = p.images && p.images.length ? p.images : (p.image_url ? [p.image_url] : []);
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const gallery = images.length ? `<div class="gallery">
        <div class="g-main">
          <div class="g-track" id="gTrack" tabindex="0" aria-label="Product photos">${images.map((u, i) =>
            `<div class="g-slide"><img src="${esc(cl(u, 1000))}" alt="${esc(p.title)}${images.length > 1 ? ' photo ' + (i + 1) : ''}" ${i ? 'loading="lazy"' : ''} data-id="${p.id}" data-icon="${esc(p.icon || '🛍️')}"></div>`).join('')}</div>
          ${images.length > 1 ? `<button type="button" class="g-nav prev" id="gPrev" aria-label="Previous photo">‹</button><button type="button" class="g-nav next" id="gNext" aria-label="Next photo">›</button><span class="g-count" id="gCount">1 / ${images.length}</span>` : ''}
          ${out ? '<span class="soldout-tag big">Sold out</span>' : ''}
        </div>
        ${images.length > 1 ? `<div class="g-thumbs" id="gThumbs">${images.map((u, i) => `<button type="button" class="g-thumb${i ? '' : ' on'}" data-i="${i}" aria-label="Show photo ${i + 1}"><img src="${esc(cl(u, 160))}" alt="" loading="lazy" data-id="${p.id}" data-icon="${esc(p.icon || '🛍️')}"></button>`).join('')}</div>` : ''}
      </div>`
      : `<div class="gallery"><div class="g-main">${tile(p)}${out ? '<span class="soldout-tag big">Sold out</span>' : ''}</div></div>`;
    const colorBox = hasColors ? `<div class="size-pick" id="colorPick" role="radiogroup" aria-label="Colour">
        <div class="size-head"><b>Colour</b><span class="hint" id="colorNote">Please select a colour</span></div>
        <div class="colors">${p.colors.map((c) => `<label class="color-opt"><input type="radio" name="color" value="${esc(c.color)}"><span class="dot" style="--c:${esc(c.hex || '#cccccc')}"></span><span class="cname">${esc(c.color)}</span></label>`).join('')}</div>
      </div>` : '';
    const sizeBox = hasSizes ? `<div class="size-pick" id="sizePick" role="radiogroup" aria-label="Size">
        <div class="size-head"><b>Size</b><span class="hint" id="sizeNote">Please select a size</span></div>
        <div class="sizes">${p.sizes.map((z) => `<label class="size-opt"><input type="radio" name="size" value="${esc(z.size)}"><span>${esc(z.size)}</span></label>`).join('')}</div>
      </div>` : '';
    setView(`<div class="wrap section">
      <div class="crumbs"><a href="#/">Home</a> / <a href="#/category/${esc(p.category_slug)}">${esc(p.category_name)}</a> / ${esc(p.title)}</div>
      <div class="pdp">
        ${gallery}
        <div>
          <h1>${esc(p.title)}</h1>
          <div class="meta" style="padding:0">${ratingMeta(p)}${stockPill(p)}</div>
          <div class="price-row"><span class="price-big">${money(p.price)}</span>
            ${d ? `<span class="old">${money(p.old_price)}</span><span class="pill pill-out">Save ${d}%</span>` : ''}</div>
          ${!out ? `
          ${colorBox}${sizeBox}
          <div class="hint stock-note" id="stockNote" aria-live="polite"></div>
          <div class="qty" role="group" aria-label="Quantity">
            <button type="button" data-q="-1" aria-label="Decrease">−</button>
            <input id="qty" type="number" value="1" min="1" max="${hasSizes || hasColors ? 20 : Math.min(20, p.stock)}" aria-label="Quantity">
            <button type="button" data-q="1" aria-label="Increase">+</button></div>
          <div class="buy-row">
            <button class="btn btn-accent" id="buyNow">Buy now</button>
            <button class="btn btn-ghost" id="addCart">Add to cart</button></div>`
          : '<div class="oos-box"><b>Out of stock</b><p>This item is currently unavailable. Please check again later.</p></div>'}
          <div class="perks"><span>🚚 ${esc(deliveryHint())}</span><span>💵 Cash on delivery</span></div>
          <div class="desc"><h3>Product details</h3><p>${esc(p.description || 'No description available.')}</p></div>
        </div>
      </div>
      ${related.length ? `<section class="section" style="padding-bottom:0"><div class="sec-head"><h2>You may also like</h2></div>
        <div class="grid">${related.map(card).join('')}</div></section>` : ''}</div>`);

    // ---- photo gallery (swipe / arrows / thumbnails) ----
    const track = $('#gTrack');
    if (track && images.length > 1) {
      const thumbs = $$('.g-thumb'), tbox = $('#gThumbs');
      let idx = 0, raf;
      const setIdx = (i) => {
        idx = i;
        thumbs.forEach((t, k) => t.classList.toggle('on', k === i));
        $('#gCount').textContent = `${i + 1} / ${images.length}`;
        const t = thumbs[i]; if (t) tbox.scrollTo({ left: t.offsetLeft - (tbox.clientWidth - t.clientWidth) / 2, behavior: reduce ? 'auto' : 'smooth' });
      };
      const go = (i) => { i = (i + images.length) % images.length; track.scrollTo({ left: i * track.clientWidth, behavior: reduce ? 'auto' : 'smooth' }); if (reduce) setIdx(i); };
      track.addEventListener('scroll', () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { const i = Math.round(track.scrollLeft / track.clientWidth); if (i !== idx) setIdx(i); }); });
      thumbs.forEach((t) => t.addEventListener('click', () => go(+t.dataset.i)));
      $('#gPrev').addEventListener('click', () => go(idx - 1));
      $('#gNext').addEventListener('click', () => go(idx + 1));
      track.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowLeft') { e.preventDefault(); go(idx - 1); }
        if (e.key === 'ArrowRight') { e.preventDefault(); go(idx + 1); }
      });
    }

    // ---- colour / size / quantity ----
    if (!out) {
      const qty = $('#qty');
      let selColor = '', selSize = '', selStock = null;
      let max = hasSizes || hasColors ? 20 : Math.min(20, p.stock);
      const clamp = () => { qty.value = Math.max(1, Math.min(max, parseInt(qty.value) || 1)); return +qty.value; };
      const vstock = (color, size) => { const v = variants.find((x) => x.color === color && x.size === size); return v ? v.stock : 0; };
      const refresh = () => {
        for (let pass = 0; pass < 2; pass++) { // ek-ta bodlale onnota unavailable hote pare, tai 2 bar
          $$('input[name="size"]').forEach((r) => {
            const z = p.sizes.find((x) => x.size === r.value);
            const st = hasColors && selColor ? vstock(selColor, r.value) : z.stock;
            r.disabled = st <= 0; r.closest('.size-opt').classList.toggle('out', st <= 0);
            if (r.disabled && r.checked) { r.checked = false; selSize = ''; }
          });
          $$('input[name="color"]').forEach((r) => {
            const c = p.colors.find((x) => x.color === r.value);
            const st = hasSizes && selSize ? vstock(r.value, selSize) : c.stock;
            r.disabled = st <= 0; r.closest('.color-opt').classList.toggle('out', st <= 0);
            if (r.disabled && r.checked) { r.checked = false; selColor = ''; }
          });
        }
        const complete = (!hasColors || selColor) && (!hasSizes || selSize);
        selStock = complete && (hasColors || hasSizes) ? vstock(hasColors ? selColor : '', hasSizes ? selSize : '') : null;
        max = selStock != null ? Math.min(20, selStock) : (hasSizes || hasColors ? 20 : Math.min(20, p.stock));
        if (hasColors) $('#colorNote').textContent = selColor ? selColor : 'Please select a colour';
        if (hasSizes) $('#sizeNote').textContent = selSize ? `Size ${selSize}` : 'Please select a size';
        $('#stockNote').textContent = selStock != null && showStock(p) && selStock <= 5 ? `Only ${selStock} left` : '';
        clamp();
      };
      $$('[data-q]').forEach((b) => b.addEventListener('click', () => { qty.value = clamp() + +b.dataset.q; clamp(); }));
      qty.addEventListener('change', clamp);
      $$('input[name="color"]').forEach((r) => r.addEventListener('change', () => { selColor = r.value; $('#colorPick').classList.remove('need'); refresh(); }));
      $$('input[name="size"]').forEach((r) => r.addEventListener('change', () => { selSize = r.value; $('#sizePick').classList.remove('need'); refresh(); }));
      refresh();
      // colour/size wala product e sob na bachle add hobe na
      const ready = () => {
        const miss = [];
        if (hasColors && !selColor) { miss.push('colour'); $('#colorPick').classList.add('need'); }
        if (hasSizes && !selSize) { miss.push('size'); $('#sizePick').classList.add('need'); }
        if (!miss.length) return true;
        (document.querySelector('.size-pick.need')).scrollIntoView({ behavior: 'smooth', block: 'center' });
        toast(`Please select a ${miss.join(' and ')}`, 'err');
        return false;
      };
      const chosen = () => ({ color: selColor, size: selSize, stock: selStock, hex: ((p.colors || []).find((c) => c.color === selColor) || {}).hex });
      $('#addCart').addEventListener('click', () => { if (ready()) { addToCart(p, clamp(), chosen()); toast(optText(chosen()) ? `Added to cart (${optText(chosen())})` : 'Added to cart'); } });
      $('#buyNow').addEventListener('click', () => { if (ready()) { addToCart(p, clamp(), chosen()); location.hash = '#/checkout'; } });
    }
  }

  function pageCart() {
    if (!state.cart.length) {
      return setView(`<div class="wrap section"><div class="panel empty"><div class="em">🛒</div><h2>Your cart is empty</h2>
        <p>Add something you like and it will show up here.</p><a class="btn" href="#/shop">Start shopping</a></div></div>`);
    }
    const sub = subtotal();
    setView(`<div class="wrap section"><h1 style="font-size:var(--fs-600);margin-bottom:1rem">Shopping cart</h1>
      <div class="two-col">
        <div class="panel panel-pad">${state.cart.map((i, k) => `
          <div class="line" data-k="${k}">
            <a class="thumb" href="#/product/${i.id}">${img(i, 200)}</a>
            <div><h3>${esc(i.title)}</h3>${i.color || i.size ? `<div class="hint opt-line">${i.color ? `<span class="dot sm" style="--c:${esc(i.color_hex || '#cccccc')}"></span>${esc(i.color)}` : ''}${i.color && i.size ? ' · ' : ''}${i.size ? `Size: <b>${esc(i.size)}</b>` : ''}</div>` : ''}<div class="price" style="margin:.1rem 0">${money(i.price)}</div>
              <div class="row">
                <div class="qty"><button data-a="dec" aria-label="Decrease">−</button><input value="${i.qty}" readonly aria-label="Quantity"><button data-a="inc" aria-label="Increase">+</button></div>
                <button class="linkbtn" data-a="rm">Remove</button></div></div></div>`).join('')}</div>
        <aside class="panel panel-pad">
          <h2 style="font-size:var(--fs-400);margin-bottom:.6rem">Order summary</h2>
          <div class="sum-row"><span>Subtotal (${cartCount()} items)</span><span>${money(sub)}</span></div>
          <div class="sum-row"><span>Delivery</span><span class="muted">Chosen at checkout</span></div>
          <p class="hint">${esc(deliveryHint())}</p>
          <p class="hint">Have a voucher code? You can apply it at checkout.</p>
          <a class="btn btn-accent btn-block" href="#/checkout" style="margin-top:1rem">Proceed to checkout</a>
        </aside></div></div>`);
    $$('.line').forEach((row) => row.addEventListener('click', (e) => {
      const a = e.target.closest('[data-a]'); if (!a) return;
      const it = state.cart[+row.dataset.k]; if (!it) return;
      if (a.dataset.a === 'inc') it.qty = Math.min(Math.min(20, it.stock || 20), it.qty + 1);
      if (a.dataset.a === 'dec') it.qty = Math.max(1, it.qty - 1);
      if (a.dataset.a === 'rm') state.cart = state.cart.filter((x) => x !== it);
      saveCart(); pageCart();
    }));
  }

  function requireLogin(target) {
    if (state.user) return false;
    state.next = target; toast('Please log in to continue');
    location.hash = '#/login';
    return true;
  }

  function pageCheckout() {
    if (!state.cart.length) { location.hash = '#/cart'; return; }
    if (requireLogin('#/checkout')) return;
    const c = state.cfg, sub = subtotal();
    let zone = 'dhaka', voucher = null;
    const calc = () => {
      const ship = voucher && voucher.freeShipping ? 0 : shipFor(zone, sub);
      const disc = voucher ? voucher.discount : 0;
      return { ship, disc, total: sub - disc + ship };
    };
    setView(`<div class="wrap section"><h1 style="font-size:var(--fs-600);margin-bottom:1rem">Checkout</h1>
      <div class="two-col">
        <form class="panel panel-pad form" id="coForm" novalidate>
          <h2 style="font-size:var(--fs-400)">Delivery address</h2>
          <div class="field-row">
            <div class="field"><label for="coName">Receiver name</label><input id="coName" value="${esc(state.user.name)}" autocomplete="name" required></div>
            <div class="field"><label for="coPhone">Mobile number</label><input id="coPhone" value="${esc(state.user.phone || '')}" inputmode="tel" placeholder="017XXXXXXXX" autocomplete="tel" required></div>
          </div>
          <div class="field"><label for="coAddr">Full address</label><textarea id="coAddr" placeholder="House, road, area" autocomplete="street-address" required></textarea></div>
          <div class="field"><label for="coCity">Area / District</label><input id="coCity" placeholder="e.g. Mirpur, Dhaka or Chattogram" autocomplete="address-level2" required></div>
          <fieldset class="zone">
            <legend>Delivery area</legend>
            <label class="zone-opt"><input type="radio" name="zone" value="dhaka" checked><span><b>Inside Dhaka</b><small>${money(c.feeDhaka)} · free over ${money(c.freeShipMin)}</small></span></label>
            <label class="zone-opt"><input type="radio" name="zone" value="outside"><span><b>Outside Dhaka</b><small>${money(c.feeOutside)}${c.freeShipOutside ? ' · free over ' + money(c.freeShipMin) : ''}</small></span></label>
          </fieldset>
          <h2 style="font-size:var(--fs-400)">Payment</h2>
          <div class="pay"><span aria-hidden="true">💵</span><div><b>Cash on delivery</b><div class="hint">Pay when your order arrives.</div></div></div>
          <div class="form-error" id="coErr" hidden></div>
          <button class="btn btn-accent btn-block" id="coBtn">Place order</button>
        </form>
        <aside class="panel panel-pad">
          <h2 style="font-size:var(--fs-400);margin-bottom:.6rem">Your items</h2>
          ${state.cart.map((i) => `<div class="sum-row"><span>${itemLine(i)}</span><span>${money(i.price * i.qty)}</span></div>`).join('')}
          <div class="voucher">
            <label for="vCode">Voucher code</label>
            <div class="voucher-row"><input id="vCode" placeholder="Enter code" autocapitalize="characters" autocomplete="off"><button type="button" class="btn btn-ghost btn-sm" id="vApply">Apply</button></div>
            <div class="hint" id="vMsg" aria-live="polite"></div>
          </div>
          <div id="sumBox"></div>
        </aside></div></div>`);

    const paint = () => {
      const r = calc();
      $('#sumBox').innerHTML = `<div class="sum-row"><span>Subtotal</span><span>${money(sub)}</span></div>
        ${r.disc ? `<div class="sum-row" style="color:var(--ok)"><span>Voucher ${esc(voucher.code)}</span><span>−${money(r.disc)}</span></div>` : ''}
        <div class="sum-row"><span>Delivery (${zone === 'outside' ? 'outside Dhaka' : 'inside Dhaka'})</span><span>${r.ship ? money(r.ship) : 'Free'}</span></div>
        <div class="sum-row sum-total"><span>Total</span><span>${money(r.total)}</span></div>`;
      $('#coBtn').textContent = 'Place order · ' + money(r.total);
    };
    paint();
    $$('input[name="zone"]').forEach((r) => r.addEventListener('change', () => { zone = r.value; paint(); }));

    const vMsg = $('#vMsg'), vCode = $('#vCode'), vApply = $('#vApply');
    const applyVoucher = async () => {
      const code = vCode.value.trim();
      if (!code) { vMsg.textContent = 'Enter a voucher code'; return; }
      vApply.disabled = true; vMsg.textContent = 'Checking...';
      try {
        voucher = await api('/vouchers/check', { method: 'POST', body: { code, items: state.cart.map((i) => ({ id: i.id, qty: i.qty, color: i.color || '', size: i.size || '' })) } });
        vCode.value = voucher.code; vCode.disabled = true;
        vMsg.innerHTML = `<span style="color:var(--ok)">✓ ${esc(voucher.code)} applied${voucher.freeShipping ? ': free delivery' : ': you save ' + money(voucher.discount)}</span> <button type="button" class="linkbtn" id="vRemove">Remove</button>`;
        $('#vRemove').addEventListener('click', () => { voucher = null; vCode.value = ''; vCode.disabled = false; vApply.disabled = false; vMsg.textContent = ''; paint(); });
      } catch (ex) {
        voucher = null; vApply.disabled = false;
        vMsg.innerHTML = `<span style="color:var(--sale)">${esc(ex.message)}</span>`;
      }
      paint();
    };
    vApply.addEventListener('click', applyVoucher);
    vCode.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); applyVoucher(); } });

    $('#coForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = $('#coBtn'), err = $('#coErr'); err.hidden = true; btn.disabled = true;
      try {
        const r = await api('/orders', { method: 'POST', body: {
          items: state.cart.map((i) => ({ id: i.id, qty: i.qty, color: i.color || '', size: i.size || '' })),
          name: $('#coName').value, phone: $('#coPhone').value, address: $('#coAddr').value,
          city: $('#coCity').value, zone, voucher_code: voucher ? voucher.code : '', payment_method: 'cod' } });
        state.cart = []; saveCart();
        location.hash = '#/success/' + r.id;
      } catch (ex) { err.textContent = ex.message; err.hidden = false; btn.disabled = false; }
    });
  }

  function pageSuccess(id) {
    const mail = esc(state.cfg.supportEmail);
    setView(`<div class="wrap section"><div class="panel empty"><div class="em">🎉</div><h2>Order placed</h2>
      <p>Your order <b>#${esc(id)}</b> is confirmed. We will call you before delivery.</p>
      <a class="btn" href="#/orders">View my orders</a> <a class="btn btn-ghost" href="#/">Continue shopping</a>
      <p class="hint" style="margin-top:1.2rem">Need help? Email <a class="link" href="mailto:${mail}">${mail}</a></p></div></div>`);
  }

  function authPage(mode) {
    const reg = mode === 'register';
    setView(`<div class="wrap section"><div class="panel panel-pad auth">
      <h1>${reg ? 'Create your account' : 'Welcome back'}</h1>
      <p class="muted" style="margin:0 0 1rem">${reg ? 'Order faster and track every delivery.' : 'Log in to see your orders and checkout faster.'}</p>
      <form class="form" id="authForm" novalidate>
        ${reg ? '<div class="field"><label for="aName">Full name</label><input id="aName" autocomplete="name" required></div>' : ''}
        <div class="field"><label for="aEmail">Email</label><input id="aEmail" type="email" autocomplete="email" required></div>
        ${reg ? '<div class="field"><label for="aPhone">Mobile number</label><input id="aPhone" inputmode="tel" placeholder="017XXXXXXXX" autocomplete="tel"></div>' : ''}
        <div class="field"><label for="aPass">Password</label><input id="aPass" type="password" autocomplete="${reg ? 'new-password' : 'current-password'}" required></div>
        <div class="form-error" id="aErr" hidden></div>
        <button class="btn btn-block" id="aBtn">${reg ? 'Create account' : 'Log in'}</button>
      </form>
      <p style="text-align:center;margin:1rem 0 0" class="muted">${reg ? 'Already have an account? <a class="link" href="#/login">Log in</a>' : 'New here? <a class="link" href="#/register">Create an account</a>'}</p>
    </div></div>`);
    $('#authForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = $('#aBtn'), err = $('#aErr'); err.hidden = true; btn.disabled = true;
      try {
        const body = { email: $('#aEmail').value, password: $('#aPass').value };
        if (reg) { body.name = $('#aName').value; body.phone = $('#aPhone').value; }
        setSession(await api(reg ? '/auth/register' : '/auth/login', { method: 'POST', body }));
        toast(reg ? 'Account created' : 'Logged in');
        const to = state.next || '#/'; state.next = null; location.hash = to;
      } catch (ex) { err.textContent = ex.message; err.hidden = false; btn.disabled = false; }
    });
  }

  const statusPill = (s) => `<span class="pill pill-${esc(s)}">${esc(s[0].toUpperCase() + s.slice(1))}</span>`;
  const dateFmt = (d) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

  const orderTotals = (o) => {
    const disc = Number(o.discount) || 0;
    return `<div class="order-sum">
      <span>Subtotal ${money(o.subtotal)}</span>
      ${disc ? `<span>Voucher ${esc(o.voucher_code || '')} −${money(disc)}</span>` : ''}
      <span>Delivery ${Number(o.shipping) ? money(o.shipping) : 'Free'} <small class="muted">(${o.zone === 'outside' ? 'outside Dhaka' : 'Dhaka'})</small></span>
      <b>Total ${money(o.total)}</b></div>`;
  };

  async function pageOrders() {
    if (requireLogin('#/orders')) return;
    const my = renderId;
    setView('<div class="wrap section"><div class="sk" style="height:12rem"></div></div>');
    const { orders } = await api('/orders/mine');
    if (my !== renderId) return;
    const mail = esc(state.cfg.supportEmail);
    setView(`<div class="wrap section" style="max-width:52rem">
      <div class="list-head"><h1>My orders</h1><button class="btn btn-ghost btn-sm" id="logout">Log out</button></div>
      ${orders.length ? orders.map((o) => `<article class="panel order">
        <div class="order-top"><b>Order #${o.id}</b>${statusPill(o.status)}<span class="muted">${dateFmt(o.created_at)}</span></div>
        <div class="order-items">${o.items.map((i) => `<span>${itemLine(i)}</span>`).join('')}</div>
        ${orderTotals(o)}
        <div class="hint" style="margin-top:.5rem">Deliver to ${esc(o.name)}, ${esc(o.address)}, ${esc(o.city)}</div></article>`).join('')
      : '<div class="panel empty"><div class="em">📦</div><h2>No orders yet</h2><p>When you place an order it will show up here.</p><a class="btn" href="#/shop">Start shopping</a></div>'}
      <p class="hint" style="text-align:center">Need help with an order? <a class="link" href="#/help">Help &amp; Support</a> · <a class="link" href="mailto:${mail}">${mail}</a></p>
    </div>`);
    $('#logout').addEventListener('click', () => { logout(); toast('Logged out'); location.hash = '#/'; });
  }

  /* ---------- admin ---------- */
  async function pageAdmin() {
    if (requireLogin('#/admin')) return;
    if (state.user.role !== 'admin') {
      return setView('<div class="wrap section"><div class="panel empty"><div class="em">🔒</div><h2>Admin only</h2><p>Log in with the admin email to manage the store.</p></div></div>');
    }
    setView(`<div class="wrap section"><div class="list-head"><h1>Store admin</h1><button class="btn btn-ghost btn-sm" id="logout">Log out</button></div>
      <div class="tabs" role="tablist">
        <button class="tab" role="tab" data-t="dash" aria-selected="true">Overview</button>
        <button class="tab" role="tab" data-t="products" aria-selected="false">Products</button>
        <button class="tab" role="tab" data-t="orders" aria-selected="false">Orders</button>
        <button class="tab" role="tab" data-t="vouchers" aria-selected="false">Vouchers</button>
        <button class="tab" role="tab" data-t="slides" aria-selected="false">Slideshow</button>
        <button class="tab" role="tab" data-t="cats" aria-selected="false">Categories</button>
        <button class="tab" role="tab" data-t="settings" aria-selected="false">Settings</button></div>
      <div id="adminBody"></div></div>`);
    $('#logout').addEventListener('click', () => { logout(); location.hash = '#/'; });
    const go = (t) => {
      $$('.tab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.t === t)));
      const bd = $('#adminBody'); bd.onclick = null; bd.onchange = null;
      ({ dash: adminDash, products: adminProducts, orders: adminOrders, vouchers: adminVouchers, slides: adminSlides, cats: adminCategories, settings: adminSettings })[t]();
    };
    $$('.tab').forEach((b) => b.addEventListener('click', () => go(b.dataset.t)));
    go('dash');
  }

  async function adminDash() {
    const body = $('#adminBody'); body.innerHTML = '<div class="sk" style="height:6rem"></div>';
    try {
      const { stats: s } = await api('/admin/stats');
      body.innerHTML = `<div class="stats">
        <div class="stat"><b>${money(s.revenue)}</b><span>Revenue</span></div>
        <div class="stat"><b>${s.orders}</b><span>Total orders</span></div>
        <div class="stat"><b>${s.pending}</b><span>Pending orders</span></div>
        <div class="stat"><b>${s.products}</b><span>Products</span></div>
        <div class="stat"><b>${s.users}</b><span>Customers</span></div></div>`;
    } catch (e) { body.innerHTML = `<div class="form-error">${esc(e.message)}</div>`; }
  }

  async function adminOrders() {
    const body = $('#adminBody'); body.innerHTML = '<div class="sk" style="height:10rem"></div>';
    try {
      const { orders } = await api('/admin/orders');
      const opts = ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'];
      body.innerHTML = orders.length ? orders.map((o) => `<article class="panel order" data-oid="${o.id}">
        <div class="order-top"><b>Order #${o.id}</b><span>${dateFmt(o.created_at)}</span>
          <select class="select" data-status aria-label="Order status">${opts.map((s) => `<option value="${s}" ${s === o.status ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
        <div class="order-items">${o.items.map((i) => `<span>${itemLine(i)}</span>`).join('')}</div>
        ${orderTotals(o)}
        <div class="ship-edit">
          <label for="sm${o.id}">Delivery charge for this order</label>
          <select class="select" id="sm${o.id}" data-ship-mode>
            <option value="auto" ${o.shipping_mode === 'auto' ? 'selected' : ''}>Standard charge</option>
            <option value="free" ${o.shipping_mode === 'free' ? 'selected' : ''}>Free delivery</option>
            <option value="custom" ${o.shipping_mode === 'custom' ? 'selected' : ''}>Custom amount</option></select>
          <input class="select ship-amt" type="number" min="0" step="1" data-ship-amt value="${Number(o.shipping) || 0}" aria-label="Custom delivery charge" ${o.shipping_mode === 'custom' ? '' : 'hidden'}>
          <button class="btn btn-ghost btn-sm" data-ship-save>Update delivery</button></div>
        <div class="hint" style="margin-top:.5rem">${esc(o.name)} · ${esc(o.phone)} · ${esc(o.address)}, ${esc(o.city)}</div></article>`).join('')
        : '<div class="panel empty"><h2>No orders yet</h2></div>';
      body.onchange = async (e) => {
        const art = e.target.closest('[data-oid]'); if (!art) return;
        if (e.target.matches('[data-status]')) {
          try { await api('/admin/orders/' + art.dataset.oid, { method: 'PATCH', body: { status: e.target.value } }); toast('Order updated'); }
          catch (ex) { toast(ex.message, 'err'); }
        }
        if (e.target.matches('[data-ship-mode]')) art.querySelector('[data-ship-amt]').hidden = e.target.value !== 'custom';
      };
      body.onclick = async (e) => {
        const b = e.target.closest('[data-ship-save]'); if (!b) return;
        const art = b.closest('[data-oid]');
        try {
          await api(`/admin/orders/${art.dataset.oid}/shipping`, { method: 'PATCH', body: {
            mode: art.querySelector('[data-ship-mode]').value, amount: art.querySelector('[data-ship-amt]').value } });
          toast('Delivery charge updated'); adminOrders();
        } catch (ex) { toast(ex.message, 'err'); }
      };
    } catch (e) { body.innerHTML = `<div class="form-error">${esc(e.message)}</div>`; }
  }

  async function adminVouchers() {
    const body = $('#adminBody'); body.innerHTML = '<div class="sk" style="height:8rem"></div>';
    try {
      const { vouchers } = await api('/admin/vouchers');
      const offer = (v) => v.type === 'percent' ? `${v.value}% off${v.max_discount ? ` (max ${money(v.max_discount)})` : ''}`
        : v.type === 'fixed' ? `${money(v.value)} off` : 'Free delivery';
      body.innerHTML = `<div class="sec-head"><h2 style="font-size:var(--fs-400)">${vouchers.length} vouchers</h2><button class="btn btn-sm" id="newV">Add voucher</button></div>
        <div id="vForm"></div>
        ${vouchers.length ? `<div class="panel table-wrap"><table><thead><tr><th>Code</th><th>Offer</th><th>Min order</th><th>Used</th><th>Expires</th><th>Status</th><th></th></tr></thead><tbody>
        ${vouchers.map((v) => `<tr><td><b>${esc(v.code)}</b></td><td>${esc(offer(v))}</td><td>${v.min_order ? money(v.min_order) : '-'}</td>
          <td>${v.used_count}${v.usage_limit ? ' / ' + v.usage_limit : ''}</td><td>${v.expires_at ? dateFmt(v.expires_at) : 'No expiry'}</td>
          <td><span class="pill ${v.is_active ? 'pill-ok' : 'pill-out'}">${v.is_active ? 'Active' : 'Off'}</span></td>
          <td><div class="t-actions"><button class="btn btn-ghost btn-sm" data-vt="${v.id}" data-on="${v.is_active ? 0 : 1}">${v.is_active ? 'Disable' : 'Enable'}</button>
          <button class="btn btn-danger btn-sm" data-vd="${v.id}">Delete</button></div></td></tr>`).join('')}</tbody></table></div>`
        : '<div class="panel empty"><h2>No vouchers yet</h2><p>Create a code your customers can use at checkout.</p></div>'}`;

      $('#newV').addEventListener('click', () => {
        $('#vForm').innerHTML = `<form class="panel panel-pad form" id="vf" style="margin-bottom:1rem" novalidate>
          <h3>New voucher</h3>
          <div class="field-row">
            <div class="field"><label for="vfCode">Code</label><input id="vfCode" placeholder="e.g. EID100" autocapitalize="characters" autocomplete="off"></div>
            <div class="field"><label for="vfType">Type</label><select id="vfType"><option value="percent">Percent off</option><option value="fixed">Fixed amount off</option><option value="free_shipping">Free delivery</option></select></div></div>
          <div class="field-row" id="vfValRow">
            <div class="field"><label for="vfVal" id="vfValLbl">Percent (%)</label><input id="vfVal" type="number" min="1" step="1"></div>
            <div class="field" id="vfMaxWrap"><label for="vfMax">Max discount (৳, optional)</label><input id="vfMax" type="number" min="1" step="1"></div></div>
          <div class="field-row">
            <div class="field"><label for="vfMin">Minimum order (৳)</label><input id="vfMin" type="number" min="0" step="1" value="0"></div>
            <div class="field"><label for="vfLim">Usage limit (optional)</label><input id="vfLim" type="number" min="1" step="1" placeholder="Unlimited"></div></div>
          <div class="field"><label for="vfExp">Expiry date (optional)</label><input id="vfExp" type="date"></div>
          <p class="hint">Each customer can use a voucher code only once.</p>
          <div class="form-error" id="vfErr" hidden></div>
          <div class="t-actions"><button class="btn">Create voucher</button><button type="button" class="btn btn-ghost" id="vfCancel">Cancel</button></div></form>`;
        const type = $('#vfType');
        const sync = () => {
          $('#vfValRow').hidden = type.value === 'free_shipping';
          $('#vfMaxWrap').hidden = type.value !== 'percent';
          $('#vfValLbl').textContent = type.value === 'percent' ? 'Percent (%)' : 'Amount (৳)';
        };
        type.addEventListener('change', sync); sync();
        $('#vfCancel').addEventListener('click', () => { $('#vForm').innerHTML = ''; });
        $('#vf').addEventListener('submit', async (e) => {
          e.preventDefault();
          try {
            await api('/admin/vouchers', { method: 'POST', body: {
              code: $('#vfCode').value, type: type.value, value: $('#vfVal').value, min_order: $('#vfMin').value,
              max_discount: $('#vfMax').value, usage_limit: $('#vfLim').value, expires_at: $('#vfExp').value } });
            toast('Voucher created'); adminVouchers();
          } catch (ex) { $('#vfErr').textContent = ex.message; $('#vfErr').hidden = false; }
        });
        $('#vf').scrollIntoView({ behavior: 'smooth', block: 'center' });
      });

      body.onclick = async (e) => {
        const t = e.target.closest('[data-vt]'), d = e.target.closest('[data-vd]');
        try {
          if (t) { await api('/admin/vouchers/' + t.dataset.vt, { method: 'PATCH', body: { is_active: t.dataset.on === '1' } }); adminVouchers(); }
          if (d && confirm('Delete this voucher?')) { await api('/admin/vouchers/' + d.dataset.vd, { method: 'DELETE' }); toast('Voucher deleted'); adminVouchers(); }
        } catch (ex) { toast(ex.message, 'err'); }
      };
    } catch (e) { body.innerHTML = `<div class="form-error">${esc(e.message)}</div>`; }
  }

  /* ---------- admin: shared bits ---------- */
  const SIZE_GROUPS = [['Clothing', ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL']], ['Waist / pants (inches)', ['28', '30', '32', '34', '36', '38', '40', '42']], ['Shoes', ['38', '39', '40', '41', '42', '43', '44', '45']], ['One size', ['Free Size']]];
  const EMOJIS = ['📱', '🎧', '💻', '📷', '⌚', '👕', '👖', '👟', '👗', '👜', '💄', '🧴', '🏠', '🛋️', '🍳', '🛒', '🍎', '🥛', '⚽', '🏏', '📚', '🧸', '🎁', '💊', '🚲', '🐾', '⚡', '🏷️', '📦', '🚚', '🎉'];
  const emojiRow = (target) => `<div class="emoji-row" data-target="${target}">${EMOJIS.map((e) => `<button type="button" class="emoji-btn" data-e="${e}" aria-label="Use ${e}">${e}</button>`).join('')}</div>`;
  function wireEmoji(root, mode) {
    $$('.emoji-btn', root).forEach((b) => b.addEventListener('click', () => {
      const t = $('#' + b.closest('.emoji-row').dataset.target);
      t.value = mode === 'append' ? (t.value + ' ' + b.dataset.e).trim() : b.dataset.e;
      t.dispatchEvent(new Event('input'));
    }));
  }
  const uploaderHtml = (id, value, label) => `<div class="field"><label for="${id}Pick">${label}</label>
    <div class="uploader"><div class="up-preview" id="${id}Prev"></div>
      <div class="up-side"><button type="button" class="btn btn-ghost btn-sm" id="${id}Pick">Upload photo</button>
        <button type="button" class="linkbtn" id="${id}Clear" hidden>Remove photo</button>
        <input type="file" id="${id}File" accept="image/*" hidden>
        <div class="hint" id="${id}Status" aria-live="polite">JPG, PNG or WEBP. Resized automatically.</div></div></div>
    <input id="${id}Img" placeholder="Or paste an image link (https://...)" value="${esc(value || '')}" style="margin-top:.5rem" aria-label="Image link"></div>`;
  function wireUploader(id, { onChange, busy, icon = '📷', max = 1400 }) {
    const prev = $('#' + id + 'Prev'), status = $('#' + id + 'Status'), pick = $('#' + id + 'Pick'),
      file = $('#' + id + 'File'), url = $('#' + id + 'Img'), clear = $('#' + id + 'Clear');
    const show = () => { prev.innerHTML = img({ id: 0, title: 'Preview', image_url: url.value.trim() || null, icon }, 400); clear.hidden = !url.value.trim(); };
    url.addEventListener('input', () => { show(); onChange(); });
    clear.addEventListener('click', () => { url.value = ''; show(); onChange(); });
    pick.addEventListener('click', () => file.click());
    file.addEventListener('change', async () => {
      const f = file.files[0]; if (!f) return;
      if (!f.type.startsWith('image/')) { status.textContent = 'Please choose an image file.'; return; }
      if (f.size > 15 * 1024 * 1024) { status.textContent = 'Image is too large (max 15 MB).'; return; }
      pick.disabled = true; busy(true); status.textContent = 'Preparing photo...';
      try {
        url.value = await uploadImage(await shrink(f, max), (n) => { status.textContent = 'Uploading... ' + n + '%'; });
        show(); onChange(); status.textContent = 'Photo uploaded ✓ Now press Save.';
      } catch (ex) { status.textContent = ex.message; toast(ex.message, 'err'); }
      pick.disabled = false; busy(false); file.value = '';
    });
    show();
  }

  /* ---------- admin: slideshow ---------- */
  async function adminSlides() {
    const body = $('#adminBody'); body.innerHTML = '<div class="sk" style="height:8rem"></div>';
    try {
      const [{ slides }, cats] = await Promise.all([api('/admin/slides'), loadCats(true)]);
      const themes = { green: 'Green', saffron: 'Saffron', dark: 'Dark', blue: 'Blue', red: 'Red' };
      body.innerHTML = `<div class="sec-head"><h2 style="font-size:var(--fs-400)">${slides.length} slides</h2><button class="btn btn-sm" id="newS">Add slide</button></div>
        <p class="hint" style="margin:-.4rem 0 1rem">These slides show at the top of your home page. Use the arrows to change the order.</p>
        <div id="sForm"></div>
        <div>${slides.map((sl, i) => `<div class="panel slide-row${sl.is_active ? '' : ' off'}" data-sid="${sl.id}">
          <div class="sr-thumb theme-${esc(sl.theme)}"${sl.image_url ? ` style="--slide-img:url('${safeCssUrl(cl(sl.image_url, 300))}')"` : ''}>${sl.image_url ? '' : esc((sl.emoji || '').split(' ')[0] || '🖼️')}</div>
          <div class="sr-main"><b>${esc(sl.title)}</b>${sl.subtitle ? `<span class="hint">${esc(sl.subtitle)}</span>` : ''}
            <span class="hint">${sl.button_text ? `Button: ${esc(sl.button_text)} → ${esc(sl.button_link)}` : 'No button'}${sl.is_active ? '' : ' · Hidden'}</span></div>
          <div class="sr-actions">
            <button class="btn btn-ghost btn-sm" data-up ${i === 0 ? 'disabled' : ''} aria-label="Move up">↑</button>
            <button class="btn btn-ghost btn-sm" data-down ${i === slides.length - 1 ? 'disabled' : ''} aria-label="Move down">↓</button>
            <button class="btn btn-ghost btn-sm" data-edit>Edit</button>
            <button class="btn btn-ghost btn-sm" data-toggle>${sl.is_active ? 'Hide' : 'Show'}</button>
            <button class="btn btn-danger btn-sm" data-del>Delete</button></div></div>`).join('')}</div>
        ${slides.length ? '' : '<div class="panel empty"><h2>No slides</h2><p>Your home page will show no banner. Add a slide to bring it back.</p></div>'}`;

      const form = (sl = {}) => {
        const v = { title: sl.title || '', subtitle: sl.subtitle || '', button_text: sl.button_text || '', button_link: sl.button_link || '',
          theme: sl.theme || 'green', emoji: sl.emoji || '', image_url: sl.image_url || '', is_active: sl.is_active === undefined ? 1 : sl.is_active };
        $('#sForm').innerHTML = `<form class="panel panel-pad form" id="sf" style="margin-bottom:1rem" novalidate>
          <h3>${sl.id ? 'Edit slide' : 'New slide'}</h3>
          <div class="field"><label>Preview</label><div class="hero hero-preview" id="sfPrev"></div></div>
          <div class="field"><label for="sfTitle">Headline</label><input id="sfTitle" maxlength="120" value="${esc(v.title)}" placeholder="e.g. Eid sale, up to 50% off"></div>
          <div class="field"><label for="sfSub">Sub text (optional)</label><input id="sfSub" maxlength="200" value="${esc(v.subtitle)}"></div>
          <div class="field-row">
            <div class="field"><label for="sfBtn">Button text (optional)</label><input id="sfBtn" maxlength="40" value="${esc(v.button_text)}" placeholder="e.g. Shop now"></div>
            <div class="field"><label for="sfLink">Button link</label><input id="sfLink" value="${esc(v.button_link)}" placeholder="#/sale or https://..."></div></div>
          <div class="field"><label for="sfQuick">Quick link</label><select id="sfQuick"><option value="">Choose a page to link to...</option>
            <option value="#/shop">All products</option><option value="#/sale">Flash sale</option><option value="#/help">Help &amp; Support</option>
            ${cats.map((c) => `<option value="#/category/${esc(c.slug)}">Category: ${esc(c.name)}</option>`).join('')}</select></div>
          <fieldset class="zone"><legend>Colour</legend><div class="swatches">${Object.entries(themes).map(([k, n]) =>
            `<label class="swatch"><input type="radio" name="sfTheme" value="${k}" ${v.theme === k ? 'checked' : ''}><span class="sw theme-${k}"></span><small>${n}</small></label>`).join('')}</div></fieldset>
          <div class="field"><label for="sfEmoji">Decoration emoji (shown on the right when there is no photo)</label><input id="sfEmoji" maxlength="30" value="${esc(v.emoji)}" placeholder="e.g. 🎉 🛍️">${emojiRow('sfEmoji')}</div>
          ${uploaderHtml('sfPhoto', v.image_url, 'Background photo (optional)')}
          <label class="check"><input type="checkbox" id="sfActive" ${v.is_active ? 'checked' : ''}> Show this slide on the home page</label>
          <div class="form-error" id="sfErr" hidden></div>
          <div class="t-actions"><button class="btn" id="sfSave">Save slide</button><button type="button" class="btn btn-ghost" id="sfCancel">Cancel</button></div></form>`;
        const cur = () => ({ title: $('#sfTitle').value.trim(), subtitle: $('#sfSub').value.trim(), button_text: $('#sfBtn').value.trim(),
          button_link: $('#sfLink').value.trim(), theme: $('input[name="sfTheme"]:checked').value, emoji: $('#sfEmoji').value.trim(),
          image_url: $('#sfPhotoImg').value.trim(), is_active: $('#sfActive').checked });
        const refresh = () => {
          const c = cur(), pv = $('#sfPrev');
          pv.dataset.dots = dotsTone(c);
          pv.innerHTML = slideHtml({ ...c, title: c.title || 'Your headline appears here' }, true);
        };
        $('#sfPrev').addEventListener('click', (e) => { if (e.target.closest('a')) e.preventDefault(); });
        ['#sfTitle', '#sfSub', '#sfBtn', '#sfLink', '#sfEmoji'].forEach((id) => $(id).addEventListener('input', refresh));
        $$('input[name="sfTheme"]').forEach((r) => r.addEventListener('change', refresh));
        $('#sfQuick').addEventListener('change', (e) => { if (e.target.value) { $('#sfLink').value = e.target.value; refresh(); } });
        wireEmoji($('#sf'), 'append');
        wireUploader('sfPhoto', { onChange: refresh, busy: (b) => { $('#sfSave').disabled = b; }, icon: '🖼️', max: 1800 });
        refresh();
        $('#sfCancel').addEventListener('click', () => { $('#sForm').innerHTML = ''; });
        $('#sf').addEventListener('submit', async (e) => {
          e.preventDefault();
          try {
            await api(sl.id ? '/admin/slides/' + sl.id : '/admin/slides', { method: sl.id ? 'PUT' : 'POST', body: cur() });
            toast('Slide saved'); adminSlides();
          } catch (ex) { $('#sfErr').textContent = ex.message; $('#sfErr').hidden = false; }
        });
        $('#sf').scrollIntoView({ behavior: 'smooth', block: 'start' });
      };
      $('#newS').addEventListener('click', () => form());

      body.onclick = async (e) => {
        const row = e.target.closest('[data-sid]'); if (!row) return;
        const id = +row.dataset.sid, sl = slides.find((x) => x.id === id);
        try {
          if (e.target.closest('[data-edit]')) form(sl);
          else if (e.target.closest('[data-toggle]')) { await api('/admin/slides/' + id, { method: 'PUT', body: { ...sl, is_active: !sl.is_active } }); adminSlides(); }
          else if (e.target.closest('[data-del]')) {
            if (confirm('Delete this slide?')) { await api('/admin/slides/' + id, { method: 'DELETE' }); toast('Slide deleted'); adminSlides(); }
          } else if (e.target.closest('[data-up]') || e.target.closest('[data-down]')) {
            const ids = slides.map((x) => x.id), i = ids.indexOf(id), j = i + (e.target.closest('[data-up]') ? -1 : 1);
            [ids[i], ids[j]] = [ids[j], ids[i]];
            await api('/admin/slides/reorder', { method: 'POST', body: { ids } }); adminSlides();
          }
        } catch (ex) { toast(ex.message, 'err'); }
      };
    } catch (e) { body.innerHTML = `<div class="form-error">${esc(e.message)}</div>`; }
  }

  /* ---------- admin: categories ---------- */
  async function adminCategories() {
    const body = $('#adminBody'); body.innerHTML = '<div class="sk" style="height:8rem"></div>';
    try {
      const { categories } = await api('/admin/categories');
      body.innerHTML = `<div class="sec-head"><h2 style="font-size:var(--fs-400)">${categories.length} categories</h2><button class="btn btn-sm" id="newC">Add category</button></div>
        <div id="cForm"></div>
        <div>${categories.map((c, i) => `<div class="panel slide-row" data-cid="${c.id}">
          <div class="sr-thumb cat">${esc(c.icon)}</div>
          <div class="sr-main"><b>${esc(c.name)}</b><span class="hint">${c.products} product${c.products === 1 ? '' : 's'}${c.has_sizes ? ' · uses sizes' : ''}</span></div>
          <div class="sr-actions">
            <button class="btn btn-ghost btn-sm" data-up ${i === 0 ? 'disabled' : ''} aria-label="Move up">↑</button>
            <button class="btn btn-ghost btn-sm" data-down ${i === categories.length - 1 ? 'disabled' : ''} aria-label="Move down">↓</button>
            <button class="btn btn-ghost btn-sm" data-edit>Edit</button>
            <button class="btn btn-danger btn-sm" data-del>Delete</button></div></div>`).join('')}</div>`;
      const changed = () => { state.cats = []; adminCategories(); };
      const form = (c = {}) => {
        $('#cForm').innerHTML = `<form class="panel panel-pad form" id="cf" style="margin-bottom:1rem" novalidate>
          <h3>${c.id ? 'Edit category' : 'New category'}</h3>
          <div class="field-row">
            <div class="field"><label for="cfName">Name</label><input id="cfName" maxlength="40" value="${esc(c.name || '')}" placeholder="e.g. Books"></div>
            <div class="field"><label for="cfIcon">Icon (emoji)</label><input id="cfIcon" maxlength="16" value="${esc(c.icon || '')}" placeholder="🛍️"></div></div>
          ${emojiRow('cfIcon')}
          <label class="check"><input type="checkbox" id="cfSizes" ${c.has_sizes ? 'checked' : ''}> This category uses sizes (clothes, shoes...)</label>
          <p class="hint" style="margin:-.3rem 0 0">When on, every product in this category needs sizes with stock for each size, and customers must choose a size.</p>
          <div class="form-error" id="cfErr" hidden></div>
          <div class="t-actions"><button class="btn">Save category</button><button type="button" class="btn btn-ghost" id="cfCancel">Cancel</button></div></form>`;
        wireEmoji($('#cf'), 'replace');
        $('#cfCancel').addEventListener('click', () => { $('#cForm').innerHTML = ''; });
        $('#cf').addEventListener('submit', async (e) => {
          e.preventDefault();
          try {
            await api(c.id ? '/admin/categories/' + c.id : '/admin/categories', { method: c.id ? 'PUT' : 'POST', body: { name: $('#cfName').value, icon: $('#cfIcon').value, has_sizes: $('#cfSizes').checked } });
            toast('Category saved'); changed();
          } catch (ex) { $('#cfErr').textContent = ex.message; $('#cfErr').hidden = false; }
        });
        $('#cf').scrollIntoView({ behavior: 'smooth', block: 'center' });
      };
      $('#newC').addEventListener('click', () => form());
      body.onclick = async (e) => {
        const row = e.target.closest('[data-cid]'); if (!row) return;
        const id = +row.dataset.cid, c = categories.find((x) => x.id === id);
        try {
          if (e.target.closest('[data-edit]')) form(c);
          else if (e.target.closest('[data-del]')) {
            if (confirm(`Delete category "${c.name}"?`)) { await api('/admin/categories/' + id, { method: 'DELETE' }); toast('Category deleted'); changed(); }
          } else if (e.target.closest('[data-up]') || e.target.closest('[data-down]')) {
            const ids = categories.map((x) => x.id), i = ids.indexOf(id), j = i + (e.target.closest('[data-up]') ? -1 : 1);
            [ids[i], ids[j]] = [ids[j], ids[i]];
            await api('/admin/categories/reorder', { method: 'POST', body: { ids } }); changed();
          }
        } catch (ex) { toast(ex.message, 'err'); }
      };
    } catch (e) { body.innerHTML = `<div class="form-error">${esc(e.message)}</div>`; }
  }

  /* ---------- admin: site settings ---------- */
  async function adminSettings() {
    const body = $('#adminBody'); body.innerHTML = '<div class="sk" style="height:12rem"></div>';
    try {
      const { settings: c } = await api('/admin/settings');
      body.innerHTML = `<form class="panel panel-pad form" id="setForm" novalidate style="max-width:44rem">
        <h3>Shop details</h3>
        <div class="field"><label for="stName">Shop name</label><input id="stName" maxlength="40" value="${esc(c.siteName)}"></div>
        <div class="field-row">
          <div class="field"><label for="stMail">Support email</label><input id="stMail" type="email" value="${esc(c.supportEmail)}"></div>
          <div class="field"><label for="stPhone">Support phone (optional)</label><input id="stPhone" inputmode="tel" value="${esc(c.supportPhone)}" placeholder="01XXXXXXXXX"></div></div>
        <h3 style="margin-top:.6rem">Delivery charge</h3>
        <div class="field-row">
          <div class="field"><label for="stDhaka">Inside Dhaka (৳)</label><input id="stDhaka" type="number" min="0" step="1" value="${c.feeDhaka}"></div>
          <div class="field"><label for="stOut">Outside Dhaka (৳)</label><input id="stOut" type="number" min="0" step="1" value="${c.feeOutside}"></div></div>
        <div class="field"><label for="stFree">Free delivery on orders over (৳)</label><input id="stFree" type="number" min="0" step="1" value="${c.freeShipMin}"></div>
        <label class="check"><input type="checkbox" id="stFreeOut" ${c.freeShipOutside ? 'checked' : ''}> Also give free delivery outside Dhaka over this amount</label>
        <h3 style="margin-top:.6rem">Stock display</h3>
        <label class="check"><input type="checkbox" id="stHide" ${c.hideStock ? 'checked' : ''}> <span>Hide stock from customers on all products (no "In stock" or "Only 3 left")</span></label>
        <p class="hint">Sold-out products still show "Sold out". You can also hide stock for a single product when you edit it.</p>
        <p class="hint">You can also make a single order free from Orders → Delivery charge for this order.</p>
        <h3 style="margin-top:.6rem">Website text</h3>
        <div class="field"><label for="stTop">Top bar message (optional)</label><input id="stTop" maxlength="140" value="${esc(c.topbarText)}" placeholder="Leave empty to show delivery charges automatically"></div>
        <div class="field"><label for="stFoot">Footer text (optional)</label><input id="stFoot" maxlength="200" value="${esc(c.footerText)}" placeholder="Leave empty for the default text"></div>
        <div class="form-error" id="stErr" hidden></div>
        <div class="t-actions"><button class="btn" id="stSave">Save settings</button></div></form>`;
      $('#setForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = $('#stSave'), err = $('#stErr'); err.hidden = true; btn.disabled = true;
        try {
          const r = await api('/admin/settings', { method: 'PUT', body: {
            siteName: $('#stName').value, supportEmail: $('#stMail').value, supportPhone: $('#stPhone').value,
            feeDhaka: $('#stDhaka').value, feeOutside: $('#stOut').value, freeShipMin: $('#stFree').value,
            freeShipOutside: $('#stFreeOut').checked, hideStock: $('#stHide').checked, topbarText: $('#stTop').value, footerText: $('#stFoot').value } });
          state.cfg = { ...state.cfg, ...r.settings }; applyConfig();
          toast('Settings saved');
        } catch (ex) { err.textContent = ex.message; err.hidden = false; }
        btn.disabled = false;
      });
    } catch (e) { body.innerHTML = `<div class="form-error">${esc(e.message)}</div>`; }
  }

  /* ---------- photo upload (Cloudinary, signed) ---------- */
  async function shrink(file, max = 1400) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return file; // gif etc. jemon ache temon
    try {
      const bmp = await createImageBitmap(file);
      const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas');
      c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); // transparent PNG er jonno
      ctx.drawImage(bmp, 0, 0, c.width, c.height);
      const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
      return blob && blob.size < file.size ? blob : file;
    } catch { return file; }
  }

  async function uploadImage(file, onProgress) {
    const sig = await api('/admin/upload-signature');
    const fd = new FormData();
    fd.append('file', file, file.name || 'photo.jpg');
    fd.append('api_key', sig.api_key);
    fd.append('timestamp', sig.timestamp);
    fd.append('folder', sig.folder);
    fd.append('signature', sig.signature);
    return new Promise((resolve, reject) => {
      const x = new XMLHttpRequest();
      x.open('POST', `https://api.cloudinary.com/v1_1/${sig.cloud_name}/image/upload`);
      x.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)); };
      x.onload = () => {
        let d = {}; try { d = JSON.parse(x.responseText); } catch { /* ignore */ }
        if (x.status >= 200 && x.status < 300 && d.secure_url) resolve(d.secure_url);
        else reject(new Error((d.error && d.error.message) || 'Upload failed. Please try again.'));
      };
      x.onerror = () => reject(new Error('Network error while uploading. Please try again.'));
      x.send(fd);
    });
  }

  const COLOR_PRESETS = [['Black', '#111111'], ['White', '#ffffff'], ['Gray', '#9ca3af'], ['Red', '#dc2626'], ['Maroon', '#7f1d1d'], ['Orange', '#f97316'],
    ['Yellow', '#facc15'], ['Green', '#16a34a'], ['Olive', '#65753a'], ['Blue', '#2563eb'], ['Navy', '#1e3a8a'], ['Sky Blue', '#38bdf8'],
    ['Purple', '#7c3aed'], ['Pink', '#ec4899'], ['Brown', '#78350f'], ['Beige', '#d6c3a3']];

  async function adminProducts() {
    const body = $('#adminBody'); body.innerHTML = '<div class="sk" style="height:10rem"></div>';
    try {
      const cats = await loadCats(true);
      const { products, total } = await api('/products?limit=48&sort=new&_=' + Date.now());
      body.innerHTML = `
        <div class="sec-head"><h2 style="font-size:var(--fs-400)">${total} products</h2><button class="btn btn-sm" id="newP">Add product</button></div>
        <div id="pForm"></div>
        <div class="panel table-wrap"><table><thead><tr><th></th><th>Title</th><th>Price</th><th>Stock</th><th></th></tr></thead><tbody>
        ${products.map((p) => `<tr><td><div class="thumb-sm">${img(p, 120)}</div></td>
          <td>${esc(p.title)}<div class="hint">${esc(p.category_name)}</div>
            <div class="pill-row">${p.is_out_of_stock ? '<span class="pill pill-out">Marked out of stock</span>' : ''}${p.hide_stock ? '<span class="pill pill-pending">Stock hidden</span>' : ''}</div></td>
          <td>${money(p.price)}</td><td>${p.stock}</td>
          <td><div class="t-actions"><button class="btn btn-ghost btn-sm" data-edit="${p.id}">Edit</button><button class="btn btn-danger btn-sm" data-del="${p.id}">Delete</button></div></td></tr>`).join('')}
        </tbody></table></div>`;

      const form = (p = {}) => {
        $('#pForm').innerHTML = `<form class="panel panel-pad form" id="pf" style="margin-bottom:1rem" novalidate>
          <h3>${p.id ? 'Edit product' : 'New product'}</h3>
          <div class="field"><label for="pTitle">Title</label><input id="pTitle" value="${esc(p.title || '')}" required></div>
          <div class="field-row">
            <div class="field"><label for="pCat">Category</label><select id="pCat">${cats.map((c) => `<option value="${c.id}" data-sizes="${c.has_sizes ? 1 : 0}" ${c.id === p.category_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
            <div class="field" id="pStockWrap"><label for="pStock">Stock</label><input id="pStock" type="number" min="0" value="${p.stock ?? 10}"></div></div>

          <fieldset class="sizes-box" id="pColors">
            <legend>Colours (optional)</legend>
            <p class="hint">If this product comes in more than one colour, tap the colours below. Customers must pick one.</p>
            <div class="size-presets">${COLOR_PRESETS.map(([n, h]) => `<button type="button" class="color-preset" data-n="${esc(n)}" data-h="${h}"><span class="dot sm" style="--c:${h}"></span>${esc(n)}</button>`).join('')}</div>
            <div class="color-custom"><input id="colorName" maxlength="30" placeholder="Other colour, e.g. Mustard" aria-label="Colour name"><input type="color" id="colorHex" value="#888888" aria-label="Pick the colour"><button type="button" class="btn btn-ghost btn-sm" id="colorAdd">Add colour</button></div>
            <div class="chip-list" id="colorChips"></div>
          </fieldset>

          <fieldset class="sizes-box" id="pSizes" hidden>
            <legend>Sizes</legend>
            <p class="hint">Tap the sizes you have. Customers must pick one.</p>
            ${SIZE_GROUPS.map(([g, list]) => `<div class="size-group"><span class="hint">${g}</span><div class="size-presets">${list.map((z) => `<button type="button" class="size-preset" data-v="${esc(z)}">${esc(z)}</button>`).join('')}</div></div>`).join('')}
            <div class="size-custom"><input id="sizeCustom" maxlength="20" placeholder="Other size, e.g. 5XL or 44" aria-label="Custom size"><button type="button" class="btn btn-ghost btn-sm" id="sizeAdd">Add size</button></div>
            <div class="chip-list" id="sizeChips"></div>
          </fieldset>

          <fieldset class="sizes-box" id="pStockGrid" hidden>
            <legend>Stock for each option</legend>
            <p class="hint">Type how many pieces you have. Use 0 if an option is sold out.</p>
            <div id="optRows"></div>
            <div class="size-total">Total stock: <b id="sizeTotal">0</b></div>
          </fieldset>

          <div class="field-row">
            <div class="field"><label for="pPrice">Price (৳)</label><input id="pPrice" type="number" min="1" step="1" value="${p.price || ''}"></div>
            <div class="field"><label for="pOld">Old price (৳, optional)</label><input id="pOld" type="number" min="0" step="1" value="${p.old_price || ''}"></div></div>
          <div class="field-row">
            <div class="field"><label for="pRating">Rating shown to customers (0–5)</label><input id="pRating" type="number" min="0" max="5" step="0.1" value="${p.rating ?? 4.5}"><span class="hint">Use 0 to hide the rating.</span></div>
            <div class="field"><label for="pSold">Sold count shown to customers</label><input id="pSold" type="number" min="0" step="1" value="${p.sold ?? 0}"><span class="hint">Real orders add to this number. Use 0 to hide it.</span></div></div>

          <div class="field"><label for="imgAdd">Product photos</label>
            <p class="hint" style="margin:0 0 .5rem">The first photo is the main photo. Add up to 10. Customers can swipe through them.</p>
            <div class="img-grid" id="imgGrid"></div>
            <div class="t-actions" style="margin-top:.6rem"><button type="button" class="btn btn-ghost btn-sm" id="imgAdd">Add photos</button><input type="file" id="imgFile" accept="image/*" multiple hidden></div>
            <div class="hint" id="imgStatus" aria-live="polite">JPG, PNG or WEBP. You can pick several photos at once.</div>
            <div class="link-row" style="margin-top:.5rem"><input id="imgLink" placeholder="Or paste a photo link (https://...)" aria-label="Photo link"><button type="button" class="btn btn-ghost btn-sm" id="imgLinkAdd">Add link</button></div></div>

          <div class="field"><label for="pDesc">Description</label><textarea id="pDesc">${esc(p.description || '')}</textarea></div>
          <label class="check"><input type="checkbox" id="pFeat" ${p.is_featured ? 'checked' : ''}> Featured product</label>
          <label class="check"><input type="checkbox" id="pOut" ${p.is_out_of_stock ? 'checked' : ''}> <span>Mark as <b>out of stock</b> (customers see "Sold out" and cannot buy)</span></label>
          <label class="check"><input type="checkbox" id="pHide" ${p.hide_stock ? 'checked' : ''}> <span>Hide stock from customers (no "In stock" or "Only 3 left")</span></label>
          <div class="form-error" id="pErr" hidden></div>
          <div class="t-actions"><button class="btn" id="pSave">Save product</button><button type="button" class="btn btn-ghost" id="pCancel">Cancel</button></div></form>`;
        $('#pCancel').addEventListener('click', () => { $('#pForm').innerHTML = ''; });

        // ---- colours + sizes + stock grid ----
        const key = (c, z) => `${c.toLowerCase()}|${z.toLowerCase()}`;
        let sizes = [], colors = [], stockMap = {};
        (p.variants || []).forEach((v) => {
          if (v.size && !sizes.includes(v.size)) sizes.push(v.size);
          if (v.color && !colors.some((c) => c.name === v.color)) colors.push({ name: v.color, hex: v.color_hex || '#cccccc' });
          stockMap[key(v.color, v.size)] = v.stock;
        });
        const usesSizes = () => $('#pCat').selectedOptions[0].dataset.sizes === '1';
        const cols = () => (usesSizes() ? sizes : ['']);
        const rows = () => (colors.length ? colors : [{ name: '', hex: null }]);
        const hasOptions = () => usesSizes() || colors.length > 0;
        const total = () => { $('#sizeTotal').textContent = rows().reduce((n, c) => n + cols().reduce((m, z) => m + (parseInt(stockMap[key(c.name, z)]) || 0), 0), 0); };
        const fillDefaults = () => rows().forEach((c) => cols().forEach((z) => { if (stockMap[key(c.name, z)] === undefined) stockMap[key(c.name, z)] = 10; }));
        const renderOpts = () => {
          fillDefaults();
          $('#sizeChips').innerHTML = sizes.length ? sizes.map((z, i) => `<span class="chip-x">${esc(z)}<button type="button" data-sx="${i}" aria-label="Remove size ${esc(z)}">✕</button></span>`).join('') : '<span class="hint">No sizes yet.</span>';
          $$('.size-preset').forEach((b) => b.classList.toggle('on', sizes.some((z) => z.toLowerCase() === b.dataset.v.toLowerCase())));
          $('#colorChips').innerHTML = colors.length ? colors.map((c, i) => `<span class="chip-x"><span class="dot sm" style="--c:${esc(c.hex)}"></span>${esc(c.name)}<button type="button" data-cx="${i}" aria-label="Remove colour ${esc(c.name)}">✕</button></span>`).join('') : '<span class="hint">No colours added. Customers will not choose a colour.</span>';
          $$('.color-preset').forEach((b) => b.classList.toggle('on', colors.some((c) => c.name.toLowerCase() === b.dataset.n.toLowerCase())));
          const on = hasOptions();
          $('#pSizes').hidden = !usesSizes(); $('#pStockGrid').hidden = !on; $('#pStockWrap').hidden = on;
          $('#optRows').innerHTML = on ? rows().map((c, ci) => `<div class="opt-group">
            ${c.name ? `<div class="opt-head"><span class="dot sm" style="--c:${esc(c.hex || '#cccccc')}"></span><b>${esc(c.name)}</b></div>` : ''}
            <div class="opt-cells">${cols().length ? cols().map((z, si) => `<label class="opt-cell"><span>${esc(z) || 'Stock'}</span><input type="number" min="0" step="1" data-c="${ci}" data-s="${si}" value="${stockMap[key(c.name, z)] ?? 0}"></label>`).join('') : '<span class="hint">Add at least one size above.</span>'}</div></div>`).join('') : '';
          total();
        };
        const addSize = (v) => {
          v = String(v).trim().replace(/\s+/g, ' '); if (!v) return;
          if (sizes.some((z) => z.toLowerCase() === v.toLowerCase())) { toast(`Size ${v} is already added`, 'err'); return; }
          sizes.push(v); renderOpts();
        };
        const addColor = (n, h) => {
          n = String(n).trim().replace(/\s+/g, ' '); if (!n) return;
          if (colors.some((c) => c.name.toLowerCase() === n.toLowerCase())) { toast(`Colour ${n} is already added`, 'err'); return; }
          colors.push({ name: n, hex: h }); renderOpts();
        };
        $$('.size-preset').forEach((b) => b.addEventListener('click', () => {
          const i = sizes.findIndex((z) => z.toLowerCase() === b.dataset.v.toLowerCase());
          if (i >= 0) { sizes.splice(i, 1); renderOpts(); } else addSize(b.dataset.v);
        }));
        $$('.color-preset').forEach((b) => b.addEventListener('click', () => {
          const i = colors.findIndex((c) => c.name.toLowerCase() === b.dataset.n.toLowerCase());
          if (i >= 0) { colors.splice(i, 1); renderOpts(); } else addColor(b.dataset.n, b.dataset.h);
        }));
        $('#sizeAdd').addEventListener('click', () => { addSize($('#sizeCustom').value); $('#sizeCustom').value = ''; });
        $('#sizeCustom').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addSize($('#sizeCustom').value); $('#sizeCustom').value = ''; } });
        $('#colorAdd').addEventListener('click', () => { addColor($('#colorName').value, $('#colorHex').value); $('#colorName').value = ''; });
        $('#colorName').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addColor($('#colorName').value, $('#colorHex').value); $('#colorName').value = ''; } });
        $('#sizeChips').addEventListener('click', (e) => { const x = e.target.closest('[data-sx]'); if (x) { sizes.splice(+x.dataset.sx, 1); renderOpts(); } });
        $('#colorChips').addEventListener('click', (e) => { const x = e.target.closest('[data-cx]'); if (x) { colors.splice(+x.dataset.cx, 1); renderOpts(); } });
        $('#optRows').addEventListener('input', (e) => {
          if (e.target.dataset.c === undefined) return;
          stockMap[key(rows()[+e.target.dataset.c].name, cols()[+e.target.dataset.s])] = e.target.value; total();
        });
        $('#pCat').addEventListener('change', renderOpts);
        renderOpts();

        // ---- photos (many) ----
        let images = (p.images || (p.image_url ? [p.image_url] : [])).slice();
        const status = $('#imgStatus');
        const renderImgs = () => {
          $('#imgGrid').innerHTML = images.length ? images.map((u, i) => `<div class="img-tile${i === 0 ? ' main' : ''}">
            ${img({ id: p.id || 0, title: 'Photo ' + (i + 1), image_url: u, icon: '📷' }, 300)}
            ${i === 0 ? '<span class="main-tag">Main</span>' : ''}
            <div class="img-actions">
              <button type="button" data-l="${i}" aria-label="Move earlier" ${i === 0 ? 'disabled' : ''}>◀</button>
              <button type="button" data-r="${i}" aria-label="Move later" ${i === images.length - 1 ? 'disabled' : ''}>▶</button>
              <button type="button" data-x="${i}" aria-label="Remove photo">✕</button></div></div>`).join('') : '<p class="hint" style="margin:0">No photos yet.</p>';
        };
        $('#imgGrid').addEventListener('click', (e) => {
          const l = e.target.closest('[data-l]'), r = e.target.closest('[data-r]'), x = e.target.closest('[data-x]');
          if (l) { const i = +l.dataset.l; [images[i - 1], images[i]] = [images[i], images[i - 1]]; }
          else if (r) { const i = +r.dataset.r; [images[i + 1], images[i]] = [images[i], images[i + 1]]; }
          else if (x) images.splice(+x.dataset.x, 1);
          else return;
          renderImgs();
        });
        const addLink = () => {
          const u = $('#imgLink').value.trim(); if (!u) return;
          if (!/^https?:\/\//i.test(u)) { status.textContent = 'The link must start with https://'; return; }
          if (images.length >= 10) { status.textContent = 'You can add up to 10 photos.'; return; }
          if (!images.includes(u)) images.push(u);
          $('#imgLink').value = ''; renderImgs(); status.textContent = 'Photo added ✓';
        };
        $('#imgLinkAdd').addEventListener('click', addLink);
        $('#imgLink').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addLink(); } });
        $('#imgAdd').addEventListener('click', () => $('#imgFile').click());
        $('#imgFile').addEventListener('change', async () => {
          const files = [...$('#imgFile').files]; $('#imgFile').value = '';
          if (!files.length) return;
          const room = 10 - images.length;
          if (room <= 0) { status.textContent = 'You can add up to 10 photos.'; return; }
          const use = files.slice(0, room);
          $('#imgAdd').disabled = true; $('#pSave').disabled = true;
          let done = 0;
          for (let i = 0; i < use.length; i++) {
            const f = use[i];
            if (!f.type.startsWith('image/')) { status.textContent = `"${f.name}" is not an image.`; continue; }
            if (f.size > 15 * 1024 * 1024) { status.textContent = `"${f.name}" is too large (max 15 MB).`; continue; }
            try {
              status.textContent = `Uploading photo ${i + 1} of ${use.length}...`;
              const url = await uploadImage(await shrink(f, 1600), (n) => { status.textContent = `Uploading photo ${i + 1} of ${use.length}... ${n}%`; });
              images.push(url); done++; renderImgs();
            } catch (ex) { status.textContent = ex.message; toast(ex.message, 'err'); }
          }
          if (done) status.textContent = `${done} photo${done > 1 ? 's' : ''} uploaded ✓ Now press Save product.` + (files.length > use.length ? ' (Only 10 photos are allowed, the rest were skipped.)' : '');
          $('#imgAdd').disabled = false; $('#pSave').disabled = false;
        });
        renderImgs();

        $('#pf').addEventListener('submit', async (e) => {
          e.preventDefault();
          const b = { title: $('#pTitle').value, category_id: $('#pCat').value, price: $('#pPrice').value, old_price: $('#pOld').value,
            description: $('#pDesc').value, is_featured: $('#pFeat').checked, images, rating: $('#pRating').value, sold: $('#pSold').value,
            is_out_of_stock: $('#pOut').checked, hide_stock: $('#pHide').checked };
          if (hasOptions()) {
            b.stock = 0;
            b.variants = rows().flatMap((c) => cols().map((z) => ({ color: c.name, color_hex: c.name ? c.hex : null, size: z, stock: stockMap[key(c.name, z)] ?? 0 })));
          } else b.stock = $('#pStock').value;
          try {
            await api(p.id ? '/admin/products/' + p.id : '/admin/products', { method: p.id ? 'PUT' : 'POST', body: b });
            toast('Product saved'); adminProducts();
          } catch (ex) { $('#pErr').textContent = ex.message; $('#pErr').hidden = false; }
        });
        $('#pf').scrollIntoView({ behavior: 'smooth', block: 'start' });
      };
      $('#newP').addEventListener('click', () => form());
      $$('[data-edit]', body).forEach((b) => b.addEventListener('click', async () => {
        const base = products.find((x) => x.id === +b.dataset.edit);
        try { const d = await api('/products/' + base.id + '?_=' + Date.now()); form({ ...base, ...d.product }); }
        catch (ex) { toast(ex.message, 'err'); }
      }));
      $$('[data-del]', body).forEach((b) => b.addEventListener('click', async () => {
        if (!confirm('Delete this product?')) return;
        try { await api('/admin/products/' + b.dataset.del, { method: 'DELETE' }); toast('Product deleted'); adminProducts(); }
        catch (e) { toast('Could not delete. It may be part of an order.', 'err'); }
      }));
    } catch (e) { body.innerHTML = `<div class="form-error">${esc(e.message)}</div>`; }
  }

  /* ---------- help & support ---------- */
  function pageHelp() {
    const mail = state.cfg.supportEmail, enc = encodeURIComponent;
    const faqs = [
      ['How do I place an order?', 'Add products to your cart, press Proceed to checkout, log in, fill in your delivery details and place the order. You pay in cash when it arrives.'],
      ['What are the delivery charges?', deliveryHint() + ' Sometimes we make delivery free for special orders. If that happens, your order page will show it.'],
      ['How do I choose a colour?', 'If a product comes in more than one colour, tap the colour you want on the product page. A crossed-out colour is sold out in the size you picked.'],
      ['How do I choose my size?', 'For clothes and shoes, tap the size you want on the product page before adding to cart. A crossed-out size is sold out. If you are unsure about a size, email us before ordering.'],
      ['How do I use a voucher?', 'On the checkout page, type your voucher code in the Voucher box and press Apply. Some vouchers need a minimum order, and each customer can use a code once.'],
      ['How do I pay?', 'Cash on delivery. Pay the delivery person when your order arrives.'],
      ['Where can I see my order?', 'Open My orders after logging in. Every order shows its status: pending, confirmed, shipped or delivered.'],
      ['I need to change or cancel an order', 'Email us as soon as possible with your order number and we will see what we can do.']
    ];
    setView(`<div class="wrap section" style="max-width:56rem">
      <div class="crumbs"><a href="#/">Home</a> / Help &amp; Support</div>
      <h1 style="font-size:var(--fs-600);margin-bottom:.3rem">Help &amp; Support</h1>
      <p class="muted" style="margin:0 0 1rem">Questions about an order, delivery or a voucher? Write to us and we will reply by email.</p>

      <div class="panel panel-pad support-card">
        <div><h2 style="font-size:var(--fs-400)">Email us</h2>
          <a class="mail-big" href="mailto:${esc(mail)}">${esc(mail)}</a>
          <p class="hint" style="margin:.3rem 0 0">Please include your order number so we can help faster.</p>
          ${state.cfg.supportPhone ? `<p style="margin:.6rem 0 0">Call us: <a class="link" href="tel:${esc(state.cfg.supportPhone.replace(/[^\d+]/g, ''))}">${esc(state.cfg.supportPhone)}</a></p>` : ''}</div>
        <div class="t-actions"><a class="btn" id="mailBtn" href="mailto:${esc(mail)}">Open email app</a>
          <a class="btn btn-ghost" id="gmailBtn" target="_blank" rel="noopener" href="https://mail.google.com/mail/?view=cm&fs=1&to=${enc(mail)}">Open in Gmail</a>
          <button class="btn btn-ghost" type="button" id="copyMail">Copy address</button></div>
      </div>

      <form class="panel panel-pad form" id="helpForm" style="margin-top:var(--gap)" novalidate>
        <h2 style="font-size:var(--fs-400)">Write your message</h2>
        <div class="field-row">
          <div class="field"><label for="hName">Your name</label><input id="hName" value="${esc(state.user ? state.user.name : '')}" autocomplete="name"></div>
          <div class="field"><label for="hOrder">Order number (optional)</label><input id="hOrder" inputmode="numeric" placeholder="e.g. 1024"></div>
        </div>
        <div class="field"><label for="hMsg">How can we help?</label><textarea id="hMsg" placeholder="Tell us what happened"></textarea></div>
        <p class="hint">This opens your email app (or Gmail) with the message ready to send. We do not receive it until you press Send there.</p>
        <div class="t-actions"><button class="btn" id="hSend">Send with email app</button><button class="btn btn-ghost" type="button" id="hGmail">Send with Gmail</button></div>
      </form>

      <section style="margin-top:calc(var(--gap) * 1.6)">
        <h2 style="font-size:var(--fs-500);margin-bottom:.8rem">Common questions</h2>
        <div class="panel faq">${faqs.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}</div>
      </section></div>`);

    const compose = () => {
      const name = $('#hName').value.trim(), order = $('#hOrder').value.trim().replace(/^#/, ''), msg = $('#hMsg').value.trim();
      const subject = order ? `Support request - Order #${order}` : 'Support request';
      const bodyTxt = `${msg}\n\n---\nName: ${name || '-'}\nOrder: ${order || '-'}\nAccount: ${state.user ? state.user.email : 'not logged in'}`;
      return {
        mailto: `mailto:${mail}?subject=${enc(subject)}&body=${enc(bodyTxt)}`,
        gmail: `https://mail.google.com/mail/?view=cm&fs=1&to=${enc(mail)}&su=${enc(subject)}&body=${enc(bodyTxt)}`
      };
    };
    const refresh = () => { const c = compose(); $('#mailBtn').href = c.mailto; $('#gmailBtn').href = c.gmail; };
    ['#hName', '#hOrder', '#hMsg'].forEach((id) => $(id).addEventListener('input', refresh));
    refresh();
    $('#helpForm').addEventListener('submit', (e) => {
      e.preventDefault();
      if (!$('#hMsg').value.trim()) { toast('Please write your message first', 'err'); return; }
      location.href = compose().mailto;
    });
    $('#hGmail').addEventListener('click', () => {
      if (!$('#hMsg').value.trim()) { toast('Please write your message first', 'err'); return; }
      window.open(compose().gmail, '_blank', 'noopener');
    });
    $('#copyMail').addEventListener('click', () => {
      (navigator.clipboard ? navigator.clipboard.writeText(mail) : Promise.reject()).then(() => toast('Email address copied'), () => toast(mail));
    });
  }

  /* ---------- router ---------- */
  async function route() {
    renderId++;
    timers.forEach(clearInterval); timers = [];
    const raw = location.hash.replace(/^#/, '') || '/';
    const [path, qs] = raw.split('?');
    const params = new URLSearchParams(qs || '');
    let m;
    try {
      if (path === '/') await pageHome();
      else if (path === '/shop') await pageList('all', null, params);
      else if (path === '/sale') await pageList('sale', null, params);
      else if (path === '/search') await pageList('search', null, params);
      else if ((m = path.match(/^\/category\/([\w-]+)$/))) await pageList('category', m[1], params);
      else if ((m = path.match(/^\/product\/(\d+)$/))) await pageProduct(m[1]);
      else if (path === '/cart') pageCart();
      else if (path === '/checkout') pageCheckout();
      else if ((m = path.match(/^\/success\/(\d+)$/))) pageSuccess(m[1]);
      else if (path === '/login') authPage('login');
      else if (path === '/register') authPage('register');
      else if (path === '/orders') await pageOrders();
      else if (path === '/admin') await pageAdmin();
      else if (path === '/help') pageHelp();
      else setView('<div class="wrap section"><div class="panel empty"><div class="em">🧭</div><h2>Page not found</h2><p>The page you are looking for does not exist.</p><a class="btn" href="#/">Go home</a></div></div>');
    } catch (e) {
      if (e.status === 404 && /product/i.test(e.message)) {
        setView('<div class="wrap section"><div class="panel empty"><div class="em">🔍</div><h2>Product not found</h2><p>It may have been removed.</p><a class="btn" href="#/shop">Browse products</a></div></div>');
      } else setView(errorBox(e));
    }
    view.focus({ preventScroll: true });
  }

  document.addEventListener('click', (e) => { if (e.target.closest('[data-act="retry"]')) route(); });
  $('#searchForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = $('#searchInput').value.trim();
    if (q) location.hash = '#/search?q=' + encodeURIComponent(q);
  });
  window.addEventListener('hashchange', route);
  $('#year').textContent = new Date().getFullYear();
  updateHeader();
  loadConfig().then(route);
})();
