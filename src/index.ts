/**
 * pinch-type
 *
 * Four canvas-based text effects for mobile web:
 * - **Pinch Type** — pinch-to-zoom scales text size uniformly
 * - **Scroll Morph** — fisheye effect: center text is large/bright, edges small/dim
 * - **Combined** — both effects together
 * - **Pinch Lens** — fish-eye lens: glyphs near pinch center scale up, others stay normal
 *
 * @license MIT
 * @author Lucas Crespo
 */

export { pinchZoom, usePinchZoom } from './lightweight';
export type { PinchZoomOptions, UsePinchZoomOptions } from './lightweight';

import { prepareWithSegments, layoutWithLines } from '@chenglou/pretext';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PinchLensOptions {
  /** Base font size. Default: `18` */
  fontSize?: number;
  /** Smallest font size (when pinching out shrinks nearby). Default: `8` */
  minFontSize?: number;
  /** Largest font size (when pinching in magnifies nearby). Default: `48` */
  maxFontSize?: number;
  /** CSS font-family string. Default: `"Inter", system-ui, sans-serif` */
  fontFamily?: string;
  /** Line-height ratio relative to font size. Default: `1.57` */
  lineHeight?: number;
  /** Content padding in CSS pixels. Default: `28` */
  padding?: number;
  /** Background color. Default: `#0a0a0a` */
  background?: string;
  /** Radius (px) of the lens effect from pinch center. Default: `200` */
  lensRadius?: number;
  /** Maximum scale multiplier when pinching in. Default: `2.5` */
  maxScale?: number;
  /** Scroll friction (0–1). Default: `0.95` */
  friction?: number;
  /** Called after pinch with the current scale intensity (-1 to 1). */
  onLens?: (intensity: number) => void;
}

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

interface PinchLine extends Line {
  lineHeight: number;
  paragraphIndex: number;
  start: {
    segmentIndex: number;
    graphemeIndex: number;
  };
  end: {
    segmentIndex: number;
    graphemeIndex: number;
  };
}

interface PointerState {
  y: number;
  active: boolean;
}

interface LineAnchor {
  paragraphIndex: number;
  start: {
    segmentIndex: number;
    graphemeIndex: number;
  };
  pointerY: number;
  yRatio: number;
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

function compareCursor(
  a: { segmentIndex: number; graphemeIndex: number },
  b: { segmentIndex: number; graphemeIndex: number },
) {
  if (a.segmentIndex !== b.segmentIndex) {
    return a.segmentIndex - b.segmentIndex;
  }
  return a.graphemeIndex - b.graphemeIndex;
}

function cursorWithinRange(
  cursor: { segmentIndex: number; graphemeIndex: number },
  start: { segmentIndex: number; graphemeIndex: number },
  end: { segmentIndex: number; graphemeIndex: number },
) {
  return compareCursor(start, cursor) <= 0 && compareCursor(cursor, end) < 0;
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
  const pointer: PointerState = { y: 0, active: false };

  let dpr = Math.min(devicePixelRatio || 1, 3);
  let W = 0, H = 0;
  let rawText = '';
  let lines: PinchLine[] = [];
  let totalHeight = 0, maxScroll = 0;
  let scrollY = 0, scrollVelocity = 0;
  let touchLastY = 0, touchLastTime = 0, isTouching = false;
  let pinchActive = false, pinchStartDist = 0, pinchStartSize = 0;
  let wheelZoomTimer = 0;
  let zoomAnchor: LineAnchor | null = null;
  let raf = 0, destroyed = false;

  function layout() {
    if (!rawText || W === 0) return;
    const maxW = W - padding * 2;
    const lh = fontSize * lhRatio;
    const font = `400 ${fontSize}px ${fontFamily}`;
    const paragraphs = rawText.split('\n\n');
    lines = [];
    let curY = padding + 10;
    for (let paragraphIndex = 0; paragraphIndex < paragraphs.length; paragraphIndex++) {
      const trimmed = paragraphs[paragraphIndex]?.trim();
      if (!trimmed) continue;
      ctx.font = font;
      const prepared = prepareWithSegments(trimmed, font);
      const result = layoutWithLines(prepared, maxW, lh);
      for (let li = 0; li < result.lines.length; li++) {
        const line = result.lines[li]!;
        lines.push({
          text: line.text,
          y: curY + li * lh,
          baseSize: fontSize,
          weight: 400,
          lineHeight: lh,
          paragraphIndex,
          start: { ...line.start },
          end: { ...line.end },
        });
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
      if (screenY < -line.lineHeight || screenY > H + line.lineHeight) continue;
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

  function resetZoomAnchor() {
    if (wheelZoomTimer !== 0) {
      clearTimeout(wheelZoomTimer);
      wheelZoomTimer = 0;
    }
    zoomAnchor = null;
  }

  function getLineAtViewportY(viewportY: number) {
    for (const line of lines) {
      const screenY = line.y - scrollY;
      if (viewportY >= screenY && viewportY <= screenY + line.lineHeight) {
        return line;
      }
    }
    return null;
  }

  function createLockedAnchor(viewportY: number) {
    const line = getLineAtViewportY(viewportY);
    if (!line) return null;
    const screenY = line.y - scrollY;
    return {
      paragraphIndex: line.paragraphIndex,
      start: { ...line.start },
      pointerY: viewportY,
      yRatio: line.lineHeight > 0 ? clamp((viewportY - screenY) / line.lineHeight, 0, 1) : 0,
    };
  }

  function createPointerLockedAnchor() {
    if (!pointer.active) return null;
    return createLockedAnchor(pointer.y);
  }

  function findLineForAnchor(anchor: LineAnchor) {
    return lines.find((line) => (
      line.paragraphIndex === anchor.paragraphIndex &&
      cursorWithinRange(anchor.start, line.start, line.end)
    )) ?? null;
  }

  function applyLockedAnchor(anchor: LineAnchor, viewportY = anchor.pointerY) {
    const line = findLineForAnchor(anchor);
    if (!line) return;
    const anchorContentY = line.y + anchor.yRatio * line.lineHeight;
    scrollY = clamp(anchorContentY - viewportY, 0, maxScroll);
  }

  function getTouchMidpointY(e: TouchEvent) {
    const rect = canvas.getBoundingClientRect();
    return ((e.touches[0].clientY + e.touches[1].clientY) / 2) - rect.top;
  }

  function onPointerMove(e: PointerEvent) {
    if (e.pointerType === 'touch') return;
    const rect = canvas.getBoundingClientRect();
    pointer.y = e.clientY - rect.top;
    pointer.active = true;
  }

  function onPointerLeave(e: PointerEvent) {
    if (e.pointerType === 'touch') return;
    pointer.active = false;
  }

  function onTouchStart(e: TouchEvent) {
    if (e.touches.length === 2) {
      pinchActive = true; pinchStartDist = pinchDist(e); pinchStartSize = fontSize;
      scrollVelocity = 0; isTouching = false;
      resetZoomAnchor();
      zoomAnchor = createLockedAnchor(getTouchMidpointY(e));
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
      const midpointY = getTouchMidpointY(e);
      const sizeChanged = newSize !== fontSize;
      if (sizeChanged) { fontSize = newSize; layout(); }
      if (zoomAnchor) applyLockedAnchor(zoomAnchor, midpointY);
      if (sizeChanged) onZoom?.(fontSize);
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
    if (e.touches.length < 2) { pinchActive = false; resetZoomAnchor(); }
    if (e.touches.length === 0) isTouching = false;
  }

  function onWheel(e: WheelEvent) {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      if (wheelZoomTimer === 0) zoomAnchor = createPointerLockedAnchor();
      clearTimeout(wheelZoomTimer);
      wheelZoomTimer = window.setTimeout(() => {
        wheelZoomTimer = 0;
        zoomAnchor = null;
      }, 140);

      const delta = e.deltaY > 0 ? -1 : 1;
      const newSize = clamp(fontSize + delta, minFont, maxFont);
      if (newSize !== fontSize) {
        fontSize = newSize; layout();
        if (zoomAnchor) applyLockedAnchor(zoomAnchor);
        onZoom?.(fontSize);
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
    if (zoomAnchor) applyLockedAnchor(zoomAnchor);
  }

  canvas.addEventListener('pointerenter', onPointerMove);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerleave', onPointerLeave);
  canvas.addEventListener('touchstart', onTouchStart, { passive: false });
  canvas.addEventListener('touchmove', onTouchMove, { passive: false });
  canvas.addEventListener('touchend', onTouchEnd);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('resize', handleResize);
  handleResize();
  raf = requestAnimationFrame(loop);

  return {
    setText(text: string) { rawText = text; scrollY = 0; scrollVelocity = 0; resetZoomAnchor(); layout(); },
    resize: handleResize,
    destroy() {
      destroyed = true; cancelAnimationFrame(raf);
      resetZoomAnchor();
      canvas.removeEventListener('pointerenter', onPointerMove);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerleave', onPointerLeave);
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

// ─── Pinch Lens ──────────────────────────────────────────────────────────────

/**
 * Pinch Lens with full 2D reflow. During a pinch gesture, words near the pinch
 * center enlarge and the ENTIRE text layout reflows around the enlarged area —
 * like a bubble pushing everything aside. Nothing ever leaves the canvas frame;
 * if content grows too large, distant text compresses to keep everything visible.
 */
export function createPinchLens(
  container: HTMLElement,
  options: PinchLensOptions = {},
): EffectInstance {
  const baseFontSize = options.fontSize ?? 18;
  const fontFamily = options.fontFamily ?? '"Inter", system-ui, -apple-system, sans-serif';
  const lhRatio = options.lineHeight ?? 1.57;
  const padding = options.padding ?? 28;
  const bg = options.background ?? '#0a0a0a';
  const lensRadius = options.lensRadius ?? 200;
  const maxScale = options.maxScale ?? 2.5;
  const friction = options.friction ?? 0.95;
  const onLens = options.onLens;

  const canvas = createCanvas(container);
  const ctx = canvas.getContext('2d')!;
  let dpr = Math.min(devicePixelRatio || 1, 3);
  let W = 0, H = 0;
  let rawText = '';

  // A "token" is either a word or a paragraph break marker
  interface WordToken {
    kind: 'word' | 'space' | 'paraBreak';
    text: string;
    baseWidth: number; // measured at baseFontSize
    // animated render state
    renderX: number;
    renderY: number;
    renderScale: number;
  }

  let tokens: WordToken[] = [];
  let scrollY = 0, scrollVelocity = 0;
  let touchLastY = 0, touchLastTime = 0, isTouching = false;
  let pinchActive = false, pinchStartDist = 0;
  let lensIntensity = 0;
  let lensCenterX = 0, lensCenterY = 0;
  let pointerX = 0, pointerY = 0, pointerActive = false;
  let wheelZoomTimer = 0;
  let raf = 0, destroyed = false;

  const baseLh = () => baseFontSize * lhRatio;
  const baseFont = () => `400 ${baseFontSize}px ${fontFamily}`;
  const spaceWidth = () => { ctx.font = baseFont(); return ctx.measureText(' ').width; };

  function falloff(dist: number): number {
    if (dist >= lensRadius) return 0;
    const t = dist / lensRadius;
    return Math.exp(-4.5 * t * t);
  }

  /** Tokenize raw text into words, spaces, and paragraph breaks */
  function tokenize() {
    tokens = [];
    if (!rawText || W === 0) return;
    ctx.font = baseFont();
    const paragraphs = rawText.split('\n\n');
    for (let pi = 0; pi < paragraphs.length; pi++) {
      const trimmed = paragraphs[pi]?.trim();
      if (!trimmed) continue;
      if (pi > 0) tokens.push({ kind: 'paraBreak', text: '', baseWidth: 0, renderX: 0, renderY: 0, renderScale: 1 });
      // Split into words and spaces
      const parts = trimmed.match(/\S+|\s+/g) || [];
      for (const part of parts) {
        const isSpace = part.trim() === '';
        const w = ctx.measureText(part).width;
        tokens.push({
          kind: isSpace ? 'space' : 'word',
          text: part,
          baseWidth: w,
          renderX: 0,
          renderY: 0,
          renderScale: 1,
        });
      }
    }
  }

  /**
   * Reflow all tokens into lines, accounting for per-word scale.
   * Returns total content height. Mutates token renderX/renderY/renderScale.
   *
   * @param scales per-token scale factors (length === tokens.length)
   * @param maxW available width for text
   * @param globalShrink additional uniform shrink applied to keep content in bounds
   */
  function reflowTokens(scales: Float64Array, maxW: number, globalShrink: number): number {
    const lh = baseLh();
    let curX = 0;
    let curY = padding + 10;
    // Track max scale on current line for line height
    let lineMaxScale = 1;

    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      const s = scales[i] * globalShrink;

      if (tok.kind === 'paraBreak') {
        // End current line, add paragraph gap
        curX = 0;
        curY += lh * lineMaxScale + lh * 0.6 * globalShrink;
        lineMaxScale = 1;
        tok.renderX = padding;
        tok.renderY = curY;
        tok.renderScale = s;
        continue;
      }

      const scaledW = tok.baseWidth * s;

      // Line wrap: if this word won't fit and we're not at line start, wrap
      if (tok.kind === 'word' && curX > 0 && curX + scaledW > maxW) {
        curX = 0;
        curY += lh * lineMaxScale;
        lineMaxScale = 1;
      }

      tok.renderX = padding + curX;
      tok.renderY = curY;
      tok.renderScale = s;
      lineMaxScale = Math.max(lineMaxScale, s);

      curX += scaledW;

      // If a space goes past the edge, that's fine — it'll wrap the next word
    }

    return curY + lh * lineMaxScale + padding;
  }

  /**
   * Core reflow: compute scales, reflow, and if content overflows canvas,
   * iteratively shrink distant text to fit.
   */
  function computeLayout(): number {
    if (tokens.length === 0) return 0;
    const maxW = W - padding * 2;
    const lh = baseLh();
    const hasLens = lensIntensity !== 0;

    const scales = new Float64Array(tokens.length);

    if (!hasLens) {
      scales.fill(1);
      return reflowTokens(scales, maxW, 1);
    }

    // Phase 1: compute raw scales based on distance to lens center
    // We need an estimate of positions to compute distances, so we do 2 passes:
    // First pass with scale=1 to get base positions, then compute scales from those,
    // then reflow with real scales.

    // Pass 1: base layout
    scales.fill(1);
    reflowTokens(scales, maxW, 1);

    // Pass 2: compute scales from base positions
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      if (tok.kind === 'paraBreak') { scales[i] = 1; continue; }
      const cx = tok.renderX + tok.baseWidth / 2;
      const cy = tok.renderY + lh / 2 - scrollY;
      const dist = Math.hypot(cx - lensCenterX, cy - lensCenterY);
      const f = falloff(dist);
      const s = 1 + (maxScale - 1) * f * lensIntensity;
      scales[i] = Math.max(0.3, Math.min(maxScale, s));
    }

    // Pass 3: reflow with computed scales
    let totalH = reflowTokens(scales, maxW, 1);

    // Pass 4: if content exceeds canvas, apply global shrink to make it fit
    // We iterate: shrink distant tokens more to compress
    const canvasH = H;
    if (totalH > canvasH && lensIntensity > 0) {
      // Binary search for a globalShrink that fits
      let lo = 0.85, hi = 1.0;
      for (let iter = 0; iter < 8; iter++) {
        const mid = (lo + hi) / 2;
        const testH = reflowTokens(scales, maxW, mid);
        if (testH > canvasH) hi = mid;
        else lo = mid;
      }
      totalH = reflowTokens(scales, maxW, lo);
    }

    // Pass 5: refine scales with actual reflowed positions (improves accuracy)
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      if (tok.kind === 'paraBreak') continue;
      const cx = tok.renderX + tok.baseWidth * tok.renderScale / 2;
      const cy = tok.renderY + lh * tok.renderScale / 2 - scrollY;
      const dist = Math.hypot(cx - lensCenterX, cy - lensCenterY);
      const f = falloff(dist);
      const s = 1 + (maxScale - 1) * f * lensIntensity;
      scales[i] = Math.max(0.3, Math.min(maxScale, s));
    }

    // Final reflow
    totalH = reflowTokens(scales, maxW, totalH > canvasH ? 0.85 : 1);
    if (totalH > canvasH) {
      let lo = 0.85, hi = 1.0;
      for (let iter = 0; iter < 8; iter++) {
        const mid = (lo + hi) / 2;
        if (reflowTokens(scales, maxW, mid) > canvasH) hi = mid;
        else lo = mid;
      }
      totalH = reflowTokens(scales, maxW, lo);
    }

    return totalH;
  }

  // Smooth animation: store previous positions and lerp
  let animTokens: { x: number; y: number; scale: number }[] = [];
  const LERP_SPEED = 0.3;

  function updateAnimation() {
    // Ensure animTokens array matches tokens length
    while (animTokens.length < tokens.length) {
      const tok = tokens[animTokens.length];
      animTokens.push({ x: tok.renderX, y: tok.renderY, scale: tok.renderScale });
    }
    animTokens.length = tokens.length;

    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      const a = animTokens[i];
      a.x += (tok.renderX - a.x) * LERP_SPEED;
      a.y += (tok.renderY - a.y) * LERP_SPEED;
      a.scale += (tok.renderScale - a.scale) * LERP_SPEED;
    }
  }

  let totalHeight = 0, maxScroll = 0;

  function layout() {
    tokenize();
    if (tokens.length === 0) return;
    totalHeight = computeLayout();
    maxScroll = Math.max(0, totalHeight - H);
    scrollY = clamp(scrollY, 0, maxScroll);
    // Initialize animation positions on fresh layout
    animTokens = tokens.map(t => ({ x: t.renderX, y: t.renderY, scale: t.renderScale }));
  }

  function render() {
    const d = dpr;
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W * d, H * d);
    ctx.textBaseline = 'top';

    const lh = baseLh();

    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      if (tok.kind === 'paraBreak' || tok.kind === 'space') continue;

      const a = animTokens[i];
      const s = a.scale;
      const screenY = a.y - scrollY;
      const screenX = a.x;

      // Cull off-screen
      if (screenY < -lh * maxScale || screenY > H + lh * maxScale) continue;
      if (screenX > W + 50) continue;

      const brightness = Math.round(clamp(200 + 55 * (s - 1) / (maxScale - 1), 102, 255));
      const alpha = clamp(0.4 + 0.6 * Math.min(s, 1.5) / 1.5, 0.3, 1.0);

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = `rgb(${brightness},${brightness},${brightness})`;
      ctx.font = `400 ${baseFontSize * d}px ${fontFamily}`;

      // Scale around word center
      const scaledW = tok.baseWidth * s;
      const scaledH = lh * s;
      const cx = (screenX + scaledW / 2) * d;
      const cy = (screenY + scaledH / 2) * d;
      ctx.translate(cx, cy);
      ctx.scale(s, s);
      ctx.translate(-cx, -cy);
      ctx.fillText(tok.text, screenX * d, screenY * d);
      ctx.restore();
    }
  }

  function loop() {
    if (destroyed) return;
    if (!isTouching && !pinchActive) {
      scrollY += scrollVelocity;
      scrollVelocity *= friction;
      if (scrollY < 0) { scrollY *= 0.85; scrollVelocity *= 0.5; }
      else if (scrollY > maxScroll) { scrollY = maxScroll + (scrollY - maxScroll) * 0.85; scrollVelocity *= 0.5; }
      if (Math.abs(scrollVelocity) < 0.1) scrollVelocity = 0;
    }
    if (!pinchActive && wheelZoomTimer === 0 && lensIntensity !== 0) {
      lensIntensity *= 0.85;
      if (Math.abs(lensIntensity) < 0.005) lensIntensity = 0;
    }

    // Recompute layout each frame when lens is active (positions depend on lens center)
    if (lensIntensity !== 0) {
      totalHeight = computeLayout();
      maxScroll = Math.max(0, totalHeight - H);
    }

    updateAnimation();
    render();
    raf = requestAnimationFrame(loop);
  }

  function pinchDistCalc(e: TouchEvent) {
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    return Math.hypot(dx, dy);
  }

  function getTouchMidpoint(e: TouchEvent) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.touches[0].clientX + e.touches[1].clientX) / 2) - rect.left,
      y: ((e.touches[0].clientY + e.touches[1].clientY) / 2) - rect.top,
    };
  }

  function onPointerMove(e: PointerEvent) {
    if (e.pointerType === 'touch') return;
    const rect = canvas.getBoundingClientRect();
    pointerX = e.clientX - rect.left;
    pointerY = e.clientY - rect.top;
    pointerActive = true;
  }

  function onPointerLeave(e: PointerEvent) {
    if (e.pointerType === 'touch') return;
    pointerActive = false;
  }

  function onTouchStart(e: TouchEvent) {
    if (e.touches.length === 2) {
      pinchActive = true;
      pinchStartDist = pinchDistCalc(e);
      scrollVelocity = 0;
      isTouching = false;
      const mid = getTouchMidpoint(e);
      lensCenterX = mid.x;
      lensCenterY = mid.y;
    } else if (e.touches.length === 1 && !pinchActive) {
      isTouching = true;
      scrollVelocity = 0;
      touchLastY = e.touches[0].clientY;
      touchLastTime = performance.now();
    }
    e.preventDefault();
  }

  function onTouchMove(e: TouchEvent) {
    if (pinchActive && e.touches.length === 2) {
      const dist = pinchDistCalc(e);
      const scale = dist / pinchStartDist;
      lensIntensity = clamp(scale - 1, -1, 1);
      const mid = getTouchMidpoint(e);
      lensCenterX = mid.x;
      lensCenterY = mid.y;
      onLens?.(lensIntensity);
      e.preventDefault();
      return;
    }
    if (!isTouching || e.touches.length !== 1) return;
    const y = e.touches[0].clientY;
    const dy = touchLastY - y;
    const now = performance.now();
    const dt = now - touchLastTime;
    scrollY += dy;
    scrollY = clamp(scrollY, -50, maxScroll + 50);
    if (dt > 0) scrollVelocity = (dy / dt) * 16;
    touchLastY = y;
    touchLastTime = now;
    e.preventDefault();
  }

  function onTouchEnd(e: TouchEvent) {
    if (e.touches.length < 2) pinchActive = false;
    if (e.touches.length === 0) isTouching = false;
  }

  function onWheel(e: WheelEvent) {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      if (pointerActive) {
        lensCenterX = pointerX;
        lensCenterY = pointerY;
      } else {
        lensCenterX = W / 2;
        lensCenterY = H / 2;
      }
      const delta = -e.deltaY * 0.01;
      lensIntensity = clamp(lensIntensity + delta, -1, 1);
      onLens?.(lensIntensity);
      clearTimeout(wheelZoomTimer);
      wheelZoomTimer = window.setTimeout(() => { wheelZoomTimer = 0; }, 300);
    } else {
      scrollY += e.deltaY;
      scrollY = clamp(scrollY, -50, maxScroll + 50);
    }
  }

  function handleResize() {
    dpr = Math.min(devicePixelRatio || 1, 3);
    W = container.clientWidth;
    H = container.clientHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    layout();
  }

  canvas.addEventListener('pointerenter', onPointerMove);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerleave', onPointerLeave);
  canvas.addEventListener('touchstart', onTouchStart, { passive: false });
  canvas.addEventListener('touchmove', onTouchMove, { passive: false });
  canvas.addEventListener('touchend', onTouchEnd);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('resize', handleResize);
  handleResize();
  raf = requestAnimationFrame(loop);

  return {
    setText(text: string) {
      rawText = text;
      scrollY = 0;
      scrollVelocity = 0;
      lensIntensity = 0;
      layout();
    },
    resize: handleResize,
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      clearTimeout(wheelZoomTimer);
      canvas.removeEventListener('pointerenter', onPointerMove);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerleave', onPointerLeave);
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
