import { useState } from 'react';
import { useChat } from '../../context/chatContext.ts';
import { useToast } from '../../context/ToastProvider.tsx';
import type { Message } from '../../types/index.ts';

/**
 * The buttons under one of Eleanor's messages ("Accept", "Reject", "Show me"). A press goes to the
 * CRM, which decides what happens and answers in the conversation.
 */
export function BotActions({ m }: { m: Message }) {
  const { api } = useChat();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string | null>(null);

  async function press(index: number, label: string) {
    setBusy(true);
    try {
      await api.post(`/api/chat/messages/${m.id}/action`, { index });
      setSent(label);
    } catch (e: any) {
      toast({ text: e?.message || 'Could not send. Please try again' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bot-actions" data-testid="bot-actions">
      {m.metadata?.actions?.map((a, i) => (
        <button key={i} className="btn-ghost btn-small" disabled={busy} onClick={() => void press(i, a.label)}>
          {a.label}
        </button>
      ))}
      {sent && <span className="muted">Sent: {sent}</span>}
    </div>
  );
}
