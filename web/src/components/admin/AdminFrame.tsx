import { useEffect, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { paths } from '../../config/routes.ts';
import { useChat } from '../../context/chatContext.ts';
import { useSidebar } from '../../hooks/useSidebar.ts';
import { isManagement, isManagementOrIT } from '../../utils/restrictions.ts';
import { AppShell } from '../layout/AppShell.tsx';
import { AdminHead, type AdminTab } from './AdminHead.tsx';

type Props = { title: string; tab: AdminTab; onBack?: () => void; children: ReactNode };

/** The frame of every admin page: the app shell, the admin header, and the guard (Management; IT for the people pages). */
export function AdminFrame({ title, tab, onBack, children }: Props) {
  const { user, setCurrentChannelId } = useChat();
  const navigate = useNavigate();
  const sidebar = useSidebar();

  // No channel is open behind an admin page, so nothing gets marked read there.
  useEffect(() => {
    setCurrentChannelId(null);
  }, [setCurrentChannelId]);

  return (
    <AppShell
      sidebar={sidebar}
      main={
        <div className="admin-page">
          <AdminHead
            title={title}
            tab={tab}
            onBack={onBack}
            onOpenSidebar={sidebar.openSidebar}
            onClose={() => navigate(paths.home)}
            onTab={(next) =>
              navigate(
                next === 'restrictions'
                  ? paths.adminRestrictions
                  : next === 'deactivated'
                    ? paths.adminDeactivated
                    : paths.admin,
              )
            }
            canSeeRestrictions={isManagement(user)}
          />
          {(tab === 'restrictions' ? isManagement(user) : isManagementOrIT(user)) ? (
            children
          ) : (
            <div className="admin-body">
              <p className="muted">{tab === 'restrictions' ? 'Management only' : 'Management or IT only'}</p>
            </div>
          )}
        </div>
      }
    />
  );
}
