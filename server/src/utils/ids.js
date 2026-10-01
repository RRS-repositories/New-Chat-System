/** A positive whole-number id, or null. */
export const toId = (value) => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/** The distinct positive whole-number ids in a list (anything else is dropped). */
export const toIds = (value) => [
  ...new Set((Array.isArray(value) ? value : []).map(Number).filter((n) => Number.isInteger(n) && n > 0)),
];

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
