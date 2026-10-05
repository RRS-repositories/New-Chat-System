import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { Avatar } from '../components/common/Avatar.tsx';

export type ToastAction = { label: string; kind?: 'ok' | 'no'; onClick?: () => void };
export type ToastInput = {
  /** The main line. */
  text: ReactNode;
  /** A second, quieter line (cut to one line). */
  detail?: string;
  icon?: ReactNode;
  /** Shows this person's avatar instead of an icon. */
  avatar?: { name: string; src?: string | null };
  actions?: ToastAction[];
  /** How long it stays (milliseconds). Ignored when `sticky`. */
  ms?: number;
  /** Stays until an action is pressed or it is dismissed by the caller. */
  sticky?: boolean;
};
type Toast = ToastInput & { id: number };
/** Shows a toast; the returned function removes it. */
type ShowToast = (toast: ToastInput) => () => void;

const DEFAULT_MS = 3400;
const MAX_SHOWN = 4;

const ToastContext = createContext<ShowToast | null>(null);

export function useToast(): ShowToast {
  const show = useContext(ToastContext);
  if (!show) throw new Error('useToast must be used inside <ToastProvider>');
  return show;
}

/**
 * Short notes in the top-right corner: "pinned", "Ann joined the call", a new message elsewhere.
 * They sit above everything, the call screen included.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setToasts((list) => list.filter((t) => t.id !== id)), []);

  const show = useCallback<ShowToast>(
    (input) => {
      const id = nextId.current++;
      setToasts((list) => [...list.slice(-(MAX_SHOWN - 1)), { ...input, id }]);
      if (!input.sticky) setTimeout(() => dismiss(id), input.ms ?? DEFAULT_MS);
      return () => dismiss(id);
    },
    [dismiss],
  );

  const value = useMemo(() => show, [show]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="toast" data-testid="toast">
            {t.avatar ? (
              <Avatar name={t.avatar.name} src={t.avatar.src} size="md" />
            ) : (
              t.icon && <span className="tic">{t.icon}</span>
            )}
            <span className="tbody">
              {t.text}
              {t.detail && <p>{t.detail}</p>}
            </span>
            {t.actions && t.actions.length > 0 && (
              <span className="ta">
                {t.actions.map((action) => (
                  <button
                    key={action.label}
                    className={action.kind ?? 'no'}
                    onClick={() => {
                      dismiss(t.id);
                      action.onClick?.();
                    }}
                  >
                    {action.label}
                  </button>
                ))}
              </span>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
