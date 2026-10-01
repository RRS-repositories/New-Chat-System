import { Fragment, type ReactNode } from 'react';
import { parseRich, type Block, type Inline } from '../../utils/richText.ts';

function piece(part: Inline, key: number): ReactNode {
  switch (part.kind) {
    case 'text':
      return part.text;
    case 'mention':
      return (
        <span key={key} className="mention">
          {part.text}
        </span>
      );
    case 'code':
      return (
        <code key={key} className="msg-inline-code">
          {part.text}
        </code>
      );
    case 'link':
      // A new tab that cannot reach back into the chat, and tells the other site nothing about where it came from.
      return (
        <a key={key} className="msg-link" href={part.href} target="_blank" rel="noopener noreferrer nofollow">
          {part.text}
        </a>
      );
    case 'bold':
      return <strong key={key}>{part.children.map(piece)}</strong>;
  }
}

function block(part: Block, key: number): ReactNode {
  if (part.kind === 'code')
    return (
      <pre key={key} className="msg-code">
        <code>{part.text}</code>
      </pre>
    );
  if (part.kind === 'list') {
    const items = part.items.map((item, i) => <li key={i}>{item.map(piece)}</li>);
    return part.ordered ? (
      <ol key={key} className="msg-list" start={part.start}>
        {items}
      </ol>
    ) : (
      <ul key={key} className="msg-list">
        {items}
      </ul>
    );
  }
  // Ordinary text keeps its line breaks (the container is `white-space: pre-wrap`).
  return (
    <Fragment key={key}>
      {part.lines.map((line, i) => (
        <Fragment key={i}>
          {i > 0 && '\n'}
          {line.map(piece)}
        </Fragment>
      ))}
    </Fragment>
  );
}

/**
 * Message text on screen: links, **bold**, `code`, code blocks, lists and @mentions.
 * Built from text pieces only, never from HTML, so nothing typed in a message can run as code.
 */
export function renderRich(content: string, names: string[]): ReactNode {
  return parseRich(content, names).map(block);
}
