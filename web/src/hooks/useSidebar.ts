import { useCallback, useState } from 'react';

export type SidebarState = { open: boolean; openSidebar: () => void; closeSidebar: () => void };

/** Whether the slide-in sidebar is open (it only slides on narrow screens). */
export function useSidebar(): SidebarState {
  const [open, setOpen] = useState(false);
  const openSidebar = useCallback(() => setOpen(true), []);
  const closeSidebar = useCallback(() => setOpen(false), []);
  return { open, openSidebar, closeSidebar };
}
