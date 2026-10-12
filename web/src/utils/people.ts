/** Does a person match what was typed in a people box: part of the name or of the email, case-insensitive. */
export function personMatches(person: { fullName: string; email?: string | null }, typed: string): boolean {
  const q = typed.trim().toLowerCase();
  if (!q) return true;
  return person.fullName.toLowerCase().includes(q) || (person.email || '').toLowerCase().includes(q);
}

/** The second line under a name in a people list: the role, and the email when there is one. */
export function personLine(person: { role: string; email?: string | null }): string {
  return person.email ? `${person.role} · ${person.email}` : person.role;
}
