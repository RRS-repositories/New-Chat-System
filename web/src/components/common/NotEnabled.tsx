import { NOT_ENABLED_MESSAGE } from '../../config/constants.ts';
import { useSignOut } from '../../context/SignOutContext.ts';

/** The whole screen for someone who is signed in but not switched on for chat. */
export function NotEnabled() {
  const signOut = useSignOut();
  return (
    <main className="not-enabled">
      <div className="not-enabled-card">
        <p>{NOT_ENABLED_MESSAGE}</p>
        {signOut && (
          <button className="link" onClick={signOut}>
            Sign out
          </button>
        )}
      </div>
    </main>
  );
}
