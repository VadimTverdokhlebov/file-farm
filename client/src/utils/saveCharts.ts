const SCALE = 4;
const PAD = 5;
const FONT = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

const SVG_CSS = `
.load-chart-outage { fill: #be123c; fill-opacity: 0.1; }
.load-chart-outage-label { fill: #be123c; font-size: 15px; font-weight: 600; font-family: ${FONT}; }
.load-chart-grid { stroke: #e4eaf0; stroke-width: 1; }
.load-chart-ruler { stroke: #8794a3; stroke-width: 1; }
.load-chart-tick { fill: #5c6b7a; font-size: 19.8px; font-family: ${FONT}; }
`;

// PNG of the chart cards only: titles, legends and plots, no range or run buttons.
export async function saveChartGrid(grid: HTMLElement, basename: string): Promise<void> {
  const cards = [...grid.querySelectorAll<HTMLElement>('.load-chart')];
  if (cards.length === 0) {
    throw new Error('No charts to save');
  }

  const gridRect = grid.getBoundingClientRect();
  const width = Math.max(1, Math.ceil(grid.scrollWidth));
  const height = Math.max(1, Math.ceil(grid.scrollHeight));
  const canvas = document.createElement('canvas');
  canvas.width = (width + PAD * 2) * SCALE;
  canvas.height = (height + PAD * 2) * SCALE;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Could not create a canvas');
  }
  ctx.scale(SCALE, SCALE);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width + PAD * 2, height + PAD * 2);

  for (const card of cards) {
    const box = card.getBoundingClientRect();
    const x = box.left - gridRect.left + grid.scrollLeft + PAD;
    const y = box.top - gridRect.top + grid.scrollTop + PAD;
    await drawCard(ctx, card, x, y, box.width, box.height);
  }

  const blob = await canvasToBlob(canvas);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${basename}.png`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

// Server-EMA-10min or Algorithm-AM-PPO-EMA-LR-10min from the chips that are on.
export function chartsFilename(card: HTMLElement, kind: 'Server' | 'Algorithm'): string {
  const parts = [kind, ...activeAlgorithms(card, kind), activeRange(card)].filter(Boolean);
  return parts.join('-');
}

function activeAlgorithms(card: HTMLElement, kind: 'Server' | 'Algorithm'): string[] {
  if (kind === 'Algorithm') {
    return [...card.querySelectorAll<HTMLButtonElement>('.load-algorithm-toggle[aria-pressed="true"]')]
      .map((button) => chipName(button.textContent))
      .filter((name) => name.length > 0);
  }
  const group = card.querySelector('[aria-label="Server chart data"]');
  if (!group) {
    return [];
  }
  const pressed = group.querySelector<HTMLButtonElement>('button[aria-pressed="true"]');
  const name = chipName(pressed?.textContent);
  if (name && name !== 'Now') {
    return [name];
  }
  const running = [...group.querySelectorAll<HTMLButtonElement>('button')]
    .map((button) => button.textContent ?? '')
    .find((text) => /·\s*running/i.test(text));
  const live = chipName(running);
  return live ? [live] : name ? [name] : [];
}

function activeRange(card: HTMLElement): string {
  const pressed = card.querySelector('[aria-label="Chart interval"] button[aria-pressed="true"]');
  return (pressed?.textContent ?? '').replace(/\s+/g, '');
}

function chipName(text: string | null | undefined): string {
  return (text ?? '').replace(/\s*·\s*(running|pending|failed|stopped)\s*$/i, '').trim();
}

export function chartGridIn(card: HTMLElement | null): HTMLElement | null {
  return card?.querySelector<HTMLElement>('.load-charts') ?? null;
}

async function drawCard(
  ctx: CanvasRenderingContext2D,
  card: HTMLElement,
  x: number,
  y: number,
  width: number,
  height: number,
): Promise<void> {
  const cardRect = card.getBoundingClientRect();
  roundRect(ctx, x, y, width, height, 12);
  ctx.fillStyle = '#f8fafc';
  ctx.fill();
  ctx.strokeStyle = '#e4eaf0';
  ctx.lineWidth = 1;
  ctx.stroke();

  const title = card.querySelector('h3');
  if (title) {
    const box = title.getBoundingClientRect();
    ctx.fillStyle = '#172033';
    ctx.font = `600 21px ${FONT}`;
    ctx.textBaseline = 'top';
    ctx.fillText(title.textContent?.trim() ?? '', x + (box.left - cardRect.left), y + (box.top - cardRect.top));
  }

  for (const item of card.querySelectorAll<HTMLElement>('.load-legend > span')) {
    const box = item.getBoundingClientRect();
    const swatch = item.querySelector('i');
    let textX = x + (box.left - cardRect.left);
    if (swatch) {
      const swatchBox = swatch.getBoundingClientRect();
      ctx.fillStyle = getComputedStyle(swatch).backgroundColor;
      roundRect(
        ctx,
        x + (swatchBox.left - cardRect.left),
        y + (swatchBox.top - cardRect.top),
        swatchBox.width,
        swatchBox.height,
        2,
      );
      ctx.fill();
      textX = x + (swatchBox.right - cardRect.left) + 6;
    }
    ctx.fillStyle = '#5c6b7a';
    ctx.font = `400 18px ${FONT}`;
    ctx.textBaseline = 'middle';
    ctx.fillText(
      item.textContent?.trim() ?? '',
      textX,
      y + (box.top - cardRect.top) + box.height / 2,
    );
  }

  const svg = card.querySelector('svg');
  if (!svg) {
    return;
  }
  const box = svg.getBoundingClientRect();
  const image = await svgToImage(svg, box.width, box.height);
  ctx.drawImage(
    image,
    x + (box.left - cardRect.left),
    y + (box.top - cardRect.top),
    box.width,
    box.height,
  );
}

function svgToImage(svg: SVGSVGElement, cssWidth: number, cssHeight: number): Promise<HTMLImageElement> {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(cssWidth * SCALE));
  clone.setAttribute('height', String(cssHeight * SCALE));
  const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
  style.textContent = SVG_CSS;
  clone.insertBefore(style, clone.firstChild);
  const xml = new XMLSerializer().serializeToString(clone);
  const blob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to render a chart'));
    };
    image.src = url;
  });
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, width, height, radius);
    return;
  }
  ctx.rect(x, y, width, height);
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error('Failed to encode the image'));
      }
    }, 'image/png');
  });
}
