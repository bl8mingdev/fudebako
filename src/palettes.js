// Colour palettes for document content.
// Each palette is a gradient from its deepest colour (H1) to its lightest (H6);
// bold, italic, links, code, quotes, bullets and tables pick their tone from the same scale.
// `light` = [deep, light] on paper backgrounds, `dark` = [vivid, soft] on dark backgrounds.
export const PALETTES = [
  { id: 'none', name: 'Ink' },
  { id: 'ocean', name: 'Ocean', light: ['#0b2545', '#3c8dd6'], dark: ['#b0d6ff', '#5a86b8'] },
  { id: 'forest', name: 'Forest', light: ['#0f3d2b', '#5fa173'], dark: ['#a6e9bf', '#5f9a77'] },
  { id: 'matcha', name: 'Matcha', light: ['#2f3d12', '#8fae3a'], dark: ['#d5ebA0', '#89a44f'] },
  { id: 'sunset', name: 'Sunset', light: ['#5c1220', '#e8833a'], dark: ['#ffb39a', '#d08a52'] },
  { id: 'sakura', name: 'Sakura', light: ['#6a1b45', '#e58bb2'], dark: ['#ffc6de', '#b97598'] },
  { id: 'aurora', name: 'Aurora', light: ['#2c1873', '#14a39a'], dark: ['#d0bfff', '#4cc7ba'] },
  { id: 'royal', name: 'Royal', light: ['#3b0f63', '#b8862b'], dark: ['#dfc4ff', '#e0b961'] },
  { id: 'slate', name: 'Slate', light: ['#0f172a', '#7286a0'], dark: ['#eef2f8', '#8796ab'] },
  { id: 'custom', name: 'Custom' },
];

/** Returns [H1, H6] CSS colours for the palette in the current theme (swapped when reversed), or null for none. */
export function paletteColors(st, dark) {
  return paletteStops(st, dark);
}
function baseColors(st, dark) {
  if (st.palette === 'custom') {
    const deep = st.customDeep || '#1d3557', light = st.customLight || '#e76f51';
    return dark
      ? [`color-mix(in oklch, ${deep} 45%, white)`, `color-mix(in oklch, ${light} 80%, #9a9a9a)`]
      : [deep, light];
  }
  const p = PALETTES.find((x) => x.id === st.palette);
  if (!p || !p.light) return null;
  return dark ? p.dark : p.light;
}

/** 6-step preview strip (H1 → H6) for the appearance panel. */
export function strip(colors) {
  if (!colors) return '<span class="pal-strip ink"><i></i><i></i><i></i><i></i><i></i><i></i></span>';
  if (colors.length > 2) return '<span class="pal-strip">' + colors.map((c) => `<i style="background:${c}"></i>`).join('') + '</span>';
  const [a, b] = colors;
  return '<span class="pal-strip">' + [0, 20, 40, 60, 80, 100]
    .map((k) => `<i style="background:color-mix(in oklch, ${a} ${100 - k}%, ${b})"></i>`).join('') + '</span>';
}

/* ==========================================================================
   Catppuccin (MIT) — official colours from @catppuccin/palette 1.8.0.
   Latte is used in light mode; the chosen dark flavour (Frappé, Macchiato, Mocha) in dark mode.
   Headings follow Catppuccin's Markdown convention: red, peach, yellow, green, sapphire, lavender.
   ========================================================================== */
export const CATPPUCCIN = {
  latte: { name: 'Latte', rosewater: '#dc8a78', flamingo: '#dd7878', pink: '#ea76cb', mauve: '#8839ef', red: '#d20f39', maroon: '#e64553', peach: '#fe640b', yellow: '#df8e1d', green: '#40a02b', teal: '#179299', sky: '#04a5e5', sapphire: '#209fb5', blue: '#1e66f5', lavender: '#7287fd', text: '#4c4f69', subtext1: '#5c5f77', subtext0: '#6c6f85', overlay2: '#7c7f93', overlay1: '#8c8fa1', overlay0: '#9ca0b0', surface2: '#acb0be', surface1: '#bcc0cc', surface0: '#ccd0da', base: '#eff1f5', mantle: '#e6e9ef', crust: '#dce0e8' },
  frappe: { name: 'Frappé', rosewater: '#f2d5cf', flamingo: '#eebebe', pink: '#f4b8e4', mauve: '#ca9ee6', red: '#e78284', maroon: '#ea999c', peach: '#ef9f76', yellow: '#e5c890', green: '#a6d189', teal: '#81c8be', sky: '#99d1db', sapphire: '#85c1dc', blue: '#8caaee', lavender: '#babbf1', text: '#c6d0f5', subtext1: '#b5bfe2', subtext0: '#a5adce', overlay2: '#949cbb', overlay1: '#838ba7', overlay0: '#737994', surface2: '#626880', surface1: '#51576d', surface0: '#414559', base: '#303446', mantle: '#292c3c', crust: '#232634' },
  macchiato: { name: 'Macchiato', rosewater: '#f4dbd6', flamingo: '#f0c6c6', pink: '#f5bde6', mauve: '#c6a0f6', red: '#ed8796', maroon: '#ee99a0', peach: '#f5a97f', yellow: '#eed49f', green: '#a6da95', teal: '#8bd5ca', sky: '#91d7e3', sapphire: '#7dc4e4', blue: '#8aadf4', lavender: '#b7bdf8', text: '#cad3f5', subtext1: '#b8c0e0', subtext0: '#a5adcb', overlay2: '#939ab7', overlay1: '#8087a2', overlay0: '#6e738d', surface2: '#5b6078', surface1: '#494d64', surface0: '#363a4f', base: '#24273a', mantle: '#1e2030', crust: '#181926' },
  mocha: { name: 'Mocha', rosewater: '#f5e0dc', flamingo: '#f2cdcd', pink: '#f5c2e7', mauve: '#cba6f7', red: '#f38ba8', maroon: '#eba0ac', peach: '#fab387', yellow: '#f9e2af', green: '#a6e3a1', teal: '#94e2d5', sky: '#89dceb', sapphire: '#74c7ec', blue: '#89b4fa', lavender: '#b4befe', text: '#cdd6f4', subtext1: '#bac2de', subtext0: '#a6adc8', overlay2: '#9399b2', overlay1: '#7f849c', overlay0: '#6c7086', surface2: '#585b70', surface1: '#45475a', surface0: '#313244', base: '#1e1e2e', mantle: '#181825', crust: '#11111b' },
};
PALETTES.splice(PALETTES.length - 1, 0, { id: 'catppuccin', name: 'Catppuccin' });

const ctpFlavor = (st, dark) => (dark ? CATPPUCCIN[st.ctpFlavor] || CATPPUCCIN.mocha : CATPPUCCIN.latte);
const CTP_ACCENT = { vermilion: 'peach', violet: 'mauve', cobalt: 'blue', teal: 'teal', rose: 'pink', amber: 'yellow' };

/** Heading colours H1→H6 (2 end points, or 6 explicit stops), already reversed if asked. */
export function paletteStops(st, dark) {
  let c;
  if (st.palette === 'catppuccin') {
    const f = ctpFlavor(st, dark);
    c = [f.red, f.peach, f.yellow, f.green, f.sapphire, f.lavender];
  } else c = baseColors(st, dark);
  return c && st.paletteDir === 'reverse' ? [...c].reverse() : c;
}

/** All CSS custom properties a palette sets on <html> (applied inline, baked into exports). */
export function paletteVars(st, dark) {
  const v = {};
  if (st.palette === 'catppuccin') {
    const f = ctpFlavor(st, dark);
    const stops = paletteStops(st, dark);
    stops.forEach((c, i) => (v['--c' + (i + 1)] = c));
    Object.assign(v, {
      '--p-deep': stops[0], '--p-light': stops[5], '--p-soft': f.lavender,
      '--r-strong': f.maroon, '--r-em': f.pink, '--r-link': f.blue, '--r-code': f.green,
      '--r-quote': f.mauve, '--r-marker': f.mauve, '--r-olmarker': f.overlay2, '--r-task': f.green,
      '--r-rule': f.overlay1, '--r-lead': f.subtext0, '--r-th': f.mauve, '--r-dt': f.mauve, '--r-meta': f.overlay1, '--r-dd': f.surface2,
    });
    if (st.ctpTint !== false) {
      const acc = f[CTP_ACCENT[st.accent] || 'mauve'];
      Object.assign(v, {
        '--bg': f.base, '--surface': f.mantle, '--raised': dark ? f.surface0 : '#f9fafc', '--code-bg': f.mantle,
        '--ink': f.text, '--ink-2': f.subtext1, '--ink-3': f.overlay1, '--line': f.surface0, '--line-2': f.surface1,
        '--glass': `color-mix(in srgb, ${f.base} 80%, transparent)`, '--bar': f.text, '--bar-ink': f.base,
        '--accent': acc, '--accent-hex': acc,
        '--surface-hex': f.base, '--ink-hex': f.text, '--ink2-hex': f.subtext0, '--m-node': f.mantle, '--m-node2': f.surface0, '--m-node3': f.crust,
        '--alert-note': f.blue, '--alert-tip': f.green, '--alert-important': f.mauve, '--alert-warning': f.yellow, '--alert-caution': f.red,
        '--hl-kw': f.mauve, '--hl-str': f.green, '--hl-num': f.peach, '--hl-com': f.overlay2, '--hl-fn': f.blue, '--hl-type': f.yellow, '--hl-attr': f.yellow, '--hl-var': f.teal,
      });
    }
    return v;
  }
  const pc = paletteStops(st, dark);
  if (!pc) return v;
  v['--p-deep'] = pc[0]; v['--p-light'] = pc[1];
  v['--p-soft'] = baseColors(st, dark)[1]; // tints always use the soft end
  return v;
}
