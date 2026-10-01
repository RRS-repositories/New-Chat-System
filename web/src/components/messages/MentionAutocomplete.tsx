import type { MentionItem } from '../../utils/mentions.ts';
/** Presentational: the composer owns the items, the selected index and the keys. */
export function MentionAutocomplete({
  items,
  idx,
  onPick,
}: {
  items: MentionItem[];
  idx: number;
  onPick: (name: string) => void;
}) {
  if (!items.length) return null;
  return (
    <ul className="mention-list" role="listbox">
      {items.map((it, i) => (
        <li
          key={String(it.id)}
          role="option"
          aria-selected={i === idx}
          className={i === idx ? 'active' : ''}
          onMouseDown={(e) => {
            e.preventDefault();
            onPick(it.label);
          }}
        >
          @{it.label}
        </li>
      ))}
    </ul>
  );
}
