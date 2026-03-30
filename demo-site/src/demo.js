import { createPinchType, createScrollMorph, createPinchMorph, createPinchLens, pinchZoom } from '../../src/index.ts';

const TEXT = `Build Places, Not Products

I'll start where it started: Gmail, midnight, me looking up from the fluorescent screen to the sky outside my window—dark but open, a few thin clouds drifting past the treetops, the kind of depth that reminds you there's air beyond the glass. By contrast, the inbox on my screen looked like a lab: white tiles, hard light, rows of cells, sterile and devoid of life.

For Cora, the AI-enabled email assistant we're building at Every, we wanted more of what was outside my window and less of what was glowing on my screen: Outside air, inside the app. I took the idea to Midjourney: skies, oil-paint textures, soft depth—the kind of details that add up to a place where you want to spend time.

The first images we generated looked perfect in Figma: highly detailed oil-paintings, impressionist brushwork, all in 4k image quality. In production, it fell apart. The more emails the user had, though, the bigger their Cora Brief became, and the more the background stretched and pixelated. We needed 8k, sometimes 10k-pixel resolution just to maintain the painting's integrity. Each image iteration grew heavier and heavier. We were generating images with heights over 18k pixels. Pages would've taken eons to load.

From an engineering perspective, it made no sense. You don't use a massive image for a background when you can't predict page height, because if everyone is getting a different view of the image, you can't guarantee a coherent experience. Our approach violated other "best practices" of product design, too: You don't add texture when flat colors load instantly. You don't choose paintings over flat backdrops when you're building software that needs to work on every connection speed.

But we weren't just building software. We were building a place.

We talk about online places as spaces—Slack channels are "rooms," Twitter a "public square"—but we don't really think of them that way, and we even less design them that way. Even the apps we don't label as spaces, like Gmail, are sometimes rooms we inhabit for hours of our day. Most of them feel like conference rooms under fluorescent lights. Functional? Yes. Somewhere you want to be? No.

We solved the engineering for our painted-sky backgrounds. More importantly, we discovered something: Art direction is product architecture. It makes trade-offs clearer, keeps the experience coherent, and gives people a reason to choose your product in a world where AI can generate the median in seconds.

The gravity of sameness

Open any design gallery—Dribbble, Behance, wherever designers show their best—and squint. Dashboards blur: rounded corners, neutral grays, tidy rows of cards. Landing pages collapse into one rhythm: hero text left, image right, three features below. We got so good at a certain kind of design, and that kind of design is so effective, that the outcome looks nearly identical across the web.

With good reason: Style guides gave teams shared rules to follow. Design systems turned those rules into reusable patterns. Utility frameworks like Tailwind made those patterns shippable in code. Each step improved access and reliability, but it also narrowed the expressive range. When teams reach for the same components, apply the same spacing scale, and follow the same accessibility guidelines (as we should), differentiation becomes a deliberate fight against defaults.

Now add AI. Ask a model to "design a SaaS dashboard" and it returns the statistical median: sidebar navigation, metric cards, data table. Competent, functional, and forgettable. As AI-built interfaces become tomorrow's training data, the effect compounds. The median tightens. The web accelerates toward a single, hyper-optimized, bloodless template.

When sameness costs nothing, difference carries the value.

Ship the atmosphere

Software is content now. AI can generate a competent interface in seconds. Components are commodified. Patterns are free. The defensible position is to care about what machines can't: how a place feels. But making it "pretty" isn't enough. You have to articulate texture—oil-painted, soft depth, breathing motion—and turn that into rules. The tools are changing, but the need for atmosphere isn't. It's more important, now, than ever.

Every surface someone touches should feel like somewhere they chose to be. Every room should carry its own quality of light. Every interaction should remind them that humans made this, for humans.

The internet doesn't have to look like an office park. We can add texture. We can create depth. We can build places worth being. Make the internet beautiful. That's the guiding principle. Everything else follows.`;

const DESCRIPTIONS = {
  pinch: 'Uniform text rendering. Pinch with two fingers to scale all text up or down. No fisheye effect.',
  morph: 'Text near the center is large and bright. Text at the edges shrinks and fades. A fisheye magnifying effect as you scroll.',
  combined: 'Both effects together — the fisheye scroll morph plus pinch-to-zoom text scaling.',
  lightweight: 'DOM-based pinch-to-zoom on regular HTML text. No canvas — just font-size changes. ~1KB, zero dependencies.',
};

let currentInstance = null;
let currentMode = 'pinch';
let lightweightCleanup = null;

const creators = {
  pinch: (el) => createPinchType(el, { fontSize: 18 }),
  morph: (el) => createScrollMorph(el, { centerFontSize: 26, edgeFontSize: 11 }),
  combined: (el) => createPinchMorph(el, { centerFontSize: 26, edgeFontSize: 11 }),
};

function formatTextAsHTML(text) {
  return text.split('\n\n').map(p => {
    const trimmed = p.trim();
    if (!trimmed) return '';
    // First paragraph or short ones = headings
    if (trimmed.length < 60 && !trimmed.includes('.')) {
      return `<h3 style="font-size:1.4em;margin:1.5em 0 0.5em;font-family:'Instrument Serif',Georgia,serif;font-weight:400">${trimmed}</h3>`;
    }
    return `<p style="margin:0 0 1em">${trimmed}</p>`;
  }).join('\n');
}

function switchMode(mode) {
  if (currentInstance) { currentInstance.destroy(); currentInstance = null; }
  if (lightweightCleanup) { lightweightCleanup(); lightweightCleanup = null; }
  currentMode = mode;

  // Update tabs
  document.querySelectorAll('.mode-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.mode === mode);
  });

  // Update description
  document.getElementById('mode-desc').textContent = DESCRIPTIONS[mode];

  const canvasContainer = document.getElementById('demo-canvas');
  const lwContainer = document.getElementById('demo-lightweight');

  if (mode === 'lightweight') {
    canvasContainer.style.display = 'none';
    lwContainer.style.display = 'block';
    lwContainer.innerHTML = formatTextAsHTML(TEXT);
    lightweightCleanup = pinchZoom({
      target: lwContainer,
      min: 12,
      max: 32,
      initial: 16,
      step: 1,
    });
  } else {
    canvasContainer.style.display = 'block';
    lwContainer.style.display = 'none';
    currentInstance = creators[mode](canvasContainer);
    currentInstance.canvas.style.borderRadius = '12px';
    currentInstance.setText(TEXT);
  }
}

// Expose for pretext easter egg
window.__pinchZoom = pinchZoom;

function init() {
  // Setup tab listeners
  document.querySelectorAll('.mode-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      switchMode(tab.dataset.mode);
      if(window.goatcounter) goatcounter.count({path:'mode-'+tab.dataset.mode, event:true});
    });
  });

  // Boot with combined
  switchMode('pinch');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
