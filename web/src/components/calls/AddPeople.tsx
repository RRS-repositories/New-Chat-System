import { useEffect, useMemo, useState, type RefObject } from 'react';
import { useChat } from '../../context/chatContext.ts';
import type { UserOption } from '../../types/index.ts';
import { presenceOf } from '../../utils/presence.ts';
import { Floating } from '../common/Floating.tsx';
import { UserAvatar } from '../common/UserAvatar.tsx';

/** A call holds this many people, counting those being rung (kept in step with callMaxParticipants on the server). */
export const CALL_LIMIT = 50;
const SEARCH_FROM = 8;

type Props = {
  anchor: RefObject<HTMLElement | null>;
  /** Everyone in the call or being rung into it: they are not offered. */
  takenIds: number[];
  onPick: (userId: number) => void;
  onClose: () => void;
};

/** The list behind "Add to call": pick a person and their screen rings; they join this call when they answer. */
export function AddPeople({ anchor, takenIds, onPick, onClose }: Props) {
  const { actions, state } = useChat();
  const [people, setPeople] = useState<UserOption[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    let live = true;
    actions
      .listUsers()
      .then((list) => live && setPeople(list))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [actions]);

  const full = takenIds.length >= CALL_LIMIT;
  const outside = useMemo(() => (people || []).filter((p) => !takenIds.includes(p.id)), [people, takenIds]);
  const words = filter.trim().toLowerCase();
  const shown = words ? outside.filter((p) => p.fullName.toLowerCase().includes(words)) : outside;

  // The box is placed once, when it appears: wait for the list so its height is the real one.
  if (!people && !failed) return null;
  return (
    <Floating anchor={anchor} onClose={onClose} className="cmenu dark call-add-menu" prefer="above" label="Add to call">
      <div data-testid="call-add-menu">
        {failed ? (
          <div className="hint">The list of people could not be loaded. Try again.</div>
        ) : full ? (
          <div className="hint">This call is full. A call holds up to {CALL_LIMIT} people.</div>
        ) : (
          <div className="hint">Ring someone. They join this call when they answer.</div>
        )}
        {!failed && !full && outside.length > SEARCH_FROM && (
          <input
            className="call-add-filter"
            autoFocus
            value={filter}
            placeholder="Find a person…"
            aria-label="Find a person"
            onChange={(e) => setFilter(e.target.value)}
          />
        )}
        {!failed && !outside.length && <div className="hint">Everyone is already in the call.</div>}
        {!failed && outside.length > 0 && !shown.length && <div className="hint">Nobody by that name.</div>}
        <div className="call-add-list">
          {shown.map((person) => (
            <button
              key={person.id}
              data-testid="call-add-person"
              data-user-id={person.id}
              disabled={full}
              onClick={() => {
                onClose();
                onPick(person.id);
              }}
            >
              <UserAvatar userId={person.id} name={person.fullName} size="sm" />
              <span>
                {person.fullName}
                {presenceOf(state.presence, person.id) === 'offline' ? ' · offline' : ''}
              </span>
            </button>
          ))}
        </div>
      </div>
    </Floating>
  );
}
