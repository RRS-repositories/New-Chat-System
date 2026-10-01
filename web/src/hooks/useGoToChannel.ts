import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { paths } from '../config/routes.ts';
import { rememberLastChannel } from '../utils/lastChannel.ts';

/** Opens a channel: remembers it, goes to its address, then runs `after` (e.g. close the sidebar). */
export function useGoToChannel(after?: () => void) {
  const navigate = useNavigate();
  return useCallback(
    (channelId: string) => {
      rememberLastChannel(channelId);
      navigate(paths.channel(channelId));
      after?.();
    },
    [navigate, after],
  );
}
