/**
 * pinch-type
 *
 * Three canvas-based text effects for mobile web:
 * - **Pinch Type** — pinch-to-zoom scales text size uniformly
 * - **Scroll Morph** — fisheye effect: center text is large/bright, edges small/dim
 * - **Combined** — both effects together
 *
 * @license MIT
 * @author Lucas Crespo
 */

import { prepareWithSegments, layoutWithLines } from '@chenglou/pretext';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PinchTypeOptions {
  /** Base font size. Default: `18` */
  fontSize?: number;
  /** Smallest font size reachable via pinch. Default: `8` */
  minFontSize?: number;
  /** Largest font size reachable via pinch. Default: `60` */
  maxFontSize?: number;
  /** CSS font-family string. Default: `"Inter", system-ui, sans-serif` */
  fontFamily?: string;
  /** Line-height ratio relative to font size. Default: `1.57` */
  lineHeight?: number;
  /** Content padding in CSS pixels. Default: `28` */
  padding?: number;
  /** Background color. Default: `#0a0a0a` */
  background?: string;
  /** Scroll friction (0–1). Higher = more momentum. Default: `0.95` */
  friction?: number;
  /** Called after every pinch-zoom with the new font size. */
  onZoom?: (fontSize: number) => void;
}

export interface ScrollMorphOptions {
  /** Font size at the viewport center. Default: `26` */
  centerFontSize?: number;
  /** Font size at viewport edges. Default: `11` */
  edgeFontSize?: number;
  /** Smallest font size. Default: `8` */
  minFontSize?: number;
  /** Largest font size. Default: `60` */
  maxFontSize?: number;
  /** CSS font-family string. Default: `"Inter", system-ui, sans-serif` */
  fontFamily?: string;
  /** Line-height ratio relative to font size. Default: `1.57` */
  lineHeight?: number;
  /** Content padding in CSS pixels. Default: `28` */
  padding?: number;
  /** Background color. Default: `#0a0a0a` */
  background?: string;
  /** Radius (px) of the morph gradient from viewport center. Default: `300` */
  morphRadius?: number;
  /** Scroll friction (0–1). Default: `0.95` */
  friction?: number;
}

export interface PinchMorphOptions {
  /** Font size at the viewport center. Default: `26` */
  centerFontSize?: number;
  /** Font size at viewport edges. Default: `11` */
  edgeFontSize?: number;
  /** Smallest font size reachable via pinch. Default: `8` */
  minFontSize?: number;
  /** Largest font size reachable via pinch. Default: `60` */
  maxFontSize?: number;
  /** CSS font-family string. Default: `"Inter", system-ui, sans-serif` */
  fontFamily?: string;
  /** Line-height ratio relative to font size. Default: `1.57` */
  lineHeight?: number;
  /** Content padding in CSS pixels. Default: `28` */
  padding?: number;
  /** Background color. Default: `#0a0a0a` */
  background?: string;
  /** Radius (px) of the morph gradient from viewport center. Default: `300` */
  morphRadius?: number;
  /** Scroll friction (0–1). Default: `0.95` */
  friction?: number;
  /** Called after every pinch-zoom with the new center and edge sizes. */
  onZoom?: (centerSize: number, edgeSize: number) => void;
}

export interface EffectInstance {
  /** Update the displayed text and re-layout. */
  setText(text: string): void;
  /** Force a resize / re-layout (called automatically on window resize). */
  resize(): void;
  /** Remove all listeners and the canvas element. */
  destroy(): void;
  /** The canvas element created by the effect. */
  readonly canvas: HTMLCanvasElement;
}

// ─── Internals ───────────────────────────────────────────────────────────────

interface Line {
  text: string;
  y: number;
  baseSize: number;
  weight: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function createCanvas(container: HTMLElement) {
  const canvas = document.createElement('canvas');
  canvas.style.display = 'block';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.touchAction = 'none';
  container.appendChild(canvas);
  return canvas;
}

// ─── Pinch Type ──────────────────────────────────────────────────────────────

/**
 * Pinch-to-zoom text scaling. Text renders at a uniform size;
 * pinch gestures scale all text up or down.
 */
export function createPinchType(
  container: HTMLElement,
  options: PinchTypeOptions = {},
): EffectInstance {
  const minFont = options.minFontSize ?? 8;
  const maxFont = options.maxFontSize ?? 60;
  const fontFamily = options.fontFamily ?? '"Inter", system-ui, -apple-system, sans-serif';
  const lhRatio = options.lineHeight ?? 1.57;
  const padding = options.padding ?? 28;
  const bg = options.background ?? '#0a0a0a';
  const friction = options.friction ?? 0.95;
  const onZoom = options.onZoom;

  let fontSize = options.fontSize ?? 18;

  const canvas = createCanvas(container);
  const ctx = canvas.getContext('2d')!;
  let dpr = Math.min(devicePixelRatio || 1, 3);
  let W = 0, H = 0;
  let rawText = '';
  let lines: Line[] = [];
  let totalHeight = 0, maxScroll = 0;
  let scrollY = 0, scrollVelocity = 0;
  let touchLastY = 0, touchLastTime = 0, isTouching = false;
  let pinchActive = false, pinchStartDist = 0, pinchStartSize = 0;
  let raf = 0, destroyed = false;

  function layout() {
    if (!rawText || W === 0) return;
    const maxW = W - padding * 2;
    const lh = fontSize * lhRatio;
    const font = `400 ${fontSize}px ${fontFamily}`;
    const paragraphs = rawText.split('\n\n');
    lines = [];
    let curY = padding + 10;
    for (const para of paragraphs) {
      const trimmed = para.trim();
      if (!trimmed) continue;
      ctx.font = font;
      const prepared = prepareWithSegments(trimmed, font);
      const result = layoutWithLines(prepared, maxW, lh);
      for (let li = 0; li < result.lines.length; li++) {
        lines.push({ text: result.lines[li].text, y: curY + li * lh, baseSize: fontSize, weight: 400 });
      }
      curY += result.lines.length * lh + lh * 0.6;
    }
    totalHeight = curY + padding;
    maxScroll = Math.max(0, totalHeight - H);
    scrollY = clamp(scrollY, 0, maxScroll);
  }

  function render() {
    const d = dpr;
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W * d, H * d);
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#e5e5e5';
    ctx.font = `400 ${fontSize * d}px ${fontFamily}`;
    for (const line of lines) {
      const screenY = line.y - scrollY;
      if (screenY < -100 || screenY > H + 100) continue;
      ctx.fillText(line.text, padding * d, screenY * d);
    }
  }

  function loop() {
    if (destroyed) return;
    if (!isTouching) {
      scrollY += scrollVelocity;
      scrollVelocity *= friction;
      if (scrollY < 0) { scrollY *= 0.85; scrollVelocity *= 0.5; }
      else if (scrollY > maxScroll) { scrollY = maxScroll + (scrollY - maxScroll) * 0.85; scrollVelocity *= 0.5; }
      if (Math.abs(scrollVelocity) < 0.1) scrollVelocity = 0;
    }
    render();
    raf = requestAnimationFrame(loop);
  }

  function pinchDist(e: TouchEvent) {
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    return Math.hypot(dx, dy);
  }

  function onTouchStart(e: TouchEvent) {
    if (e.touches.length === 2) {
      pinchActive = true; pinchStartDist = pinchDist(e); pinchStartSize = fontSize;
      scrollVelocity = 0; isTouching = false;
    } else if (e.touches.length === 1 && !pinchActive) {
      isTouching = true; scrollVelocity = 0;
      touchLastY = e.touches[0].clientY; touchLastTime = performance.now();
    }
    e.preventDefault();
  }

  function onTouchMove(e: TouchEvent) {
    if (pinchActive && e.touches.length === 2) {
      const scale = pinchDist(e) / pinchStartDist;
      const newSize = clamp(Math.round(pinchStartSize * scale), minFont, maxFont);
      if (newSize !== fontSize) { fontSize = newSize; layout(); onZoom?.(fontSize); }
      e.preventDefault(); return;
    }
    if (!isTouching || e.touches.length !== 1) return;
    const y = e.touches[0].clientY;
    const dy = touchLastY - y;
    const now = performance.now();
    const dt = now - touchLastTime;
    scrollY += dy; scrollY = clamp(scrollY, -50, maxScroll + 50);
    if (dt > 0) scrollVelocity = (dy / dt) * 16;
    touchLastY = y; touchLastTime = now; e.preventDefault();
  }

  function onTouchEnd(e: TouchEvent) {
    if (e.touches.length < 2) pinchActive = false;
    if (e.touches.length === 0) isTouching = false;
  }

  function onWheel(e: WheelEvent) {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      // Trackpad pinch-to-zoom
      const delta = e.deltaY > 0 ? -1 : 1;
      const newSize = clamp(fontSize + delta, minFont, maxFont);
      if (newSize !== fontSize) { fontSize = newSize; layout(); onZoom?.(fontSize); }
    } else {
      scrollY += e.deltaY; scrollY = clamp(scrollY, -50, maxScroll + 50);
    }
  }

  function handleResize() {
    dpr = Math.min(devicePixelRatio || 1, 3);
    W = container.clientWidth; H = container.clientHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    layout();
  }

  canvas.addEventListener('touchstart', onTouchStart, { passive: false });
  canvas.addEventListener('touchmove', onTouchMove, { passive: false });
  canvas.addEventListener('touchend', onTouchEnd);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('resize', handleResize);
  handleResize();
  raf = requestAnimationFrame(loop);

  return {
    setText(text: string) { rawText = text; scrollY = 0; scrollVelocity = 0; layout(); },
    resize: handleResize,
    destroy() {
      destroyed = true; cancelAnimationFrame(raf);
      canvas.removeEventListener('touchstart', onTouchStart);
      canvas.removeEventListener('touchmove', onTouchMove);
      canvas.removeEventListener('touchend', onTouchEnd);
      canvas.removeEventListener('wheel', onWheel);
      window.removeEventListener('resize', handleResize);
      canvas.remove();
    },
    get canvas() { return canvas; },
  };
}

// ─── Scroll Morph ────────────────────────────────────────────────────────────

/**
 * Fisheye scroll effect. Text near the viewport center is large and bright;
 * text at the edges is small and dim. No pinch-to-zoom.
 */
export function createScrollMorph(
  container: HTMLElement,
  options: ScrollMorphOptions = {},
): EffectInstance {
  const fontFamily = options.fontFamily ?? '"Inter", system-ui, -apple-system, sans-serif';
  const lhRatio = options.lineHeight ?? 1.57;
  const padding = options.padding ?? 28;
  const bg = options.background ?? '#0a0a0a';
  const morphRadius = options.morphRadius ?? 300;
  const friction = options.friction ?? 0.95;
  const centerSize = options.centerFontSize ?? 26;
  const edgeSize = options.edgeFontSize ?? 11;

  const canvas = createCanvas(container);
  const ctx = canvas.getContext('2d')!;
  let dpr = Math.min(devicePixelRatio || 1, 3);
  let W = 0, H = 0;
  let rawText = '';
  let lines: Line[] = [];
  let totalHeight = 0, maxScroll = 0;
  let scrollY = 0, scrollVelocity = 0;
  let touchLastY = 0, touchLastTime = 0, isTouching = false;
  let raf = 0, destroyed = false;

  function layout() {
    if (!rawText || W === 0) return;
    const maxW = W - padding * 2;
    const fs = centerSize;
    const lh = fs * lhRatio;
    const font = `400 ${fs}px ${fontFamily}`;
    const paragraphs = rawText.split('\n\n');
    lines = [];
    let curY = padding + 10;
    for (const para of paragraphs) {
      const trimmed = para.trim();
      if (!trimmed) continue;
      ctx.font = font;
      const prepared = prepareWithSegments(trimmed, font);
      const result = layoutWithLines(prepared, maxW, lh);
      for (let li = 0; li < result.lines.length; li++) {
        lines.push({ text: result.lines[li].text, y: curY + li * lh, baseSize: fs, weight: 400 });
      }
      curY += result.lines.length * lh + lh * 0.6;
    }
    totalHeight = curY + padding;
    maxScroll = Math.max(0, totalHeight - H);
    scrollY = clamp(scrollY, 0, maxScroll);
  }

  function render() {
    const d = dpr;
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W * d, H * d);
    const viewCenter = H / 2;
    ctx.textBaseline = 'top';
    for (const line of lines) {
      const screenY = line.y - scrollY;
      if (screenY < -100 || screenY > H + 100) continue;
      const dist = Math.abs(screenY - viewCenter);
      const t = Math.min(dist / morphRadius, 1);
      const ease = 1 - (1 - t) ** 3;
      const fontSize = centerSize + (edgeSize - centerSize) * ease;
      const opacity = 1.0 + (0.25 - 1.0) * ease;
      const c = Math.round(255 - (255 - 102) * ease);
      ctx.save();
      ctx.globalAlpha = opacity;
      ctx.fillStyle = `rgb(${c},${c},${c})`;
      ctx.font = `${line.weight} ${fontSize * d}px ${fontFamily}`;
      const yOffset = (fontSize - line.baseSize) * 0.5;
      ctx.fillText(line.text, padding * d, (screenY - yOffset) * d);
      ctx.restore();
    }
  }

  function loop() {
    if (destroyed) return;
    if (!isTouching) {
      scrollY += scrollVelocity; scrollVelocity *= friction;
      if (scrollY < 0) { scrollY *= 0.85; scrollVelocity *= 0.5; }
      else if (scrollY > maxScroll) { scrollY = maxScroll + (scrollY - maxScroll) * 0.85; scrollVelocity *= 0.5; }
      if (Math.abs(scrollVelocity) < 0.1) scrollVelocity = 0;
    }
    render();
    raf = requestAnimationFrame(loop);
  }

  function onTouchStart(e: TouchEvent) {
    if (e.touches.length === 1) {
      isTouching = true; scrollVelocity = 0;
      touchLastY = e.touches[0].clientY; touchLastTime = performance.now();
    }
    e.preventDefault();
  }

  function onTouchMove(e: TouchEvent) {
    if (!isTouching || e.touches.length !== 1) return;
    const y = e.touches[0].clientY;
    const dy = touchLastY - y;
    const now = performance.now();
    const dt = now - touchLastTime;
    scrollY += dy; scrollY = clamp(scrollY, -50, maxScroll + 50);
    if (dt > 0) scrollVelocity = (dy / dt) * 16;
    touchLastY = y; touchLastTime = now; e.preventDefault();
  }

  function onTouchEnd(e: TouchEvent) {
    if (e.touches.length === 0) isTouching = false;
  }

  function onWheel(e: WheelEvent) {
    scrollY += e.deltaY; scrollY = clamp(scrollY, -50, maxScroll + 50); e.preventDefault();
  }

  function handleResize() {
    dpr = Math.min(devicePixelRatio || 1, 3);
    W = container.clientWidth; H = container.clientHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    layout();
  }

  canvas.addEventListener('touchstart', onTouchStart, { passive: false });
  canvas.addEventListener('touchmove', onTouchMove, { passive: false });
  canvas.addEventListener('touchend', onTouchEnd);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('resize', handleResize);
  handleResize();
  raf = requestAnimationFrame(loop);

  return {
    setText(text: string) { rawText = text; scrollY = 0; scrollVelocity = 0; layout(); },
    resize: handleResize,
    destroy() {
      destroyed = true; cancelAnimationFrame(raf);
      canvas.removeEventListener('touchstart', onTouchStart);
      canvas.removeEventListener('touchmove', onTouchMove);
      canvas.removeEventListener('touchend', onTouchEnd);
      canvas.removeEventListener('wheel', onWheel);
      window.removeEventListener('resize', handleResize);
      canvas.remove();
    },
    get canvas() { return canvas; },
  };
}

// ─── Pinch Morph (Combined) ─────────────────────────────────────────────────

/**
 * Combined: scroll-morph fisheye effect + pinch-to-zoom text scaling.
 * This is the original pinch-type behavior.
 */
export function createPinchMorph(
  container: HTMLElement,
  options: PinchMorphOptions = {},
): EffectInstance {
  const minFont = options.minFontSize ?? 8;
  const maxFont = options.maxFontSize ?? 60;
  const fontFamily = options.fontFamily ?? '"Inter", system-ui, -apple-system, sans-serif';
  const lhRatio = options.lineHeight ?? 1.57;
  const padding = options.padding ?? 28;
  const bg = options.background ?? '#0a0a0a';
  const morphRadius = options.morphRadius ?? 300;
  const friction = options.friction ?? 0.95;
  const onZoom = options.onZoom;

  let centerSize = options.centerFontSize ?? 26;
  let edgeSize = options.edgeFontSize ?? 11;
  const initialRatio = edgeSize / centerSize;

  const canvas = createCanvas(container);
  const ctx = canvas.getContext('2d')!;
  let dpr = Math.min(devicePixelRatio || 1, 3);
  let W = 0, H = 0;
  let rawText = '';
  let lines: Line[] = [];
  let totalHeight = 0, maxScroll = 0;
  let scrollY = 0, scrollVelocity = 0;
  let touchLastY = 0, touchLastTime = 0, isTouching = false;
  let pinchActive = false, pinchStartDist = 0, pinchStartCenter = 0, pinchStartEdge = 0;
  let raf = 0, destroyed = false;

  function layout() {
    if (!rawText || W === 0) return;
    const maxW = W - padding * 2;
    const fs = centerSize;
    const lh = fs * lhRatio;
    const font = `400 ${fs}px ${fontFamily}`;
    const paragraphs = rawText.split('\n\n');
    lines = [];
    let curY = padding + 10;
    for (const para of paragraphs) {
      const trimmed = para.trim();
      if (!trimmed) continue;
      ctx.font = font;
      const prepared = prepareWithSegments(trimmed, font);
      const result = layoutWithLines(prepared, maxW, lh);
      for (let li = 0; li < result.lines.length; li++) {
        lines.push({ text: result.lines[li].text, y: curY + li * lh, baseSize: fs, weight: 400 });
      }
      curY += result.lines.length * lh + lh * 0.6;
    }
    totalHeight = curY + padding;
    maxScroll = Math.max(0, totalHeight - H);
    scrollY = clamp(scrollY, 0, maxScroll);
  }

  function render() {
    const d = dpr;
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W * d, H * d);
    const viewCenter = H / 2;
    ctx.textBaseline = 'top';
    for (const line of lines) {
      const screenY = line.y - scrollY;
      if (screenY < -100 || screenY > H + 100) continue;
      const dist = Math.abs(screenY - viewCenter);
      const t = Math.min(dist / morphRadius, 1);
      const ease = 1 - (1 - t) ** 3;
      const fontSize = centerSize + (edgeSize - centerSize) * ease;
      const opacity = 1.0 + (0.25 - 1.0) * ease;
      const c = Math.round(255 - (255 - 102) * ease);
      ctx.save();
      ctx.globalAlpha = opacity;
      ctx.fillStyle = `rgb(${c},${c},${c})`;
      ctx.font = `${line.weight} ${fontSize * d}px ${fontFamily}`;
      const yOffset = (fontSize - line.baseSize) * 0.5;
      ctx.fillText(line.text, padding * d, (screenY - yOffset) * d);
      ctx.restore();
    }
  }

  function loop() {
    if (destroyed) return;
    if (!isTouching) {
      scrollY += scrollVelocity; scrollVelocity *= friction;
      if (scrollY < 0) { scrollY *= 0.85; scrollVelocity *= 0.5; }
      else if (scrollY > maxScroll) { scrollY = maxScroll + (scrollY - maxScroll) * 0.85; scrollVelocity *= 0.5; }
      if (Math.abs(scrollVelocity) < 0.1) scrollVelocity = 0;
    }
    render();
    raf = requestAnimationFrame(loop);
  }

  function pinchDist(e: TouchEvent) {
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    return Math.hypot(dx, dy);
  }

  function onTouchStart(e: TouchEvent) {
    if (e.touches.length === 2) {
      pinchActive = true; pinchStartDist = pinchDist(e);
      pinchStartCenter = centerSize; pinchStartEdge = edgeSize;
      scrollVelocity = 0; isTouching = false;
    } else if (e.touches.length === 1 && !pinchActive) {
      isTouching = true; scrollVelocity = 0;
      touchLastY = e.touches[0].clientY; touchLastTime = performance.now();
    }
    e.preventDefault();
  }

  function onTouchMove(e: TouchEvent) {
    if (pinchActive && e.touches.length === 2) {
      const scale = pinchDist(e) / pinchStartDist;
      const newCenter = clamp(Math.round(pinchStartCenter * scale), minFont, maxFont);
      const newEdge = clamp(Math.round(pinchStartEdge * scale), Math.max(minFont, 6), Math.round(maxFont * initialRatio));
      if (newCenter !== centerSize || newEdge !== edgeSize) {
        centerSize = newCenter; edgeSize = newEdge; layout(); onZoom?.(centerSize, edgeSize);
      }
      e.preventDefault(); return;
    }
    if (!isTouching || e.touches.length !== 1) return;
    const y = e.touches[0].clientY;
    const dy = touchLastY - y;
    const now = performance.now();
    const dt = now - touchLastTime;
    scrollY += dy; scrollY = clamp(scrollY, -50, maxScroll + 50);
    if (dt > 0) scrollVelocity = (dy / dt) * 16;
    touchLastY = y; touchLastTime = now; e.preventDefault();
  }

  function onTouchEnd(e: TouchEvent) {
    if (e.touches.length < 2) pinchActive = false;
    if (e.touches.length === 0) isTouching = false;
  }

  function onWheel(e: WheelEvent) {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      // Trackpad pinch-to-zoom
      const delta = e.deltaY > 0 ? -1 : 1;
      const newCenter = clamp(centerSize + delta, minFont, maxFont);
      if (newCenter !== centerSize) {
        centerSize = newCenter;
        edgeSize = Math.round(centerSize * initialRatio);
        edgeSize = clamp(edgeSize, 4, centerSize);
        layout();
        onZoom?.(centerSize, edgeSize);
      }
    } else {
      scrollY += e.deltaY; scrollY = clamp(scrollY, -50, maxScroll + 50);
    }
  }

  function handleResize() {
    dpr = Math.min(devicePixelRatio || 1, 3);
    W = container.clientWidth; H = container.clientHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    layout();
  }

  canvas.addEventListener('touchstart', onTouchStart, { passive: false });
  canvas.addEventListener('touchmove', onTouchMove, { passive: false });
  canvas.addEventListener('touchend', onTouchEnd);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('resize', handleResize);
  handleResize();
  raf = requestAnimationFrame(loop);

  return {
    setText(text: string) { rawText = text; scrollY = 0; scrollVelocity = 0; layout(); },
    resize: handleResize,
    destroy() {
      destroyed = true; cancelAnimationFrame(raf);
      canvas.removeEventListener('touchstart', onTouchStart);
      canvas.removeEventListener('touchmove', onTouchMove);
      canvas.removeEventListener('touchend', onTouchEnd);
      canvas.removeEventListener('wheel', onWheel);
      window.removeEventListener('resize', handleResize);
      canvas.remove();
    },
    get canvas() { return canvas; },
  };
}
