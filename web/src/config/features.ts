/**
 * Parts of the call screen that are switched on as they are finished. A button for a part that is
 * off is still shown in the dock, greyed out, so the layout does not change when it arrives.
 */
export const FEATURES = {
  /** Ring more people into a live call. */
  addToCall: true,
  whiteboard: true,
  recording: true,
  breakoutGroups: true,
} as const;
