// Eleanor COMP (Phase 10): what people do with her messages goes back to the CRM.
// The CRM decides what it means and who may act (only an owner's press or reply changes anything).
import { httpError } from '../middleware/errors.js';
import { isDmWith } from '../models/channels.model.js';
import { getMessage } from '../models/messages.model.js';
import { assertMember } from './channels.service.js';

// The CRM refuses longer replies.
const MAX_REPLY = 500;

/** A button under one of Eleanor's messages was pressed: tell the CRM who pressed which. */
export async function pressButton({ db, sendEvent, eleanorUserId }, { messageId, index, user }) {
  const message = await getMessage(db, messageId);
  if (!message) throw httpError(404, 'not_found', 'Message not found');
  await assertMember(db, message.channelId, user.id);
  const action = message.metadata?.actions?.[index];
  if (message.userId !== eleanorUserId || message.metadata?.kind !== 'bot_actions' || !action)
    throw httpError(400, 'no_such_button', 'That button does not exist');
  const out = await sendEvent({ crmUserId: user.id, action: action.action, ref: action.ref });
  if (!out.ok) throw httpError(502, 'crm_refused', 'The CRM did not take it. Please try again later');
}

/** A message typed into a direct conversation with Eleanor goes to the CRM as a reply or question. */
export async function forwardReply({ db, sendEvent, eleanorUserId }, { channelId, sender, content }) {
  if (sender.id === eleanorUserId || !content || content.length > MAX_REPLY) return;
  if (await isDmWith(db, channelId, eleanorUserId)) await sendEvent({ crmUserId: sender.id, text: content });
}
