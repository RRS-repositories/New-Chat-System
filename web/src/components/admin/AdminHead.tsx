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
  /** The restrictions tab is Management only. */
  canSeeRestrictions?: boolean;
};

const TABS: { id: AdminTab; label: string }[] = [
  { id: 'people', label: 'People' },
  { id: 'restrictions', label: 'All restrictions' },
];

/** The header shared by every admin page: title, the two tabs, and a way back to chat. */
export function AdminHead({ title, tab, onTab, onClose, onOpenSidebar, onBack, canSeeRestrictions = true }: Props) {
  return (
    <header className="m-head chan-head">
      <button className="hbtn only-mobile" aria-label="Channels" onClick={onOpenSidebar}>
        <Menu size={18} />
      </button>
      {onBack && (
        <button className="hbtn" aria-label="Back to people" title="Back to people" onClick={onBack}>
          <ArrowLeft size={18} />
        </button>
      )}
      <div className="m-title">
        <div className="r1">
          <h1 className="chan-title">{title}</h1>
        </div>
      </div>
      <nav className="admin-tabs" aria-label="Admin sections">
        {TABS.filter(({ id }) => id !== 'restrictions' || canSeeRestrictions).map(({ id, label }) => (
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
        <button className="hbtn" aria-label="Close admin" title="Back to chat" onClick={onClose}>
          <X size={18} />
        </button>
      </span>
    </header>
  );
}
