import { useChat } from '../../context/chatContext.ts';
import { useTheme } from '../../context/ThemeProvider.tsx';
import { ACCENTS, type Theme, type ThemeAccent, type ThemeMode } from '../../utils/theme.ts';

const MODES: Array<[ThemeMode, string]> = [
  ['light', 'Light'],
  ['dark', 'Dark'],
];

/** Light or dark, and the accent colour. Applies at once here, and is saved so it follows the person to other devices. */
export function AppearanceSettings({ onError }: { onError: (message: string) => void }) {
  const { mode, accent, setTheme } = useTheme();
  const { actions } = useChat();

  const choose = (next: Theme) => {
    setTheme(next);
    actions.updatePrefs({ theme: next }).catch(() => onError('Could not save your theme. It is kept on this device.'));
  };

  return (
    <>
      <div className="ap-h">APPEARANCE</div>
      <div className="togrow">
        <span className="tx">
          <b>Mode</b>
          <span>Workspace background</span>
        </span>
        <div className="seg" role="group" aria-label="Mode">
          {MODES.map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={mode === value ? 'on' : ''}
              aria-pressed={mode === value}
              data-testid={`theme-mode-${value}`}
              onClick={() => choose({ mode: value, accent })}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="togrow">
        <span className="tx">
          <b>Theme colour</b>
          <span>Accents, buttons and sidebar</span>
        </span>
      </div>
      <div className="swr" role="group" aria-label="Theme colour">
        {(Object.keys(ACCENTS) as ThemeAccent[]).map((key) => (
          <button
            key={key}
            type="button"
            title={ACCENTS[key].label}
            aria-label={`${ACCENTS[key].label} theme`}
            aria-pressed={accent === key}
            data-testid={`theme-accent-${key}`}
            className={`swb${accent === key ? ' on' : ''}`}
            style={{ background: ACCENTS[key].swatch }}
            onClick={() => choose({ mode, accent: key })}
          />
        ))}
      </div>
    </>
  );
}
