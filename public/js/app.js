/* BazarGhor frontend - vanilla JS single page app (hash routing). */
(() => {
  'use strict';

  /* ---------- helpers ---------- */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => '৳' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 });
  const FREE_SHIP = 1500, SHIP_FEE = 60;
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
    try {
      res = await fetch('/api' + path, { ...opts, headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
    } catch {
      throw Object.assign(new Error('No internet connection. Please check and retry.'), { status: 0 });
    }
    let data = null;
    try { data = await res.json(); } catch { /* not json */ }
    if (!res.ok) {
      if (res.status === 401 && state.token && !path.startsWith('/auth/login')) logout(true);
      throw Object.assign(new Error((data && data.error) || 'Something went wrong. Please try again.'), { status: res.status });
    }
    return data;
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

  function addToCart(p, qty = 1) {
    const found = state.cart.find((i) => i.id === p.id);
    const max = Math.max(1, p.stock);
    if (found) found.qty = Math.min(max, found.qty + qty);
    else state.cart.push({ id: p.id, title: p.title, price: p.price, old_price: p.old_price, image_url: p.image_url, icon: p.icon, stock: p.stock, qty: Math.min(max, qty) });
    saveCart();
  }

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
  const img = (p) => p.image_url
    ? `<img src="${esc(p.image_url)}" alt="${esc(p.title)}" loading="lazy" data-id="${p.id || 0}" data-icon="${esc(p.icon || '🛍️')}">`
    : tile(p);
  const stars = (r) => `<span class="star" aria-hidden="true">★</span><span>${Number(r).toFixed(1)}</span>`;
  const discount = (p) => (p.old_price && p.old_price > p.price ? Math.round((1 - p.price / p.old_price) * 100) : 0);

  function card(p) {
    const d = discount(p);
    return `<a class="card" href="#/product/${p.id}">
      <div class="card-img">${img(p)}${d ? `<span class="badge">-${d}%</span>` : ''}</div>
      <div class="card-body">
        <h3 class="card-title">${esc(p.title)}</h3>
        <div class="price">${money(p.price)}</div>
        ${d ? `<div class="old">${money(p.old_price)}</div>` : ''}
        <div class="meta">${stars(p.rating)}<span>${p.sold} sold</span></div>
      </div></a>`;
  }
  const skeletonGrid = (n = 10) => `<div class="grid">${'<div class="sk sk-card"></div>'.repeat(n)}</div>`;
  const stockPill = (s) => s <= 0 ? '<span class="pill pill-out">Out of stock</span>'
    : s <= 5 ? `<span class="pill pill-low">Only ${s} left</span>` : '<span class="pill pill-ok">In stock</span>';

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
  async function loadCats() {
    if (state.cats.length) return state.cats;
    const d = await api('/categories');
    state.cats = d.categories;
    return state.cats;
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
    const [cats, sale] = await Promise.all([loadCats(), api('/products?sale=1&limit=10&sort=popular')]);
    if (my !== renderId) return;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const slides = [
      { c: 's1', h: 'Everything you need, one place', p: 'সারা দেশে ক্যাশ অন ডেলিভারি', a: '📱 🎧 👟', l: '#/shop', t: 'Start shopping', b: 'btn-accent' },
      { c: 's2', h: 'Flash sale, up to 40% off', p: 'Fresh deals refresh every day.', a: '⚡ 🏷️', l: '#/sale', t: 'See the deals', b: '' },
      { c: 's3', h: 'Free delivery over ৳1,500', p: 'Add a little more, pay nothing to ship.', a: '📦 🚚', l: '#/shop', t: 'Browse products', b: 'btn-accent' }
    ];
    setView(`
      <div class="wrap home-top">
        <nav class="panel side-cats" aria-label="Categories">
          ${cats.map((c) => `<a href="#/category/${esc(c.slug)}"><span class="em">${esc(c.icon)}</span>${esc(c.name)}</a>`).join('')}
        </nav>
        <div>
          <div class="chips">${cats.map((c) => `<a class="chip" href="#/category/${esc(c.slug)}"><span>${esc(c.icon)}</span>${esc(c.name)}</a>`).join('')}</div>
          <section class="hero" aria-roledescription="carousel" aria-label="Offers" style="margin-top:.6rem">
            ${slides.map((s, i) => `<div class="slide ${s.c} ${i === 0 ? 'on' : ''}">
              <div><h1>${esc(s.h)}</h1><p>${esc(s.p)}</p><a class="btn ${s.b}" href="${s.l}">${esc(s.t)}</a></div>
              <div class="art" aria-hidden="true">${s.a}</div></div>`).join('')}
            <div class="dots">${slides.map((_, i) => `<button aria-label="Slide ${i + 1}" aria-current="${i === 0}"></button>`).join('')}</div>
          </section>
        </div>
      </div>

      ${sale.products.length ? `<section class="wrap section">
        <div class="flash">
          <div class="flash-head">
            <h2>Flash sale</h2>
            <div class="countdown" aria-label="Time left today">Ends in <b id="cdH">00</b><b id="cdM">00</b><b id="cdS">00</b></div>
            <a class="link" href="#/sale">See all</a>
          </div>
          <div class="rail">${sale.products.map(card).join('')}</div>
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
    const sl = $$('.slide'), dots = $$('.dots button');
    let cur = 0;
    const show = (i) => {
      cur = (i + sl.length) % sl.length;
      sl.forEach((s, k) => s.classList.toggle('on', k === cur));
      dots.forEach((d, k) => d.setAttribute('aria-current', String(k === cur)));
    };
    dots.forEach((d, i) => d.addEventListener('click', () => show(i)));
    if (!reduce) timers.push(setInterval(() => show(cur + 1), 5500));

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
    const d = discount(p);
    setView(`<div class="wrap section">
      <div class="crumbs"><a href="#/">Home</a> / <a href="#/category/${esc(p.category_slug)}">${esc(p.category_name)}</a> / ${esc(p.title)}</div>
      <div class="pdp">
        <div class="pdp-img">${img(p)}</div>
        <div>
          <h1>${esc(p.title)}</h1>
          <div class="meta" style="padding:0">${stars(p.rating)}<span>${p.sold} sold</span>${stockPill(p.stock)}</div>
          <div class="price-row"><span class="price-big">${money(p.price)}</span>
            ${d ? `<span class="old">${money(p.old_price)}</span><span class="pill pill-out">Save ${d}%</span>` : ''}</div>
          ${p.stock > 0 ? `
          <div class="qty" role="group" aria-label="Quantity">
            <button type="button" data-q="-1" aria-label="Decrease">−</button>
            <input id="qty" type="number" value="1" min="1" max="${Math.min(20, p.stock)}" aria-label="Quantity">
            <button type="button" data-q="1" aria-label="Increase">+</button></div>
          <div class="buy-row">
            <button class="btn btn-accent" id="buyNow">Buy now</button>
            <button class="btn btn-ghost" id="addCart">Add to cart</button></div>` : '<p class="muted">This item is currently unavailable.</p>'}
          <div class="perks"><span>🚚 Free delivery over ${money(FREE_SHIP)}</span><span>💵 Cash on delivery</span></div>
          <div class="desc"><h3>Product details</h3><p>${esc(p.description || 'No description available.')}</p></div>
        </div>
      </div>
      ${related.length ? `<section class="section" style="padding-bottom:0"><div class="sec-head"><h2>You may also like</h2></div>
        <div class="grid">${related.map(card).join('')}</div></section>` : ''}</div>`);
    if (p.stock > 0) {
      const qty = $('#qty'), max = Math.min(20, p.stock);
      const clamp = () => { qty.value = Math.max(1, Math.min(max, parseInt(qty.value) || 1)); return +qty.value; };
      $$('[data-q]').forEach((b) => b.addEventListener('click', () => { qty.value = clamp() + +b.dataset.q; clamp(); }));
      qty.addEventListener('change', clamp);
      $('#addCart').addEventListener('click', () => { addToCart(p, clamp()); toast('Added to cart'); });
      $('#buyNow').addEventListener('click', () => { addToCart(p, clamp()); location.hash = '#/checkout'; });
    }
  }

  function pageCart() {
    if (!state.cart.length) {
      return setView(`<div class="wrap section"><div class="panel empty"><div class="em">🛒</div><h2>Your cart is empty</h2>
        <p>Add something you like and it will show up here.</p><a class="btn" href="#/shop">Start shopping</a></div></div>`);
    }
    const sub = subtotal(), ship = sub >= FREE_SHIP ? 0 : SHIP_FEE;
    setView(`<div class="wrap section"><h1 style="font-size:var(--fs-600);margin-bottom:1rem">Shopping cart</h1>
      <div class="two-col">
        <div class="panel panel-pad">${state.cart.map((i) => `
          <div class="line" data-id="${i.id}">
            <a class="thumb" href="#/product/${i.id}">${img(i)}</a>
            <div><h3>${esc(i.title)}</h3><div class="price" style="margin:.1rem 0">${money(i.price)}</div>
              <div class="row">
                <div class="qty"><button data-a="dec" aria-label="Decrease">−</button><input value="${i.qty}" readonly aria-label="Quantity"><button data-a="inc" aria-label="Increase">+</button></div>
                <button class="linkbtn" data-a="rm">Remove</button></div></div></div>`).join('')}</div>
        <aside class="panel panel-pad">
          <h2 style="font-size:var(--fs-400);margin-bottom:.6rem">Order summary</h2>
          <div class="sum-row"><span>Subtotal (${cartCount()} items)</span><span>${money(sub)}</span></div>
          <div class="sum-row"><span>Delivery</span><span>${ship ? money(ship) : 'Free'}</span></div>
          ${ship ? `<p class="hint">Add ${money(FREE_SHIP - sub)} more for free delivery.</p>` : ''}
          <div class="sum-row sum-total"><span>Total</span><span>${money(sub + ship)}</span></div>
          <a class="btn btn-accent btn-block" href="#/checkout" style="margin-top:1rem">Proceed to checkout</a>
        </aside></div></div>`);
    $$('.line').forEach((row) => row.addEventListener('click', (e) => {
      const a = e.target.closest('[data-a]'); if (!a) return;
      const it = state.cart.find((x) => x.id === +row.dataset.id);
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
    const sub = subtotal(), ship = sub >= FREE_SHIP ? 0 : SHIP_FEE;
    setView(`<div class="wrap section"><h1 style="font-size:var(--fs-600);margin-bottom:1rem">Checkout</h1>
      <div class="two-col">
        <form class="panel panel-pad form" id="coForm" novalidate>
          <h2 style="font-size:var(--fs-400)">Delivery address</h2>
          <div class="field-row">
            <div class="field"><label for="coName">Receiver name</label><input id="coName" value="${esc(state.user.name)}" autocomplete="name" required></div>
            <div class="field"><label for="coPhone">Mobile number</label><input id="coPhone" value="${esc(state.user.phone || '')}" inputmode="tel" placeholder="017XXXXXXXX" autocomplete="tel" required></div>
          </div>
          <div class="field"><label for="coAddr">Full address</label><textarea id="coAddr" placeholder="House, road, area" autocomplete="street-address" required></textarea></div>
          <div class="field"><label for="coCity">City / District</label><input id="coCity" placeholder="e.g. Dhaka" autocomplete="address-level2" required></div>
          <h2 style="font-size:var(--fs-400)">Payment</h2>
          <div class="pay"><span aria-hidden="true">💵</span><div><b>Cash on delivery</b><div class="hint">Pay when your order arrives.</div></div></div>
          <div class="form-error" id="coErr" hidden></div>
          <button class="btn btn-accent btn-block" id="coBtn">Place order · ${money(sub + ship)}</button>
        </form>
        <aside class="panel panel-pad">
          <h2 style="font-size:var(--fs-400);margin-bottom:.6rem">Your items</h2>
          ${state.cart.map((i) => `<div class="sum-row"><span>${esc(i.title)} × ${i.qty}</span><span>${money(i.price * i.qty)}</span></div>`).join('')}
          <div class="sum-row"><span>Delivery</span><span>${ship ? money(ship) : 'Free'}</span></div>
          <div class="sum-row sum-total"><span>Total</span><span>${money(sub + ship)}</span></div>
        </aside></div></div>`);
    $('#coForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = $('#coBtn'), err = $('#coErr'); err.hidden = true; btn.disabled = true;
      try {
        const r = await api('/orders', { method: 'POST', body: {
          items: state.cart.map((i) => ({ id: i.id, qty: i.qty })),
          name: $('#coName').value, phone: $('#coPhone').value, address: $('#coAddr').value,
          city: $('#coCity').value, payment_method: 'cod' } });
        state.cart = []; saveCart();
        location.hash = '#/success/' + r.id;
      } catch (ex) { err.textContent = ex.message; err.hidden = false; btn.disabled = false; }
    });
  }

  function pageSuccess(id) {
    setView(`<div class="wrap section"><div class="panel empty"><div class="em">🎉</div><h2>Order placed</h2>
      <p>Your order <b>#${esc(id)}</b> is confirmed. We will call you before delivery.</p>
      <a class="btn" href="#/orders">View my orders</a> <a class="btn btn-ghost" href="#/">Continue shopping</a></div></div>`);
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

  async function pageOrders() {
    if (requireLogin('#/orders')) return;
    const my = renderId;
    setView('<div class="wrap section"><div class="sk" style="height:12rem"></div></div>');
    const { orders } = await api('/orders/mine');
    if (my !== renderId) return;
    setView(`<div class="wrap section" style="max-width:52rem">
      <div class="list-head"><h1>My orders</h1><button class="btn btn-ghost btn-sm" id="logout">Log out</button></div>
      ${orders.length ? orders.map((o) => `<article class="panel order">
        <div class="order-top"><b>Order #${o.id}</b>${statusPill(o.status)}<span class="muted">${dateFmt(o.created_at)}</span><b>${money(o.total)}</b></div>
        <div class="order-items">${o.items.map((i) => `<span>${esc(i.title)} × ${i.qty}</span>`).join('')}</div>
        <div class="hint" style="margin-top:.5rem">Deliver to ${esc(o.name)}, ${esc(o.address)}, ${esc(o.city)}</div></article>`).join('')
      : '<div class="panel empty"><div class="em">📦</div><h2>No orders yet</h2><p>When you place an order it will show up here.</p><a class="btn" href="#/shop">Start shopping</a></div>'}
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
        <button class="tab" role="tab" data-t="orders" aria-selected="false">Orders</button></div>
      <div id="adminBody"></div></div>`);
    $('#logout').addEventListener('click', () => { logout(); location.hash = '#/'; });
    const go = (t) => {
      $$('.tab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.t === t)));
      ({ dash: adminDash, products: adminProducts, orders: adminOrders })[t]();
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
      body.innerHTML = orders.length ? orders.map((o) => `<article class="panel order">
        <div class="order-top"><b>Order #${o.id}</b><span>${dateFmt(o.created_at)}</span><b>${money(o.total)}</b>
          <select class="select" data-oid="${o.id}" aria-label="Order status">${opts.map((s) => `<option value="${s}" ${s === o.status ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
        <div class="order-items">${o.items.map((i) => `<span>${esc(i.title)} × ${i.qty}</span>`).join('')}</div>
        <div class="hint" style="margin-top:.5rem">${esc(o.name)} · ${esc(o.phone)} · ${esc(o.address)}, ${esc(o.city)}</div></article>`).join('')
        : '<div class="panel empty"><h2>No orders yet</h2></div>';
      $$('[data-oid]', body).forEach((sel) => sel.addEventListener('change', async () => {
        try { await api('/admin/orders/' + sel.dataset.oid, { method: 'PATCH', body: { status: sel.value } }); toast('Order updated'); }
        catch (e) { toast(e.message, 'err'); }
      }));
    } catch (e) { body.innerHTML = `<div class="form-error">${esc(e.message)}</div>`; }
  }

  async function adminProducts() {
    const body = $('#adminBody'); body.innerHTML = '<div class="sk" style="height:10rem"></div>';
    try {
      const cats = await loadCats();
      const { products, total } = await api('/products?limit=48&sort=new');
      body.innerHTML = `
        <div class="sec-head"><h2 style="font-size:var(--fs-400)">${total} products</h2><button class="btn btn-sm" id="newP">Add product</button></div>
        <div id="pForm"></div>
        <div class="panel table-wrap"><table><thead><tr><th></th><th>Title</th><th>Price</th><th>Stock</th><th></th></tr></thead><tbody>
        ${products.map((p) => `<tr><td><div class="thumb-sm">${img(p)}</div></td><td>${esc(p.title)}<div class="hint">${esc(p.category_name)}</div></td>
          <td>${money(p.price)}</td><td>${p.stock}</td>
          <td><div class="t-actions"><button class="btn btn-ghost btn-sm" data-edit="${p.id}">Edit</button><button class="btn btn-danger btn-sm" data-del="${p.id}">Delete</button></div></td></tr>`).join('')}
        </tbody></table></div>`;
      const form = (p = {}) => {
        $('#pForm').innerHTML = `<form class="panel panel-pad form" id="pf" style="margin-bottom:1rem" novalidate>
          <h3>${p.id ? 'Edit product' : 'New product'}</h3>
          <div class="field"><label for="pTitle">Title</label><input id="pTitle" value="${esc(p.title || '')}" required></div>
          <div class="field-row">
            <div class="field"><label for="pCat">Category</label><select id="pCat">${cats.map((c) => `<option value="${c.id}" ${c.id === p.category_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
            <div class="field"><label for="pStock">Stock</label><input id="pStock" type="number" min="0" value="${p.stock ?? 10}"></div></div>
          <div class="field-row">
            <div class="field"><label for="pPrice">Price (৳)</label><input id="pPrice" type="number" min="1" step="1" value="${p.price || ''}"></div>
            <div class="field"><label for="pOld">Old price (৳, optional)</label><input id="pOld" type="number" min="0" step="1" value="${p.old_price || ''}"></div></div>
          <div class="field"><label for="pImg">Image link (optional)</label><input id="pImg" placeholder="https://..." value="${esc(p.image_url || '')}"></div>
          <div class="field"><label for="pDesc">Description</label><textarea id="pDesc">${esc(p.description || '')}</textarea></div>
          <label class="check"><input type="checkbox" id="pFeat" ${p.is_featured ? 'checked' : ''}> Featured product</label>
          <div class="form-error" id="pErr" hidden></div>
          <div class="t-actions"><button class="btn">Save product</button><button type="button" class="btn btn-ghost" id="pCancel">Cancel</button></div></form>`;
        $('#pCancel').addEventListener('click', () => { $('#pForm').innerHTML = ''; });
        $('#pf').addEventListener('submit', async (e) => {
          e.preventDefault();
          const b = { title: $('#pTitle').value, category_id: $('#pCat').value, stock: $('#pStock').value, price: $('#pPrice').value,
            old_price: $('#pOld').value, image_url: $('#pImg').value, description: $('#pDesc').value, is_featured: $('#pFeat').checked };
          try {
            await api(p.id ? '/admin/products/' + p.id : '/admin/products', { method: p.id ? 'PUT' : 'POST', body: b });
            toast('Product saved'); adminProducts();
          } catch (ex) { $('#pErr').textContent = ex.message; $('#pErr').hidden = false; }
        });
        $('#pf').scrollIntoView({ behavior: 'smooth', block: 'center' });
      };
      $('#newP').addEventListener('click', () => form());
      $$('[data-edit]', body).forEach((b) => b.addEventListener('click', () => form(products.find((x) => x.id === +b.dataset.edit))));
      $$('[data-del]', body).forEach((b) => b.addEventListener('click', async () => {
        if (!confirm('Delete this product?')) return;
        try { await api('/admin/products/' + b.dataset.del, { method: 'DELETE' }); toast('Product deleted'); adminProducts(); }
        catch (e) { toast('Could not delete. It may be part of an order.', 'err'); }
      }));
    } catch (e) { body.innerHTML = `<div class="form-error">${esc(e.message)}</div>`; }
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
  route();
})();
