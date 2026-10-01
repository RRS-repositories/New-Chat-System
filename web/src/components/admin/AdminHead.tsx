import { ArrowLeft, Menu, X } from 'lucide-react';

export type AdminTab = 'people' | 'restrictions';

type Props = {
  title: string;
  tab: AdminTab;
  onTab: (tab: AdminTab) => void;
  onClose: () => void;
  onOpenSidebar: () => void;
  /** Shown on a person's page: back to the people list. */
  onBack?: () => void;
};

const TABS: { id: AdminTab; label: string }[] = [
  { id: 'people', label: 'People' },
  { id: 'restrictions', label: 'All restrictions' },
];

/** The header shared by every admin page: title, the two tabs, and a way back to chat. */
export function AdminHead({ title, tab, onTab, onClose, onOpenSidebar, onBack }: Props) {
  return (
    <header className="chan-head">
      <button className="icon-btn only-mobile" aria-label="Channels" onClick={onOpenSidebar}>
        <Menu size={18} />
      </button>
      {onBack && (
        <button className="icon-btn" aria-label="Back to people" title="Back to people" onClick={onBack}>
          <ArrowLeft size={16} />
        </button>
      )}
      <h1 className="chan-title">{title}</h1>
      <nav className="admin-tabs" aria-label="Admin sections">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            className={`admin-tab${tab === id ? ' active' : ''}`}
            aria-current={tab === id ? 'page' : undefined}
            onClick={() => onTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>
      <span className="head-actions">
        <button className="icon-btn" aria-label="Close admin" title="Back to chat" onClick={onClose}>
          <X size={16} />
        </button>
      </span>
    </header>
  );
}
