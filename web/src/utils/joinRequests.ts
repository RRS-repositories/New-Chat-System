import type { JoinRequest } from '../types/index.ts';

/** The host's list of people waiting to be let back into the call. Pure helpers. */

/** Adds a waiting person, or refreshes their name if they are already listed. */
export function addJoinRequest(list: JoinRequest[], request: JoinRequest): JoinRequest[] {
  const at = list.findIndex((r) => r.userId === request.userId);
  if (at === -1) return [...list, request];
  return list.map((r, i) => (i === at ? request : r));
}

/** Removes a waiting person. Returns the same list when they were not in it. */
export function dropJoinRequest(list: JoinRequest[], userId: number): JoinRequest[] {
  return list.some((r) => r.userId === userId) ? list.filter((r) => r.userId !== userId) : list;
}
