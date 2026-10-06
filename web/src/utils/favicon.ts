import type { TabBadge } from './tabTitle.ts';

const BASE = '/icon-192.png';
const SIZE = 64;
let plain: HTMLImageElement | null = null;
let lastKey = '';

/**
 * Draws the unread badge onto the tab icon: a red disc with the number (mentions and direct
 * messages), or a small red dot for other unread channels. Falls back to the plain icon on any failure.
 */
export function setFaviconBadge(badge: TabBadge): void {
  const key = `${badge.count}:${badge.dot}`;
  if (key === lastKey) return;
  lastKey = key;
  const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) return;
  if (!badge.count && !badge.dot) {
    link.href = BASE;
    return;
  }
  const draw = (img: HTMLImageElement) => {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = SIZE;
      canvas.height = SIZE;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, SIZE, SIZE);
      const r = badge.count ? 20 : 11;
      const cx = SIZE - r - 2;
      const cy = r + 2;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = '#e5484d';
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
      if (badge.count) {
        const text = badge.count > 99 ? '99+' : String(badge.count);
        ctx.fillStyle = '#ffffff';
        ctx.font = `bold ${text.length > 2 ? 18 : 24}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, cx, cy + 1);
      }
      link.href = canvas.toDataURL('image/png');
    } catch {
      link.href = BASE;
    }
  };
  if (plain && plain.complete) return draw(plain);
  plain = new Image();
  plain.onload = () => draw(plain!);
  plain.onerror = () => {
    link.href = BASE;
  };
  plain.src = BASE;
}
