export function TypingIndicator({ names }: { names: string[] }) {
  if (!names.length) return <div className="typing" aria-hidden="true" />;
  const text =
    names.length === 1
      ? `${names[0]} is typing…`
      : names.length === 2
        ? `${names[0]} and ${names[1]} are typing…`
        : 'Several people are typing…';
  return <div className="typing muted">{text}</div>;
}
