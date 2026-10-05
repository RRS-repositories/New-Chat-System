/** "Ann is typing…" with three bouncing dots. Keeps its height when nobody is typing, so the page does not jump. */
export function TypingIndicator({ names }: { names: string[] }) {
  if (!names.length) return <div className="typing" aria-hidden="true" />;
  const text =
    names.length === 1
      ? `${names[0]} is typing…`
      : names.length === 2
        ? `${names[0]} and ${names[1]} are typing…`
        : 'Several people are typing…';
  return (
    <div className="typing" aria-live="polite">
      <span className="dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span>{text}</span>
    </div>
  );
}
