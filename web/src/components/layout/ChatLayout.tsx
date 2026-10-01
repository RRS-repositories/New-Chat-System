import type { ReactNode } from 'react';

type Props = {
  sidebar: ReactNode;
  main: ReactNode;
  panel?: ReactNode;
  sidebarOpen: boolean;
  onCloseSidebar: () => void;
};

/** The page frame: sidebar on the left, the main area, and an optional panel on the right. */
export function ChatLayout({ sidebar, main, panel, sidebarOpen, onCloseSidebar }: Props) {
  return (
    <div className={`chat-shell${sidebarOpen ? ' sidebar-open' : ''}${panel ? ' panel-open' : ''}`}>
      <aside className="chat-sidebar">{sidebar}</aside>
      {sidebarOpen && <button className="chat-scrim" aria-label="Close menu" onClick={onCloseSidebar} />}
      <section className="chat-main">{main}</section>
      {panel && <section className="chat-panel">{panel}</section>}
    </div>
  );
}
