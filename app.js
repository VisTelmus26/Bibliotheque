/* Bibliotheque — the 3D inspiration space.
   A light 2.5D engine: every piece has a world position (x, y, z); the camera moves in x/y (drag)
   and z (zoom). Thumbs are perspective-projected; titles, captions and link labels stay a constant size. */
(() => {
  'use strict';

  const F = 900;                       // focal length
  const LC = { artist: '#ff8fb1', tool: '#3dd9c5', style: '#e5484d' };
  const REDUCE = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const $ = (s) => document.querySelector(s);
  const stage = $('#stage'), world = $('#world'), labels = $('#labels'), svg = $('#links');

  const S = {
    index: null, weekIdx: 0, week: null, cache: new Map(),
    items: [], clusters: [], links: [], filter: 'all',
    cam: { x: 0, y: 0, z: 3000 }, fitZ: 3000, tween: null,
    w: 0, h: 0, top: 50, bottom: 84,
    ptr: { x: 0, y: 0 }, par: { x: 0, y: 0 },
    pointers: new Map(), dragging: false, moved: false, last: null, vel: { x: 0, y: 0 }, pinch: null,
    dirty: true
  };

  const NS = 'http://www.w3.org/2000/svg';
  const hash = (str) => { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  async function getJSON(u) {
    const r = await fetch(u, { cache: 'no-cache' });
    if (!r.ok) throw new Error(u + ' ' + r.status);
    return r.json();
  }

  /* ---------- dates ---------- */
  const parseDay = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
  const wkLabel = (w) => 'W' + w.id.split('-W')[1];
  function rangeLabel(w) {
    const a = parseDay(w.start), b = parseDay(w.end);
    return a.getUTCMonth() === b.getUTCMonth()
      ? a.getUTCDate() + '–' + b.getUTCDate() + ' ' + MONTHS[b.getUTCMonth()]
      : a.getUTCDate() + ' ' + MONTHS[a.getUTCMonth()] + '–' + b.getUTCDate() + ' ' + MONTHS[b.getUTCMonth()];
  }
  function startLabel(w) {
    const a = parseDay(w.start);
    const m = MONTHS[a.getUTCMonth()];
    return DAYS[a.getUTCDay()] + ' ' + a.getUTCDate() + ' ' + m[0] + m.slice(1).toLowerCase();
  }

  /* ---------- boot ---------- */
  async function init() {
    measure();
    const loading = el('div', null, 'LOADING THE INDEX…');
    loading.id = 'loading';
    document.body.appendChild(loading);
    try {
      S.index = await getJSON('data/index.json');
    } catch (e) {
      loading.textContent = 'COULD NOT LOAD THE INDEX. RELOAD THE PAGE TO TRY AGAIN.';
      return;
    }
    S.index.weeks.sort((a, b) => (a.id < b.id ? -1 : 1));
    S.weekIdx = S.index.weeks.length - 1;
    bind();
    await loadWeek(S.weekIdx, false);
    loading.remove();
    requestAnimationFrame(frame);
  }

  function measure() {
    S.w = innerWidth; S.h = innerHeight;
    S.top = $('#bar').offsetHeight;
    document.documentElement.style.setProperty('--bar-h', S.top + 'px');
    S.bottom = $('#timeline').offsetHeight;
  }

  /* ---------- weeks ---------- */
  async function loadWeek(i, animate = true) {
    const meta = S.index.weeks[i];
    let wk = S.cache.get(meta.id);
    if (!wk) {
      try { wk = await getJSON('data/weeks/' + meta.id + '.json'); }
      catch (e) { $('#tbCount').textContent = 'Could not load this week'; return; }
      S.cache.set(meta.id, wk);
    }
    if (S.index.weeks[S.weekIdx].id !== meta.id) return; // user moved on meanwhile
    S.week = wk;
    buildTopics();
    layout(wk.pieces);
    buildLinks();
    buildDOM();
    applyFilter();
    $('#tbWeek').textContent = startLabel(meta);
    $('#tbCount').textContent = wk.pieces.length + ' · ' + (wk.sources || 16) + ' sites';
    $('#sampleNote').hidden = !wk.sample;
    renderTimeline();
    fit(S.items.filter((it) => !it.dim), animate);
  }

  function selectWeek(i) {
    i = clamp(i, 0, S.index.weeks.length - 1);
    if (i === S.weekIdx) { renderTimeline(); return; }
    S.weekIdx = i;
    renderTimeline();
    loadWeek(i, true);
  }

  /* ---------- menu ---------- */
  function matches(p, key) {
    if (key === 'all') return true;
    if (key === 'ai') return p.ai === true;
    return p.group === key || (p.tags || []).includes(key);
  }

  function buildTopics() {
    const nav = $('#topics');
    nav.textContent = '';
    const cur = S.index.weeks[S.weekIdx].id;
    const list = [{ key: 'all', label: 'All' }].concat(S.index.tags || []);
    for (const t of list) {
      const b = el('button');
      b.type = 'button';
      b.append(document.createTextNode(t.label));
      if (t.since && t.since === cur) b.append(el('span', 'new', 'NEW'));
      b.setAttribute('aria-pressed', String(S.filter === t.key));
      const n = t.key === 'all' ? 1 : S.week.pieces.filter((p) => matches(p, t.key)).length;
      if (!n) { b.style.opacity = '0.35'; b.title = 'Nothing this week'; }
      b.addEventListener('click', () => setFilter(t.key, t.label));
      nav.append(b);
    }
    requestAnimationFrame(() => { measure(); S.dirty = true; });
  }

  function setFilter(key, label) {
    S.filter = key;
    for (const b of $('#topics').children) b.setAttribute('aria-pressed', String(b.firstChild.textContent === label));
    $('#tbView').textContent = key === 'all' ? 'All topics' : label;
    applyFilter();
    const vis = S.items.filter((it) => !it.dim);
    if (vis.length) fit(vis, true);
  }

  function applyFilter() {
    for (const it of S.items) {
      it.dim = !matches(it.p, S.filter);
      it.node.classList.toggle('dim', it.dim);
    }
    for (const c of S.clusters) c.dim = c.items.every((it) => it.dim);
    S.dirty = true;
  }

  /* ---------- layout ---------- */
  function layout(pieces) {
    const groups = new Map();
    for (const p of pieces) {
      const g = p.ai === true ? 'ai' : p.group;
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(p);
    }
    const label = (k) => (k === 'ai' ? 'AI-generated' : ((S.index.groups || []).find((g) => g.key === k) || { label: k }).label);
    const keys = [...groups.keys()].filter((k) => k !== 'ai').sort((a, b) => groups.get(b).length - groups.get(a).length);
    const clusters = keys.map((k, i) => {
      const n = groups.get(k).length;
      const ang = i * 2.39996, rad = i === 0 ? 0 : 330 * Math.sqrt(i);
      return { key: k, label: label(k), n, R: 105 * Math.sqrt(n) + 80, x: Math.cos(ang) * rad, y: Math.sin(ang) * rad * 0.75, ps: groups.get(k) };
    });
    for (let it = 0; it < 260; it++) {
      for (let a = 0; a < clusters.length; a++) {
        for (let b = a + 1; b < clusters.length; b++) {
          const A = clusters[a], B = clusters[b];
          let dx = B.x - A.x, dy = B.y - A.y;
          let d = Math.hypot(dx, dy) || 1;
          const min = A.R + B.R + 150;
          if (d < min) {
            const push = (min - d) / 2;
            dx /= d; dy /= d;
            A.x -= dx * push; A.y -= dy * push; B.x += dx * push; B.y += dy * push;
          }
        }
      }
      if (it < 180) for (const c of clusters) { c.x *= 0.999; c.y *= 0.998; }
    }
    if (groups.has('ai')) {
      const n = groups.get('ai').length;
      const R = 105 * Math.sqrt(n) + 80;
      const maxX = Math.max(...clusters.map((c) => c.x + c.R), 0);
      const minY = Math.min(...clusters.map((c) => c.y - c.R), 0);
      clusters.push({ key: 'ai', label: 'AI-generated', ai: true, n, R, x: maxX + R + 380, y: minY + R + 40, ps: groups.get('ai') });
    }
    const items = [];
    for (const c of clusters) {
      c.items = [];
      const ps = c.ps.slice().sort((a, b) => (hash(a.id) % 97) - (hash(b.id) % 97));
      ps.forEach((p, i) => {
        const f = Math.sqrt((i + 0.5) / ps.length);
        const a = i * 2.39996 + c.x * 0.01;
        const r = f * (c.R - 60);
        const asp = clamp(p.aspect || 0.8, 0.5, 2);
        const w = 120 * Math.sqrt(asp), h = w / asp;
        const jit = ((hash(p.id) % 61) - 30);
        const it = { p, c, x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r, z: 210 * f * f + jit, w, h };
        c.items.push(it);
        items.push(it);
      });
    }
    S.clusters = clusters;
    S.items = items;
  }

  /* ---------- connections ---------- */
  function buildLinks() {
    const groups = new Map();
    const add = (type, key, label, it) => {
      const k = type + '|' + key.toLowerCase().trim();
      if (!groups.has(k)) groups.set(k, { type, label, members: [] });
      groups.get(k).members.push(it);
    };
    for (const it of S.items) {
      const p = it.p;
      if (p.artist) add('artist', p.artist, 'SAME ARTIST', it);
      for (const t of p.tools || []) add('tool', t, t.toUpperCase(), it);
      for (const s of p.styles || []) add('style', s, s.toUpperCase(), it);
    }
    const links = [];
    for (const g of groups.values()) {
      if (g.members.length < 2) continue;
      const m = g.members.slice().sort((a, b) => (a.c.x - b.c.x) || (a.y - b.y));
      for (let i = 0; i < m.length - 1; i++) links.push({ a: m[i], b: m[i + 1], type: g.type, label: g.label });
    }
    S.links = links;
    for (const it of S.items) it.ring = null;
    for (const l of links) { l.a.ring = l.a.ring || LC[l.type]; l.b.ring = l.b.ring || LC[l.type]; }
  }

  /* ---------- DOM ---------- */
  function placeholder(p) {
    const h = hash(p.id), h1 = h % 360, h2 = (h1 + 140 + (h >> 9) % 80) % 360;
    const ph = el('span', 'ph');
    ph.style.background = 'hsl(' + h1 + ' 28% 20%)';
    const shape = el('span');
    const round = (h >> 4) % 3;
    shape.style.cssText = 'position:absolute;left:' + (15 + (h >> 3) % 30) + '%;top:' + (15 + (h >> 6) % 30) + '%;width:' + (35 + (h >> 2) % 30) + '%;height:' + (35 + (h >> 5) % 30) + '%;background:hsl(' + h2 + ' 62% 58%);border-radius:' + (round === 0 ? '50%' : round === 1 ? '4%' : '50% 50% 0 0');
    ph.append(shape);
    return ph;
  }

  function buildDOM() {
    world.textContent = '';
    labels.textContent = '';
    svg.textContent = '';
    for (const it of S.items) {
      const p = it.p;
      const node = el('div', 'thumb');
      node.style.width = it.w + 'px';
      node.style.height = it.h + 'px';
      const art = el('button', 'art');
      art.type = 'button';
      art.setAttribute('aria-label', (p.title || 'Untitled') + ' by ' + (p.artist || 'unknown artist'));
      if (p.thumb) {
        const img = new Image();
        img.alt = '';
        img.loading = 'lazy';
        img.decoding = 'async';
        img.referrerPolicy = 'no-referrer';
        img.src = p.thumb;
        img.onerror = () => img.replaceWith(placeholder(p));
        art.append(img);
      } else {
        art.append(placeholder(p));
      }
      if (p.kind === 'video') art.append(el('span', 'play'));
      art.addEventListener('click', () => { if (!S.moved) flyToItem(it); });

      const cap = el('div', 'cap');
      const a = el('a', null, p.artist || 'Unknown artist');
      a.href = p.artistUrl || p.url || '#';
      a.target = '_blank';
      a.rel = 'noopener';
      const top = el('div');
      top.append(a);
      if (p.ai === true) top.append(el('span', 'badge ai', 'AI'));
      else if (p.ai === 'unconfirmed') top.append(el('span', 'badge', 'AI?'));
      else top.append(el('span', 'badge', 'ORIGINAL'));
      cap.append(top, el('div', 'meta', [p.source, p.region].filter(Boolean).join(' · ').toUpperCase()));

      if (it.ring) { node.classList.add('linked'); node.style.setProperty('--ring', it.ring); }
      node.append(art, cap);
      world.append(node);
      it.node = node; it.cap = cap; it.vis = true; it.near = false;
    }
    for (const c of S.clusters) {
      if (c.ai) { c.ringEl = el('div', 'ring'); labels.append(c.ringEl); }
      const t = el('div', 'ctitle' + (c.ai ? ' ai' : ''));
      t.append(el('div', 'n', c.label), el('div', 'c', c.n + (c.n === 1 ? ' PIECE' : ' PIECES')));
      labels.append(t);
      c.title = t;
    }
    for (const l of S.links) {
      const path = document.createElementNS(NS, 'path');
      path.setAttribute('stroke', LC[l.type]);
      path.setAttribute('stroke-opacity', '0.8');
      svg.append(path);
      l.path = path;
      const lab = el('div', 'llabel', l.label);
      lab.style.color = LC[l.type];
      lab.style.borderColor = LC[l.type] + '66';
      labels.append(lab);
      l.lab = lab;
    }
    S.dirty = true;
  }

  /* ---------- camera ---------- */
  const center = () => ({ x: S.w / 2, y: S.top + (S.h - S.top - S.bottom) / 2 });

  function fit(items, animate) {
    if (!items.length) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const it of items) {
      x0 = Math.min(x0, it.x - it.w / 2); x1 = Math.max(x1, it.x + it.w / 2);
      y0 = Math.min(y0, it.y - it.h / 2); y1 = Math.max(y1, it.y + it.h / 2);
    }
    const aw = Math.max(200, S.w - 80), ah = Math.max(160, S.h - S.top - S.bottom - 140);
    const s = Math.min(aw / (x1 - x0), ah / (y1 - y0), 2.2);
    const to = { x: (x0 + x1) / 2, y: (y0 + y1) / 2 - 30 / s, z: F / s + 80 };
    if (items.length === S.items.filter((i) => !i.dim).length && S.filter === 'all') S.fitZ = to.z;
    S.fitZ = Math.max(S.fitZ, to.z);
    moveTo(to, animate);
  }

  function moveTo(to, animate) {
    S.vel = { x: 0, y: 0 };
    if (!animate || REDUCE) { S.cam = { ...to }; S.tween = null; S.dirty = true; return; }
    S.tween = { from: { ...S.cam }, to, t0: performance.now(), d: 850 };
  }

  function flyToItem(it) {
    const target = Math.min(440, S.w * 0.42, (S.h - S.top - S.bottom) * 0.6);
    const s = target / it.w;
    moveTo({ x: it.x, y: it.y + it.h * 0.12, z: it.z + F / s }, true);
  }

  function zoomAt(mx, my, f) {
    const c = center();
    const nz = clamp(S.cam.z * f, 300, S.fitZ * 1.8);
    const wx = S.cam.x + (mx - c.x) * S.cam.z / F, wy = S.cam.y + (my - c.y) * S.cam.z / F;
    S.cam.z = nz;
    S.cam.x = wx - (mx - c.x) * nz / F;
    S.cam.y = wy - (my - c.y) * nz / F;
    S.tween = null;
    S.dirty = true;
  }

  function pan(dx, dy) {
    S.cam.x -= dx * S.cam.z / F;
    S.cam.y -= dy * S.cam.z / F;
    S.dirty = true;
  }

  /* ---------- render loop ---------- */
  function frame(t) {
    requestAnimationFrame(frame);
    if (S.tween) {
      const k = Math.min(1, (t - S.tween.t0) / S.tween.d);
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      for (const a of ['x', 'y', 'z']) S.cam[a] = S.tween.from[a] + (S.tween.to[a] - S.tween.from[a]) * e;
      if (k >= 1) S.tween = null;
      S.dirty = true;
    }
    if (!S.dragging && (Math.abs(S.vel.x) > 0.05 || Math.abs(S.vel.y) > 0.05)) {
      pan(S.vel.x, S.vel.y);
      S.vel.x *= 0.9; S.vel.y *= 0.9;
    }
    if (!REDUCE) {
      const dx = S.ptr.x - S.par.x, dy = S.ptr.y - S.par.y;
      if (Math.abs(dx) + Math.abs(dy) > 0.05) { S.par.x += dx * 0.08; S.par.y += dy * 0.08; S.dirty = true; }
    }
    if (S.dirty) { S.dirty = false; render(); }
  }

  function render() {
    const c = center();
    const diag = Math.hypot(S.w, S.h) / 2;
    for (const cl of S.clusters) cl.b = null;
    for (const it of S.items) {
      const dz = S.cam.z - it.z;
      let show = dz > 70;
      let px, py, W, H, k;
      if (show) {
        const s = F / dz;
        const pz = it.z / 210;
        px = c.x + (it.x - S.cam.x) * s - S.par.x * pz;
        py = c.y + (it.y - S.cam.y) * s - S.par.y * pz;
        const nd = Math.min(1, Math.hypot(px - c.x, py - c.y) / (diag * 0.8));
        k = s * (1.24 - 0.44 * nd);
        W = it.w * k; H = it.h * k;
        show = !(px + W / 2 < -150 || px - W / 2 > S.w + 150 || py + H / 2 < -150 || py - H / 2 > S.h + 150);
      }
      if (show !== it.vis) { it.node.style.visibility = show ? '' : 'hidden'; it.vis = show; }
      if (!show) { it.sx = null; continue; }
      it.node.style.transform = 'translate3d(' + (px - W / 2).toFixed(1) + 'px,' + (py - H / 2).toFixed(1) + 'px,0) scale(' + k.toFixed(4) + ')';
      it.node.style.zIndex = String(Math.round(100000 - dz));
      const near = W > 110 && !it.dim;
      if (near !== it.near) { it.node.classList.toggle('near', near); it.near = near; }
      if (near) it.cap.style.transform = 'scale(' + (1 / k).toFixed(4) + ')';
      it.sx = px; it.sy = py; it.sw = W; it.sh = H;
      if (!it.dim) {
        const b = it.c.b || (it.c.b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
        b.x0 = Math.min(b.x0, px - W / 2); b.y0 = Math.min(b.y0, py - H / 2);
        b.x1 = Math.max(b.x1, px + W / 2); b.y1 = Math.max(b.y1, py + H / 2);
      }
    }
    for (const cl of S.clusters) {
      const b = cl.b;
      if (!b) { cl.title.style.visibility = 'hidden'; if (cl.ringEl) cl.ringEl.style.visibility = 'hidden'; continue; }
      cl.title.style.visibility = '';
      const x = Math.max(b.x0, 16), y = Math.max(b.y0 - 10, S.top + 56);
      cl.title.style.transform = 'translate3d(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px,0) translateY(-100%)';
      if (cl.ringEl) {
        const r = Math.max(b.x1 - b.x0, b.y1 - b.y0) / 2 + 36;
        const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
        cl.ringEl.style.visibility = '';
        cl.ringEl.style.width = cl.ringEl.style.height = (r * 2).toFixed(0) + 'px';
        cl.ringEl.style.transform = 'translate3d(' + (cx - r).toFixed(1) + 'px,' + (cy - r).toFixed(1) + 'px,0)';
      }
    }
    for (const l of S.links) {
      const A = l.a, B = l.b;
      if (A.sx == null || B.sx == null || A.dim || B.dim) {
        if (l.on !== false) { l.path.setAttribute('d', ''); l.lab.style.visibility = 'hidden'; l.on = false; }
        continue;
      }
      l.on = true;
      const dx = B.sx - A.sx, dy = B.sy - A.sy, len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len, ny = dx / len, kk = Math.min(90, len * 0.22);
      l.path.setAttribute('d', 'M' + A.sx.toFixed(1) + ' ' + A.sy.toFixed(1) +
        ' C' + (A.sx + dx / 3 + nx * kk).toFixed(1) + ' ' + (A.sy + dy / 3 + ny * kk).toFixed(1) +
        ' ' + (A.sx + 2 * dx / 3 - nx * kk).toFixed(1) + ' ' + (A.sy + 2 * dy / 3 - ny * kk).toFixed(1) +
        ' ' + B.sx.toFixed(1) + ' ' + B.sy.toFixed(1));
      const showLab = len > 170 && S.cam.z < S.fitZ * 0.6;
      l.lab.style.visibility = showLab ? '' : 'hidden';
      if (showLab) l.lab.style.transform = 'translate3d(' + ((A.sx + B.sx) / 2).toFixed(1) + 'px,' + ((A.sy + B.sy) / 2).toFixed(1) + 'px,0) translate(-50%,-50%)';
    }
  }

  /* ---------- timeline ---------- */
  function renderTimeline() {
    const weeks = S.index.weeks, n = weeks.length, sel = S.weekIdx;
    const track = $('#track');
    for (const e of [...track.children]) if (e.id !== 'line') e.remove();
    const W = track.clientWidth, pad = 60;
    const xs = [];
    if (n === 1) xs.push(W / 2);
    else {
      const gaps = [];
      for (let j = 0; j < n - 1; j++) {
        const d = Math.min(Math.abs(j - sel), Math.abs(j + 1 - sel));
        gaps.push(1 / (1 + 0.55 * Math.pow(d, 1.15)));
      }
      const tot = gaps.reduce((a, b) => a + b, 0);
      xs.push(pad);
      for (const g of gaps) xs.push(xs[xs.length - 1] + g / tot * (W - pad * 2));
    }
    S.tlx = xs;
    const labelled = xs.map((x, i) => i !== sel && (i === 0 || x - xs[i - 1] >= 46) && (i === n - 1 || xs[i + 1] - x >= 46) && Math.abs(x - xs[sel]) > 70);
    weeks.forEach((w, i) => {
      const b = el('button', 'wk');
      b.type = 'button';
      b.style.left = xs[i] + 'px';
      b.setAttribute('aria-label', 'Week ' + wkLabel(w).slice(1) + ', ' + rangeLabel(w));
      b.title = wkLabel(w) + ' · ' + rangeLabel(w);
      b.addEventListener('click', () => selectWeek(i));
      track.append(b);
      if (labelled[i]) {
        const l = el('div', 'wk-l', wkLabel(w));
        l.style.left = xs[i] + 'px';
        track.append(l);
      }
    });
    const runs = (from, to) => {
      const idx = [];
      for (let i = from; i <= to; i++) if (i !== sel && !labelled[i]) idx.push(i);
      if (idx.length < 2) { if (idx.length === 1 && Math.abs(xs[idx[0]] - xs[sel]) > 70) { const l = el('div', 'wk-l', wkLabel(weeks[idx[0]])); l.style.left = xs[idx[0]] + 'px'; track.append(l); } return; }
      const mid = (xs[idx[0]] + xs[idx[idx.length - 1]]) / 2;
      if (Math.abs(mid - xs[sel]) < 80) return;
      const l = el('div', 'wk-l', wkLabel(weeks[idx[0]]) + '–' + wkLabel(weeks[idx[idx.length - 1]]));
      l.style.left = mid + 'px';
      track.append(l);
    };
    runs(0, sel - 1);
    runs(sel + 1, n - 1);
    const cur = el('div', 'wk-cur');
    const latest = sel === n - 1;
    cur.append(el('div', 'w', wkLabel(weeks[sel])), el('div', 'd', rangeLabel(weeks[sel]) + (latest ? ' · THIS WEEK' : '')));
    cur.style.left = clamp(xs[sel], 70, W - 70) + 'px';
    track.append(cur);
    const h = el('button');
    h.id = 'handle';
    h.type = 'button';
    h.setAttribute('aria-label', 'Drag to choose a week. Current: ' + wkLabel(weeks[sel]));
    h.style.left = xs[sel] + 'px';
    track.append(h);
    bindHandle(h);
    $('#prevWeek').disabled = sel === 0;
    $('#nextWeek').disabled = sel === n - 1;
  }

  function bindHandle(h) {
    h.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      h.setPointerCapture(e.pointerId);
      const rect = $('#track').getBoundingClientRect();
      let near = S.weekIdx;
      const move = (ev) => {
        const x = clamp(ev.clientX - rect.left, S.tlx[0], S.tlx[S.tlx.length - 1]);
        h.style.left = x + 'px';
        let best = 0;
        S.tlx.forEach((tx, i) => { if (Math.abs(tx - x) < Math.abs(S.tlx[best] - x)) best = i; });
        near = best;
      };
      const up = () => {
        h.removeEventListener('pointermove', move);
        h.removeEventListener('pointerup', up);
        h.removeEventListener('pointercancel', up);
        selectWeek(near);
      };
      h.addEventListener('pointermove', move);
      h.addEventListener('pointerup', up);
      h.addEventListener('pointercancel', up);
    });
  }

  /* ---------- input ---------- */
  function bind() {
    stage.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.cap a')) return;
      S.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (S.pointers.size === 2) {
        const [p1, p2] = [...S.pointers.values()];
        S.pinch = { d: Math.hypot(p1.x - p2.x, p1.y - p2.y) };
      }
      S.dragging = true;
      S.moved = false;
      $('#hint').classList.add('gone');
      S.down = { x: e.clientX, y: e.clientY };
      S.last = { x: e.clientX, y: e.clientY };
      S.vel = { x: 0, y: 0 };
      S.tween = null;
    });
    addEventListener('pointermove', (e) => {
      S.ptr.x = (e.clientX / S.w - 0.5) * 60;
      S.ptr.y = (e.clientY / S.h - 0.5) * 40;
      if (!S.dragging || !S.pointers.has(e.pointerId)) return;
      S.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (S.pointers.size === 2 && S.pinch) {
        const [p1, p2] = [...S.pointers.values()];
        const d = Math.hypot(p1.x - p2.x, p1.y - p2.y);
        zoomAt((p1.x + p2.x) / 2, (p1.y + p2.y) / 2, S.pinch.d / d);
        S.pinch.d = d;
        S.moved = true;
        return;
      }
      const dx = e.clientX - S.last.x, dy = e.clientY - S.last.y;
      S.last = { x: e.clientX, y: e.clientY };
      if (!S.moved && Math.hypot(e.clientX - S.down.x, e.clientY - S.down.y) > 4) { S.moved = true; stage.classList.add('dragging'); }
      if (S.moved) { pan(dx, dy); S.vel = { x: dx, y: dy }; }
    });
    const end = (e) => {
      S.pointers.delete(e.pointerId);
      if (S.pointers.size < 2) S.pinch = null;
      if (S.pointers.size === 0) {
        S.dragging = false;
        stage.classList.remove('dragging');
        setTimeout(() => { S.moved = false; }, 0);
      }
    };
    addEventListener('pointerup', end);
    addEventListener('pointercancel', end);

    stage.addEventListener('wheel', (e) => {
      e.preventDefault();
      let dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
      zoomAt(e.clientX, e.clientY, Math.exp(dy * (e.ctrlKey ? 0.005 : 0.0011)));
    }, { passive: false });

    stage.addEventListener('dblclick', (e) => {
      if (e.target.closest('.thumb')) return;
      zoomAt(e.clientX, e.clientY, 0.45);
    });

    addEventListener('keydown', (e) => {
      if (e.target.closest && e.target.closest('input, textarea')) return;
      const step = 90;
      switch (e.key) {
        case 'ArrowLeft': case 'a': pan(step, 0); break;
        case 'ArrowRight': case 'd': pan(-step, 0); break;
        case 'ArrowUp': case 'w': pan(0, step); break;
        case 'ArrowDown': case 's': pan(0, -step); break;
        case '+': case '=': case 'e': { const c = center(); zoomAt(c.x, c.y, 0.75); break; }
        case '-': case '_': case 'q': { const c = center(); zoomAt(c.x, c.y, 1.33); break; }
        case 'Escape': fit(S.items.filter((it) => !it.dim), true); break;
        case 'PageUp': case '[': selectWeek(S.weekIdx - 1); break;
        case 'PageDown': case ']': selectWeek(S.weekIdx + 1); break;
        default: return;
      }
      e.preventDefault();
    });

    $('#prevWeek').addEventListener('click', () => selectWeek(S.weekIdx - 1));
    $('#nextWeek').addEventListener('click', () => selectWeek(S.weekIdx + 1));

    let rt;
    addEventListener('resize', () => {
      clearTimeout(rt);
      rt = setTimeout(() => { measure(); renderTimeline(); S.dirty = true; }, 80);
    });
  }

  init();
})();
