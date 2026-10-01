import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { paths } from '../config/routes.ts';
import { useChat } from '../context/chatContext.ts';

/** `/dm/<userId>`: opens (or creates) the direct message with that person and goes to it. */
export function DmRedirectPage() {
  const { userId } = useParams();
  const navigate = useNavigate();
  const { actions } = useChat();

  useEffect(() => {
    actions
      .openDm(Number(userId))
      .then((channel) => navigate(paths.channel(channel.id), { replace: true }))
      .catch(() => navigate(paths.home, { replace: true }));
  }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}
