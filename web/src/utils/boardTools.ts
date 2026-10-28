/**
 * The whiteboard's tools, and the geometry of its shapes and text. Pure: no canvas, no React.
 * The drawing itself is in services/whiteboard.ts; the pixels are put down in WhiteboardView.
 */
export type Point = [number, number];
/** What a stroke is: freehand (pen, highlighter, the eraser is a pen that rubs out), a shape, or text. */
export type StrokeKind = 'pen' | 'highlighter' | 'line' | 'arrow' | 'rect' | 'ellipse' | 'text';
/** What the host has in hand. */
export type Tool = StrokeKind | 'eraser' | 'move';
export const SHAPES = ['line', 'arrow', 'rect', 'ellipse'] as const;
export type ShapeKind = (typeof SHAPES)[number];
export const KINDS: readonly StrokeKind[] = ['pen', 'highlighter', ...SHAPES, 'text'];
export const isShape = (tool: Tool): tool is ShapeKind => (SHAPES as readonly string[]).includes(tool);
export const isFreehand = (tool: Tool): boolean => tool === 'pen' || tool === 'highlighter' || tool === 'eraser';

/** The highlighter is a wide, see-through pen. */
export const HIGHLIGHT_FACTOR = 3;
export const HIGHLIGHT_ALPHA = 0.45;
export const MAX_TEXT = 500;
/** Lines of text are this many times the font size apart. */
export const LINE_HEIGHT = 1.25;

/** The font size of text, in px on a board 1100 px wide, for a pen thickness: 16, 22 or 30. */
export const textSizeOf = (penSize: number): number => Math.round(penSize * 2 + 10);

/** Text as it is kept: trimmed, control characters out, at most MAX_TEXT. Null when nothing is left. */
export function cleanText(text: string): string | null {
  if (typeof text !== 'string') return null;
  const t = text
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '')
    .trim();
  if (!t) return null;
  return t.length > MAX_TEXT ? t.slice(0, MAX_TEXT) : t;
}
export const textLines = (text: string): string[] => text.split('\n');

export type Box = { x: number; y: number; w: number; h: number };
/** The box with corners a and b, whichever way it was dragged. */
export const boxOf = (a: Point, b: Point): Box => ({
  x: Math.min(a[0], b[0]),
  y: Math.min(a[1], b[1]),
  w: Math.abs(b[0] - a[0]),
  h: Math.abs(b[1] - a[1]),
});

/** The two wing points of an arrow head at `to`, `length` long, for a line coming from `from`. */
export function arrowHead(from: Point, to: Point, length: number): [Point, Point] {
  const angle = Math.atan2(to[1] - from[1], to[0] - from[0]);
  const spread = Math.PI / 7;
  const wing = (a: number): Point => [to[0] - length * Math.cos(a), to[1] - length * Math.sin(a)];
  return [wing(angle - spread), wing(angle + spread)];
}

/** The key that picks each tool (a bare press, by the host, while not typing). */
export const TOOL_KEYS: Record<Tool, string> = {
  pen: 'P',
  highlighter: 'H',
  eraser: 'E',
  text: 'T',
  line: 'L',
  arrow: 'A',
  rect: 'R',
  ellipse: 'O',
  move: 'V',
};
export function toolForKey(key: string): Tool | null {
  const k = (key || '').toUpperCase();
  for (const tool of Object.keys(TOOL_KEYS) as Tool[]) if (TOOL_KEYS[tool] === k) return tool;
  return null;
}

/** Whether a key press belongs to a box someone is typing in, which the tool keys must not steal. */
export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  const tag = el.tagName.toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true;
}
