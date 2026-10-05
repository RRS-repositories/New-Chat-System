import { useRef, useState } from 'react';
import { ChevronDown, LayoutGrid, Plus, Users, X } from 'lucide-react';
import {
  MAX_GROUPS,
  addGroup,
  groupOf,
  movePerson,
  removeGroup,
  renameGroup,
  type Breakout,
  type BreakoutGroup,
} from '../../utils/breakout.ts';
import { Floating } from '../common/Floating.tsx';
import { UserAvatar } from '../common/UserAvatar.tsx';

export type BreakoutPerson = { userId: number; name: string; isSelf: boolean; isHost: boolean; ringing?: boolean };

type Props = {
  breakout: Breakout;
  people: BreakoutPerson[];
  /** Only the host can change anything; everyone else sees the arrangement. */
  isHost: boolean;
  hostName: string;
  onChange: (groups: BreakoutGroup[]) => void;
  onStart: () => void;
  onEnd: () => void;
  onClose: () => void;
};

const first = (name: string) => name.split(' ')[0] || name;
const newGroupId = () => `g-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** One person in the panel. For the host it is a button that opens "Move to…". */
function Chip({
  person,
  groups,
  current,
  canMove,
  onMove,
}: {
  person: BreakoutPerson;
  groups: BreakoutGroup[];
  current: BreakoutGroup | null;
  canMove: boolean;
  onMove: (groupId: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const label = `${first(person.name)}${person.isSelf ? ' (you)' : ''}${person.isHost && !person.isSelf ? ' · host' : ''}${person.ringing ? ' · ringing…' : ''}`;
  return (
    <>
      <button
        ref={button}
        className="bo-chip"
        data-testid="bo-person"
        data-user-id={person.userId}
        disabled={!canMove}
        aria-haspopup={canMove ? 'menu' : undefined}
        aria-expanded={canMove ? open : undefined}
        onClick={() => setOpen(!open)}
      >
        <UserAvatar userId={person.userId} name={person.name} size="sm" />
        {label}
        {canMove && (
          <span className="mv">
            <ChevronDown size={12} />
          </span>
        )}
      </button>
      {open && (
        <Floating anchor={button} onClose={() => setOpen(false)} className="cmenu dark" role="menu" label="Move to">
          <div className="hint">Move {first(person.name)} to…</div>
          {groups.map((g) => (
            <button
              key={g.id}
              data-testid="bo-move-to"
              disabled={current?.id === g.id}
              onClick={() => {
                setOpen(false);
                onMove(g.id);
              }}
            >
              <LayoutGrid size={15} />
              <span>{g.name}</span>
            </button>
          ))}
          <button
            data-testid="bo-move-main"
            disabled={!current}
            onClick={() => {
              setOpen(false);
              onMove(null);
            }}
          >
            <Users size={15} />
            <span>Main room (with the host)</span>
          </button>
        </Floating>
      )}
    </>
  );
}

/** The "Add people to Group N" button and its list of people who are not in a group yet. */
function AddToGroup({
  group,
  available,
  onAdd,
}: {
  group: BreakoutGroup;
  available: BreakoutPerson[];
  onAdd: (userId: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={button} className="bg-addp" data-testid="bo-add-people" onClick={() => setOpen(!open)}>
        <Plus size={12} />
        Add people to {group.name}
      </button>
      {open && (
        <Floating anchor={button} onClose={() => setOpen(false)} className="cmenu dark" role="menu" label="Add people">
          <div className="hint">Add to {group.name}</div>
          {available.map((person) => (
            <button
              key={person.userId}
              data-testid="bo-add-person"
              data-user-id={person.userId}
              onClick={() => {
                setOpen(false);
                onAdd(person.userId);
              }}
            >
              <UserAvatar userId={person.userId} name={person.name} size="sm" />
              <span>{person.name}</span>
            </button>
          ))}
        </Floating>
      )}
    </>
  );
}

/**
 * Breakout groups: the host makes groups, puts people in them, opens them, moves people while
 * they are open, and brings everyone back. Anyone not in a group stays with the host.
 */
export function BreakoutPanel({ breakout, people, isHost, hostName, onChange, onStart, onEnd, onClose }: Props) {
  const { groups, active } = breakout;
  const byId = new Map(people.map((p) => [p.userId, p]));
  const inAGroup = (userId: number) => !!groupOf(breakout, userId);
  const mainRoom = people.filter((p) => !inAGroup(p.userId));
  // The host stays in the main room, and someone still ringing is not in the call yet.
  const available = mainRoom.filter((p) => !p.isHost && !p.ringing);
  const anyoneOut = groups.some((g) => g.member_ids.length > 0);

  return (
    <aside className="bopanel" aria-label="Breakout groups" data-testid="bo-panel">
      <div className="bo-h">
        <h2>Breakout groups</h2>
        <button className="p-x bo-x" aria-label="Close" data-testid="bo-close" onClick={onClose}>
          <X size={16} />
        </button>
      </div>
      <p className="bo-note">
        {isHost
          ? 'Create as many groups as you need and put people in them. Anyone you leave out stays with you in the main room. People in a group hear only their group.'
          : `${first(hostName) || 'The host'} arranges the groups. People in a group hear only their group; everyone else is in the main room with the host.`}
      </p>
      <div className="bo-b">
        {groups.map((g) => (
          <div className="bg-card" key={g.id} data-testid="bo-group">
            <div className="bg-top">
              {isHost ? (
                <input
                  className="bg-name"
                  aria-label="Group name"
                  maxLength={40}
                  defaultValue={g.name}
                  key={g.name}
                  onBlur={(e) => {
                    const name = e.target.value.trim();
                    if (name && name !== g.name) onChange(renameGroup(groups, g.id, name));
                    else e.target.value = g.name;
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur();
                  }}
                />
              ) : (
                <b>{g.name}</b>
              )}
              <span>
                {g.member_ids.length} {g.member_ids.length === 1 ? 'person' : 'people'}
              </span>
              {isHost && (
                <button
                  className="bg-del"
                  title="Remove group"
                  aria-label={`Remove ${g.name}`}
                  data-testid="bo-remove-group"
                  onClick={() => onChange(removeGroup(groups, g.id))}
                >
                  <X size={12} />
                </button>
              )}
            </div>
            {g.member_ids.length ? (
              g.member_ids.map((userId) => {
                const person = byId.get(userId);
                return person ? (
                  <Chip
                    key={userId}
                    person={person}
                    groups={groups}
                    current={g}
                    canMove={isHost}
                    onMove={(groupId) => onChange(movePerson(groups, userId, groupId))}
                  />
                ) : null;
              })
            ) : (
              <div className="bo-empty">Empty</div>
            )}
            {isHost && available.length > 0 && (
              <AddToGroup
                group={g}
                available={available}
                onAdd={(userId) => onChange(movePerson(groups, userId, g.id))}
              />
            )}
          </div>
        ))}
        {isHost && (
          <button
            className="bo-add"
            data-testid="bo-add-group"
            disabled={groups.length >= MAX_GROUPS}
            title={groups.length >= MAX_GROUPS ? 'Six groups is the most' : undefined}
            onClick={() => onChange(addGroup(groups, newGroupId()))}
          >
            <Plus size={14} />
            {groups.length ? 'Add another group' : 'Add a group'}
          </button>
        )}
        {!isHost && !groups.length && <div className="bo-empty">No groups yet.</div>}
        <div className="bo-sec">
          {active && <span className="lv" />}
          MAIN ROOM — WITH THE HOST
        </div>
        {mainRoom.map((person) => (
          <Chip
            key={person.userId}
            person={person}
            groups={groups}
            current={null}
            canMove={isHost && !person.isHost && !person.ringing && groups.length > 0}
            onMove={(groupId) => onChange(movePerson(groups, person.userId, groupId))}
          />
        ))}
      </div>
      <div className="bo-f">
        {!isHost ? (
          <button className="ghostb" onClick={onClose}>
            Close
          </button>
        ) : active ? (
          <button className="go" data-testid="bo-end" onClick={onEnd}>
            Bring everyone back
          </button>
        ) : (
          <>
            <button className="ghostb" onClick={onClose}>
              Close
            </button>
            <button className="go" data-testid="bo-start" disabled={!anyoneOut} onClick={onStart}>
              Open breakout rooms
            </button>
          </>
        )}
      </div>
    </aside>
  );
}
