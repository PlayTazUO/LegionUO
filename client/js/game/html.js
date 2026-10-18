let rawTextEnabled = false;

export function setRawText(enabled) {
  rawTextEnabled = !!enabled;
}

export function isRawText() {
  return rawTextEnabled;
}

const FIVE_BIT = [
  0x00, 0x08, 0x10, 0x18, 0x20, 0x29, 0x31, 0x39, 0x41, 0x4a, 0x52, 0x5a, 0x62, 0x6a, 0x73, 0x7b,
  0x83, 0x8b, 0x94, 0x9c, 0xa4, 0xac, 0xb4, 0xbd, 0xc5, 0xcd, 0xd5, 0xde, 0xe6, 0xee, 0xf6, 0xff,
];

const NAMED_COLORS = {
  red: '#ff0000',
  cyan: '#00ffff',
  blue: '#0000ff',
  darkblue: '#0000a0',
  lightblue: '#add8e6',
  purple: '#800080',
  yellow: '#ffff00',
  lime: '#00ff00',
  magenta: '#ff00ff',
  white: '#fefefe',
  silver: '#c0c0c0',
  grey: '#808080',
  gray: '#808080',
  black: '#010101',
  orange: '#ffa500',
  brown: '#a52a2a',
  maroon: '#800000',
  green: '#008000',
  olive: '#808000',
};

const KNOWN_TAGS = new Set([
  'b',
  'i',
  'u',
  'a',
  'p',
  'big',
  'small',
  'body',
  'basefont',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'br',
  'bq',
  'left',
  'center',
  'right',
  'div',
  'color',
  'bodybgcolor',
  'bodytext',
  'font',
]);

const MARKUP_RE = /<\s*\/?\s*[a-z#][^>]*>|&(?:#x[0-9a-f]+|#\d+|[a-z][a-z0-9]+);/i;

const TAG_SIZE = {
  big: 16,
  small: 11,
  h1: 18,
  h2: 17,
  h3: 16,
  h4: 12,
  h5: 12,
  h6: 11,
};

function makeStyle(base = {}) {
  return {
    color: base.color ?? null,
    bold: !!base.bold,
    italic: !!base.italic,
    underline: !!base.underline,
    size: base.size || 13,
    align: base.align || 'left',
    link: null,
  };
}

function cloneStyle(style) {
  return { ...style };
}

function sameStyle(a, b) {
  return (
    a.color === b.color &&
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.underline === b.underline &&
    a.size === b.size &&
    a.align === b.align &&
    a.link === b.link
  );
}

function fontFor(style, family) {
  return `${style.italic ? 'italic ' : ''}${style.bold ? 'bold ' : ''}${style.size}px ${family}`;
}

export function hasUoHtmlMarkup(text) {
  if (rawTextEnabled) return false;
  return MARKUP_RE.test(String(text || ''));
}

export function parseColor(raw) {
  let value = String(raw ?? '').trim();
  if (!value) return null;

  const lower = value.toLowerCase();
  if (lower.startsWith('#')) {
    let hex = value.slice(1);
    if (hex.toLowerCase().startsWith('0x')) hex = hex.slice(2);
    if (/^[0-9a-f]{3}$/i.test(hex)) {
      hex = hex
        .split('')
        .map((c) => c + c)
        .join('');
    }
    if (/^[0-9a-f]{6}$/i.test(hex)) return `#${hex.toLowerCase()}`;
    if (/^[0-9a-f]{8}$/i.test(hex)) return `#${hex.slice(0, 6).toLowerCase()}`;
    return null;
  }

  if (/^0x[0-9a-f]+$/i.test(value)) {
    const hex = value
      .slice(2)
      .padStart(6, '0')
      .slice(-6);
    return `#${hex.toLowerCase()}`;
  }

  if (/^[0-9]+$/i.test(value)) {
    const hex = parseInt(value, 16).toString(16).padStart(6, '0').slice(-6);
    return `#${hex}`;
  }

  if (/^[0-9a-f]{6}$/i.test(value)) return `#${value.toLowerCase()}`;
  return NAMED_COLORS[lower] || null;
}

export function color16ToCss(value) {
  const color = Number(value) & 0xffff;
  if (!color) return null;
  if (color === 0x7fff || color === 0xffff || color === 0xff) return '#ffffff';
  const r = FIVE_BIT[(color >> 10) & 0x1f];
  const g = FIVE_BIT[(color >> 5) & 0x1f];
  const b = FIVE_BIT[color & 0x1f];
  return `rgb(${r}, ${g}, ${b})`;
}

function parseSize(value) {
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) return null;
  if (text === 'big') return TAG_SIZE.big;
  if (text === 'small') return TAG_SIZE.small;
  const size = parseInt(text, 10);
  if (!Number.isFinite(size)) return null;
  if (size <= 0) return TAG_SIZE.small;
  if (size === 1) return 13;
  if (size === 2) return 12;
  if (size === 3) return 14;
  if (size === 4) return TAG_SIZE.big;
  return TAG_SIZE.h1;
}

function parseAlign(value) {
  const align = String(value ?? '').trim().toLowerCase();
  return align === 'left' || align === 'center' || align === 'right' ? align : null;
}

function decodeEntities(text) {
  return String(text).replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]+);/gi, (raw, entity) => {
    const key = entity.toLowerCase();
    if (key === 'nbsp') return ' ';
    if (key === 'amp') return '&';
    if (key === 'lt') return '<';
    if (key === 'gt') return '>';
    if (key === 'quot') return '"';
    if (key === 'apos') return "'";
    if (key.startsWith('#x')) {
      const code = parseInt(key.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : raw;
    }
    if (key.startsWith('#')) {
      const code = parseInt(key.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : raw;
    }
    return raw;
  });
}

function parseTag(raw) {
  let text = String(raw).trim();
  if (!text) return null;

  let closing = false;
  if (text.startsWith('/')) {
    closing = true;
    text = text.slice(1).trim();
  }
  if (text.endsWith('/')) {
    closing = true;
    text = text.slice(0, -1).trim();
  }

  const match = /^([a-z0-9]+)([\s\S]*)$/i.exec(text);
  if (!match) return null;

  const name = match[1].toLowerCase();
  const rest = match[2] || '';
  const attrs = {};
  const attrRe = /([a-z][\w-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  let attr;
  while ((attr = attrRe.exec(rest))) {
    attrs[attr[1].toLowerCase()] = attr[2] ?? attr[3] ?? attr[4] ?? '';
  }

  if (!Object.keys(attrs).length) {
    const eq = rest.indexOf('=');
    if (eq >= 0) {
      attrs.value = rest
        .slice(eq + 1)
        .trim()
        .replace(/^["']|["']$/g, '');
    }
  }

  return { name, closing, attrs };
}

export function parseUoHtml(html, base = {}) {
  const input = String(html ?? '').replace(/\r\n?/g, '\n');
  const defaults = makeStyle(base);
  if (rawTextEnabled) {
    return {
      items: input ? [{ type: 'text', text: input, style: defaults }] : [],
      background: null,
    };
  }
  let style = cloneStyle(defaults);
  let linkColor = base.linkColor || NAMED_COLORS.red;
  let background = null;

  const stack = [];
  const items = [];
  let pending = '';
  let pendingStyle = null;
  let lineHasText = false;

  const flush = () => {
    if (!pending) return;
    items.push({ type: 'text', text: pending, style: pendingStyle });
    pending = '';
    pendingStyle = null;
  };

  const pushText = (text, currentStyle) => {
    if (!text) return;
    if (pending && sameStyle(pendingStyle, currentStyle)) pending += text;
    else {
      flush();
      pending = text;
      pendingStyle = cloneStyle(currentStyle);
    }
    if (/\S/.test(text)) lineHasText = true;
  };

  const pushBreak = (currentStyle = style) => {
    flush();
    items.push({ type: 'break', style: cloneStyle(currentStyle) });
    lineHasText = false;
  };

  const emitText = (text, currentStyle) => {
    const parts = decodeEntities(text).split('\n');
    for (let i = 0; i < parts.length; i++) {
      if (parts[i]) pushText(parts[i], currentStyle);
      if (i < parts.length - 1) pushBreak(currentStyle);
    }
  };

  const open = (name, apply) => {
    stack.push({ name, previous: style });
    style = cloneStyle(style);
    if (apply) apply(style);
  };

  const close = (name) => {
    for (let i = stack.length - 1; i >= 0; i--) {
      if (stack[i].name !== name) continue;
      const frame = stack[i];
      stack.length = i;
      style = frame.previous;
      return true;
    }
    return false;
  };

  let i = 0;
  while (i < input.length) {
    const openIndex = input.indexOf('<', i);
    if (openIndex < 0) {
      emitText(input.slice(i), style);
      break;
    }
    if (openIndex > i) emitText(input.slice(i, openIndex), style);

    const closeIndex = input.indexOf('>', openIndex + 1);
    if (closeIndex < 0) {
      const remainder = input.slice(openIndex);
      if (!/^<\s*\/?\s*[a-z#]/i.test(remainder)) emitText(remainder, style);
      break;
    }

    const tag = parseTag(input.slice(openIndex + 1, closeIndex));
    i = closeIndex + 1;
    if (!tag || !KNOWN_TAGS.has(tag.name)) continue;

    const { name, closing, attrs } = tag;

    switch (name) {
      case 'b':
        if (closing) close('b');
        else open('b', (s) => (s.bold = true));
        break;

      case 'i':
        if (closing) close('i');
        else open('i', (s) => (s.italic = true));
        break;

      case 'u':
        if (closing) close('u');
        else open('u', (s) => (s.underline = true));
        break;

      case 'big':
      case 'small':
      case 'h1':
      case 'h2':
      case 'h3':
      case 'h4':
      case 'h5':
      case 'h6':
        if (!closing) {
          open(name, (s) => {
            s.size = TAG_SIZE[name];
            if (name === 'h1') {
              s.bold = true;
              s.underline = true;
            } else if (name === 'h2' || name === 'h4') {
              s.bold = true;
            } else if (name === 'h5') {
              s.italic = true;
            }
          });
        } else close(name);
        break;

      case 'br':
        pushBreak();
        break;

      case 'bq':
        if (!closing) {
          open('bq', (s) => (s.color = NAMED_COLORS.green));
          pushBreak();
        } else {
          close('bq');
          pushBreak();
        }
        break;

      case 'p':
        if (!closing) {
          open('p', (s) => {
            const align = parseAlign(attrs.align);
            if (align) s.align = align;
          });
        } else {
          close('p');
          pushBreak();
        }
        break;

      case 'left':
      case 'center':
      case 'right':
        if (!closing) {
          if (lineHasText) pushBreak();
          open(name, (s) => (s.align = name));
        } else {
          close(name);
          pushBreak();
        }
        break;

      case 'div':
        if (!closing) {
          if (lineHasText) pushBreak();
          open('div', (s) => {
            const align = parseAlign(attrs.align);
            if (align) s.align = align;
          });
        } else {
          close('div');
          pushBreak();
        }
        break;

      case 'a':
        if (!closing) {
          open('a', (s) => {
            const href = attrs.href || attrs.value || '';
            if (href) s.link = href;
            s.underline = true;
            s.color = parseColor(attrs.color) || linkColor;
          });
        } else close('a');
        break;

      case 'color': {
        if (!closing) {
          const color = parseColor(attrs.color || attrs.value);
          if (color) open('color', (s) => (s.color = color));
        } else close('color');
        break;
      }

      case 'font':
        if (!closing) {
          open('font', (s) => {
            const color = parseColor(attrs.color);
            if (color) s.color = color;
            const size = parseSize(attrs.size);
            if (size) s.size = size;
          });
        } else close('font');
        break;

      case 'body':
        if (!closing) {
          flush();
          items.length = 0;
          stack.length = 0;
          lineHasText = false;
          style = cloneStyle(defaults);

          const textColor = parseColor(attrs.text);
          if (textColor) {
            defaults.color = textColor;
            style.color = textColor;
          }
          const bodyLink = parseColor(attrs.link);
          if (bodyLink) linkColor = bodyLink;
          const bgcolor = parseColor(attrs.bgcolor);
          if (bgcolor) background = bgcolor;
        }
        break;

      case 'bodybgcolor': {
        if (!closing) {
          const color = parseColor(attrs.bgcolor || attrs.color || attrs.value);
          if (color) background = color;
          pushBreak();
        }
        break;
      }

      case 'bodytext': {
        if (!closing) {
          const color = parseColor(attrs.text || attrs.color || attrs.value);
          if (color) {
            defaults.color = color;
            style.color = color;
          }
        }
        break;
      }

      case 'basefont':
        if (!closing) {
          const color = parseColor(attrs.color);
          if (color) {
            defaults.color = color;
            style.color = color;
          }
          const size = parseSize(attrs.size);
          if (size) {
            defaults.size = size;
            style.size = size;
          }
        }
        break;
    }
  }

  flush();
  return { items, background };
}

function layoutLines(items, ctx, maxWidth, options) {
  const family = options.fontFamily || 'monospace';
  const defaultSize = options.fontSize || 13;
  const measureCache = new Map();

  const measure = (text, style) => {
    const font = fontFor(style, family);
    const key = `${font}\u0000${text}`;
    const cached = measureCache.get(key);
    if (cached !== undefined) return cached;
    ctx.font = font;
    const width = ctx.measureText(text).width;
    measureCache.set(key, width);
    return width;
  };

  const lines = [];
  let line = [];
  let lineWidth = 0;
  let lastSpace = -1;

  const reset = (cells = []) => {
    line = [];
    lineWidth = 0;
    lastSpace = -1;
    for (const cell of cells) {
      if (cell.char === ' ' && !line.length) continue;
      line.push(cell);
      lineWidth += cell.w;
      if (cell.char === ' ') lastSpace = line.length - 1;
    }
  };

  const finish = () => {
    while (line.length && line[line.length - 1].char === ' ') line.pop();
    if (!line.length) {
      lines.push({ cells: [], width: 0, height: defaultSize + 3, align: options.align || 'left' });
      reset();
      return;
    }

    let width = 0;
    let height = defaultSize + 3;
    for (const cell of line) {
      width += cell.w;
      height = Math.max(height, cell.style.size + 3);
    }
    const first = line.find((cell) => cell.char !== ' ');
    lines.push({ cells: line, width, height, align: first?.style.align || options.align || 'left' });
    reset();
  };

  const add = (char, style) => {
    const w = measure(char, style);
    if (char === ' ' && !line.length) return;

    if (maxWidth > 0 && line.length && lineWidth + w > maxWidth) {
      if (lastSpace >= 0) {
        const carry = line.slice(lastSpace + 1);
        line = line.slice(0, lastSpace);
        finish();
        reset(carry);
      } else {
        finish();
      }
    }

    if (char === ' ' && !line.length) return;
    line.push({ char, style, w });
    lineWidth += w;
    if (char === ' ') lastSpace = line.length - 1;
  };

  for (const item of items) {
    if (item.type === 'break') {
      finish();
      continue;
    }
    for (const char of item.text) {
      if (char === '\n') finish();
      else add(char, item.style);
    }
  }

  if (line.length) finish();
  if (!lines.length) {
    lines.push({ cells: [], width: 0, height: defaultSize + 3, align: options.align || 'left' });
  }
  return lines;
}

export function drawUoHtml(ctx, html, options = {}) {
  const x = options.x || 0;
  const y = options.y || 0;
  const width = options.width || 0;
  const family = options.fontFamily || 'monospace';
  const defaultColor = options.defaultColor || '#010101';
  const align = options.align || 'left';
  const links = options.links || null;
  const scrollY = options.scrollY || 0;
  const height = options.height ?? Infinity;

  const parsed =
    typeof html === 'string'
      ? parseUoHtml(html, {
          color: defaultColor,
          size: options.fontSize || 13,
          align,
          bold: options.bold,
          italic: options.italic,
          underline: options.underline,
          linkColor: options.linkColor,
        })
      : html;
  const lines = layoutLines(parsed.items, ctx, width, {
    fontFamily: family,
    fontSize: options.fontSize || 13,
    align,
  });

  let contentHeight = 0;
  for (const line of lines) contentHeight += line.height;

  const clipped = options.clip !== false && Number.isFinite(height);
  if (clipped) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, width, height);
    ctx.clip();
  }

  let lineY = y - scrollY;
  for (const line of lines) {
    if (lineY >= y + height) break;
    let cx = x;
    if (line.align === 'center') cx = x + Math.max(0, (width - line.width) / 2);
    else if (line.align === 'right') cx = x + Math.max(0, width - line.width);

    let run = null;
    let runX = cx;
    let runWidth = 0;

    const flushRun = () => {
      if (!run) return;
      ctx.font = fontFor(run.style, family);
      ctx.fillStyle = run.style.color || defaultColor;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(run.text, runX, lineY);

      if (run.style.underline) {
        const underlineY = lineY + run.style.size + 1;
        ctx.fillRect(runX, underlineY, runWidth, Math.max(1, Math.round(run.style.size / 14)));
      }
      if (run.style.link && links) {
        links.push({ url: run.style.link, x: runX, y: lineY, w: runWidth, h: line.height });
      }

      runX += runWidth;
      run = null;
      runWidth = 0;
    };

    for (const cell of line.cells) {
      if (!run || !sameStyle(run.style, cell.style)) {
        flushRun();
        run = { text: '', style: cell.style };
      }
      run.text += cell.char;
      runWidth += cell.w;
    }
    flushRun();

    lineY += line.height;
  }

  if (clipped) ctx.restore();
  return { height: contentHeight, links };
}

export function measureUoHtml(ctx, html, options = {}) {
  const family = options.fontFamily || 'monospace';
  const align = options.align || 'left';
  const defaultColor = options.defaultColor || '#010101';
  const parsed =
    typeof html === 'string'
      ? parseUoHtml(html, {
          color: defaultColor,
          size: options.fontSize || 13,
          align,
          bold: options.bold,
          italic: options.italic,
          underline: options.underline,
          linkColor: options.linkColor,
        })
      : html;
  const lines = layoutLines(parsed.items, ctx, options.width || 0, {
    fontFamily: family,
    fontSize: options.fontSize || 13,
    align,
  });
  let height = 0;
  for (const line of lines) height += line.height;
  return { height, lineCount: lines.length, lines };
}

export function drawServerText(ctx, text, options = {}) {
  if (!hasUoHtmlMarkup(text)) return null;
  return drawUoHtml(ctx, text, options);
}

export function appendServerText(element, text, options = {}) {
  if (rawTextEnabled) {
    element.append(String(text ?? ''));
    return true;
  }
  element.append(uoHtmlFragment(text, options));
  return true;
}

export function uoHtmlFragment(html, options = {}) {
  if (rawTextEnabled) {
    const fragment = document.createDocumentFragment();
    const line = document.createElement('div');
    line.style.whiteSpace = 'pre-wrap';
    line.textContent = String(html ?? '');
    fragment.appendChild(line);
    return fragment;
  }
  const parsed = parseUoHtml(html, {
    color: options.defaultColor || null,
    size: options.fontSize || 13,
    align: options.align || 'left',
    linkColor: options.linkColor,
  });

  const fragment = document.createDocumentFragment();
  let line = null;

  const finishLine = () => {
    if (!line) return;
    fragment.appendChild(line);
    line = null;
  };

  for (const item of parsed.items) {
    if (item.type === 'break') {
      if (line) finishLine();
      else fragment.appendChild(document.createElement('br'));
      continue;
    }

    if (!line) {
      line = document.createElement('div');
      line.style.whiteSpace = 'pre-wrap';
      line.style.textAlign = item.style.align || 'left';
    }

    const span = document.createElement('span');
    span.textContent = item.text;
    if (item.style.color) span.style.color = item.style.color;
    if (item.style.bold) span.style.fontWeight = 'bold';
    if (item.style.italic) span.style.fontStyle = 'italic';
    if (item.style.underline) span.style.textDecoration = 'underline';
    if (item.style.link) {
      span.dataset.href = item.style.link;
      span.style.cursor = 'pointer';
    }
    line.appendChild(span);
  }

  finishLine();
  return fragment;
}
