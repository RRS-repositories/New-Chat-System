/** A steady colour (a hue, 0 to 359) for each person, taken from their name, so their avatar and call tile always match. */
export function hueOf(name: string): number {
  let h = 0;
  for (const ch of name.trim().toLowerCase()) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return h % 360;
}
