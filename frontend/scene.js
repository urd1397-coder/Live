'use strict';
/* scene.js — خلفيات المسرح والعناصر الأمامية (مكتب/مايك). كل الإحداثيات بوحدات تصميم المسرح (W×H) */
const Scene = (() => {
  const GLOW = '<defs><filter id="sc-glow" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>';
  const svg = (W, H, inner) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice">${GLOW}${inner}</svg>`;
  const grad = (id, a, b, ang = 135) => {
    const r = ang * Math.PI / 180, x = Math.cos(r), y = Math.sin(r);
    return `<linearGradient id="${id}" x1="${(0.5 - x / 2).toFixed(3)}" y1="${(0.5 - y / 2).toFixed(3)}" x2="${(0.5 + x / 2).toFixed(3)}" y2="${(0.5 + y / 2).toFixed(3)}"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`;
  };

  const PRESETS = {
    studio: { name: 'استوديو نيون', build: (W, H) => svg(W, H,
      `<defs>${grad('g', '#2d1d5c', '#0d0a1f', 120)}<radialGradient id="r" cx=".5" cy=".38" r=".7"><stop offset="0" stop-color="#7b5cff" stop-opacity=".35"/><stop offset="1" stop-color="#7b5cff" stop-opacity="0"/></radialGradient></defs>` +
      `<rect width="${W}" height="${H}" fill="url(#g)"/><rect width="${W}" height="${H}" fill="url(#r)"/>` +
      `<g filter="url(#sc-glow)" opacity=".95"><rect x="0" y="${H * .30}" width="${W * .22}" height="${H * .004 + 3}" fill="#3b8cff"/><rect x="0" y="${H * .38}" width="${W * .16}" height="${H * .004 + 3}" fill="#7a5cff"/><rect x="${W * .86}" y="${H * .34}" width="${W * .14}" height="${H * .004 + 3}" fill="#3b8cff"/></g>` +
      `<g opacity=".25" fill="#000"><rect x="${W * .04}" y="${H * .44}" width="${W * .09}" height="${H * .12}" rx="8"/><rect x="${W * .88}" y="${H * .42}" width="${W * .07}" height="${H * .14}" rx="8"/></g>`) },
    gaming: { name: 'غرفة ألعاب', build: (W, H) => svg(W, H,
      `<defs>${grad('g', '#07222b', '#050912', 160)}</defs><rect width="${W}" height="${H}" fill="url(#g)"/>` +
      `<g filter="url(#sc-glow)"><rect x="${W * .08}" y="${H * .18}" width="${W * .34}" height="${H * .2}" rx="14" fill="#0b3a4a" stroke="#27e1ff" stroke-width="4"/><rect x="${W * .58}" y="${H * .24}" width="${W * .3}" height="${H * .16}" rx="14" fill="#2a0b3a" stroke="#ff4fd8" stroke-width="4"/></g>` +
      `<g opacity=".5"><rect x="${W * .12}" y="${H * .22}" width="${W * .12}" height="${H * .01}" fill="#27e1ff"/><rect x="${W * .12}" y="${H * .25}" width="${W * .2}" height="${H * .01}" fill="#27e1ff"/><rect x="${W * .63}" y="${H * .28}" width="${W * .16}" height="${H * .01}" fill="#ff4fd8"/></g>`) },
    sunset: { name: 'غروب', build: (W, H) => svg(W, H,
      `<defs>${grad('g', '#ff7a59', '#3b1f6b', 90)}</defs><rect width="${W}" height="${H}" fill="url(#g)"/>` +
      `<circle cx="${W / 2}" cy="${H * .42}" r="${Math.min(W, H) * .22}" fill="#ffd27a" opacity=".85"/><path d="M0 ${H * .66} Q ${W * .25} ${H * .56} ${W * .5} ${H * .65} T ${W} ${H * .62} V ${H} H0Z" fill="#1d1038" opacity=".85"/>`) },
    light: { name: 'فاتح هادئ', build: (W, H) => svg(W, H,
      `<defs>${grad('g', '#f4f1ea', '#cfd8e6', 120)}</defs><rect width="${W}" height="${H}" fill="url(#g)"/><circle cx="${W * .8}" cy="${H * .2}" r="${Math.min(W, H) * .25}" fill="#fff" opacity=".6"/>`) },
    dark: { name: 'داكن بسيط', build: (W, H) => svg(W, H,
      `<defs>${grad('g', '#1a1b22', '#08080c', 100)}</defs><rect width="${W}" height="${H}" fill="url(#g)"/>`) },
    chroma: { name: 'شاشة خضراء (للدمج)', build: (W, H) => svg(W, H, `<rect width="${W}" height="${H}" fill="#00b140"/>`) }
  };

  function bgHTML(bg, W, H) {
    bg = bg || { type: 'preset', preset: 'studio' };
    if (bg.type === 'color') return `<div class="bgfill" style="background:${esc(bg.c1 || '#101218')}"></div>`;
    if (bg.type === 'gradient') return `<div class="bgfill" style="background:linear-gradient(${Number(bg.angle) || 160}deg,${esc(bg.c1 || '#2d1d5c')},${esc(bg.c2 || '#0d0a1f')})"></div>`;
    if (bg.type === 'image' && bg.src) {
      const fit = bg.fit === 'contain' ? 'contain' : 'cover';
      const dim = Math.max(0, Math.min(.8, Number(bg.dim) || 0));
      return `<div class="bgfill" style="background:#000 center/${fit} no-repeat url('${bg.src.replace(/'/g, '%27')}');filter:blur(${Number(bg.blur) || 0}px)"></div>` + (dim ? `<div class="bgfill" style="background:rgba(0,0,0,${dim})"></div>` : '');
    }
    return (PRESETS[bg.preset] || PRESETS.studio).build(W, H);
  }
  const esc = s => String(s).replace(/[<>"']/g, '');

  // مكتب + لوحة مفاتيح + مايك + كوب: أمام الشخصية (تظهر خلفه الأرجل). deskTop = ارتفاع سطح المكتب
  function propsHTML(W, H, deskTop) {
    const dh = H - deskTop, u = W / 1000;
    return svg(W, H,
      `<rect x="-10" y="${deskTop}" width="${W + 20}" height="${dh + 10}" fill="#241a3a"/><rect x="-10" y="${deskTop}" width="${W + 20}" height="${Math.max(5, 6 * u)}" fill="#5a4690"/>` +
      `<g filter="url(#sc-glow)"><rect x="${W * .12}" y="${deskTop + 38 * u}" width="${W * .42}" height="${28 * u}" rx="${8 * u}" fill="#16122b" stroke="#3b8cff" stroke-width="${3 * u}"/></g>` +
      `<g transform="translate(${W * .8} ${deskTop - 250 * u}) rotate(16)"><path d="M0 230L${-90 * u} ${300 * u}" stroke="#0b0a14" stroke-width="${10 * u}" stroke-linecap="round"/>` +
      `<rect x="${-36 * u}" y="0" width="${72 * u}" height="${210 * u}" rx="${36 * u}" fill="#15141f" stroke="#0b0a14" stroke-width="${7 * u}"/><rect x="${-33 * u}" y="${100 * u}" width="${66 * u}" height="${12 * u}" fill="#3b8cff" filter="url(#sc-glow)"/></g>` +
      `<g transform="translate(${W * .9} ${deskTop - 18 * u})"><rect x="${-44 * u}" y="0" width="${88 * u}" height="${80 * u}" rx="${10 * u}" fill="#15141f" stroke="#0b0a14" stroke-width="${6 * u}"/><path d="M${44 * u} ${16 * u}h${20 * u}a${18 * u} ${18 * u} 0 0 1 0 ${42 * u}h${-20 * u}" fill="none" stroke="#0b0a14" stroke-width="${8 * u}"/><path d="M${-28 * u} ${22 * u}h${24 * u}v${12 * u}h${-24 * u}zM${4 * u} ${22 * u}h${24 * u}v${12 * u}h${-24 * u}z" fill="#fff"/></g>`);
  }

  // مقاسات المسرح الجاهزة (وحدات تصميم)
  const ASPECTS = {
    '9:16': { w: 1080, h: 1920, name: 'عمودي 9:16 (تيك توك / ريلز / شورتس)' },
    '16:9': { w: 1920, h: 1080, name: 'أفقي 16:9 (يوتيوب)' },
    '1:1': { w: 1080, h: 1080, name: 'مربع 1:1' },
    '4:5': { w: 1080, h: 1350, name: 'عمودي 4:5 (إنستغرام)' }
  };
  // تموضع افتراضي للشخصية: الخصر عند سطح المكتب
  function autoLayout(aspect) {
    const A = ASPECTS[aspect] || ASPECTS['9:16'];
    const deskTop = Math.round(A.h * (A.w > A.h ? .76 : .72)), S = Math.min(A.w * (A.w < A.h ? 1.25 : 1.0), A.h * (A.w > A.h ? .66 : .62));
    return { cx: .5, top: +((deskTop - .8 * S) / A.h).toFixed(4), size: +(S / A.w).toFixed(4), deskTop: +(deskTop / A.h).toFixed(4) };
  }
  return { PRESETS, ASPECTS, bgHTML, propsHTML, autoLayout };
})();
