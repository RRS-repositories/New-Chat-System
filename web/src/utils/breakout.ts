/** Breakout groups: who is in which room (pure). */
export type BreakoutGroup = { id: string; name: string; member_ids: number[] };
export type Breakout = { active: boolean; groups: BreakoutGroup[] };

export const NO_BREAKOUT: Breakout = { active: false, groups: [] };
export const MAX_GROUPS = 6;

export const groupOf = (breakout: Breakout, userId: number): BreakoutGroup | null =>
  breakout.groups.find((g) => g.member_ids.includes(userId)) ?? null;

/**
 * The people `userId` can hear and be heard by, out of everyone in the call. Null when the groups
 * are not open: everyone is in one room. Someone in no group is in the main room, with the host.
 */
export function roomOf(breakout: Breakout, userId: number, everyone: number[]): number[] | null {
  if (!breakout.active) return null;
  const mine = groupOf(breakout, userId);
  if (mine) return everyone.filter((id) => mine.member_ids.includes(id));
  return everyone.filter((id) => !groupOf(breakout, id));
}

/** The arrangement with one person moved to a group, or to the main room (`groupId` null). */
export function movePerson(groups: BreakoutGroup[], userId: number, groupId: string | null): BreakoutGroup[] {
  return groups.map((g) => {
    const without = g.member_ids.filter((id) => id !== userId);
    return { ...g, member_ids: g.id === groupId ? [...without, userId] : without };
  });
}

/** With one more empty group, named "Group N". Unchanged at the limit. */
export function addGroup(groups: BreakoutGroup[], newId: string): BreakoutGroup[] {
  if (groups.length >= MAX_GROUPS) return groups;
  let n = groups.length + 1;
  while (groups.some((g) => g.name === `Group ${n}`)) n++;
  return [...groups, { id: newId, name: `Group ${n}`, member_ids: [] }];
}

export const removeGroup = (groups: BreakoutGroup[], groupId: string): BreakoutGroup[] =>
  groups.filter((g) => g.id !== groupId);

export const renameGroup = (groups: BreakoutGroup[], groupId: string, name: string): BreakoutGroup[] =>
  groups.map((g) => (g.id === groupId ? { ...g, name } : g));

/** "Group 1: Ann, Bob · Group 2: Cy" for the banner. Groups with nobody in them are left out. */
export function describeGroups(groups: BreakoutGroup[], firstName: (userId: number) => string): string {
  return groups
    .filter((g) => g.member_ids.length)
    .map((g) => `${g.name}: ${g.member_ids.map(firstName).join(', ')}`)
    .join(' · ');
}
