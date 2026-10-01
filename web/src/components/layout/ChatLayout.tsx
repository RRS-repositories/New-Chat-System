import { useState, type ReactNode } from 'react';
export function ChatLayout({ sidebar, main, panel, sidebarOpen, onCloseSidebar }: { sidebar: ReactNode; main: ReactNode; panel?: ReactNode; sidebarOpen: boolean; onCloseSidebar: () => void }) {
  return (
    <div className={`chat-shell${sidebarOpen ? ' sidebar-open' : ''}${panel ? ' panel-open' : ''}`}>
      <aside className="chat-sidebar">{sidebar}</aside>
      {sidebarOpen && <button className="chat-scrim" aria-label="Close menu" onClick={onCloseSidebar} />}
      <section className="chat-main">{main}</section>
      {panel && <section className="chat-panel">{panel}</section>}
    </div>
  );
}
export function useSidebar() { const [open, setOpen] = useState(false); return { open, openSidebar: () => setOpen(true), closeSidebar: () => setOpen(false) }; }
