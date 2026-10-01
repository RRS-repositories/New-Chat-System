// Every call-related request the web app makes to the chat server.
import type { ApiClient } from './apiClient.ts';
import type { CallJoinResponse, CallParticipant } from '../types/index.ts';

export type ActiveCallResponse = { call: { id: string } | null; participants: CallParticipant[] };

type Deps = { api: ApiClient; getToken: () => string | null };

const callPath = (callId: string) => `/api/chat/calls/${encodeURIComponent(callId)}`;
const channelPath = (channelId: string) => `/api/chat/channels/${encodeURIComponent(channelId)}`;

export function createCallApi({ api, getToken }: Deps) {
  return {
    /** Starts a call in a channel. `socketId` is this tab's connection: the call belongs to this tab. */
    start: (channelId: string, socketId: string) =>
      api.post<CallJoinResponse>(`${channelPath(channelId)}/calls`, { socketId }),
    join: (callId: string, socketId: string) => api.post<CallJoinResponse>(`${callPath(callId)}/join`, { socketId }),
    leave: (callId: string) => api.post(`${callPath(callId)}/leave`),
    decline: (callId: string) => api.post(`${callPath(callId)}/decline`),
    setScreenShare: (callId: string, on: boolean, socketId: string | undefined) =>
      api.post(`${callPath(callId)}/screen-share`, { on, socketId }),
    /** Host only: tells that person's call to mute. Nobody can unmute another person. */
    hostMute: (callId: string, userId: number) => api.post(`${callPath(callId)}/participants/${userId}/mute`),
    /** Host only: takes that person out of the call. They must ask to come back. */
    hostRemove: (callId: string, userId: number) => api.post(`${callPath(callId)}/participants/${userId}/remove`),
    /** A removed person asks the host to let them back in. */
    askToJoin: (callId: string) => api.post(`${callPath(callId)}/join-requests`),
    cancelAsk: (callId: string) => api.del(`${callPath(callId)}/join-requests`),
    /** Host only: lets a waiting person back in, or refuses. */
    answerJoinRequest: (callId: string, userId: number, accept: boolean) =>
      api.post(`${callPath(callId)}/join-requests/${userId}`, { accept }),
    /** The live call in a channel, if any (for the "Call in progress — Join" banner). */
    active: (channelId: string) => api.get<ActiveCallResponse>(`${channelPath(channelId)}/calls/active`),

    /** Best-effort leave while the page is closing: `keepalive` lets the request outlive the page. */
    leaveOnPageClose(callId: string): void {
      try {
        void fetch(`${callPath(callId)}/leave`, {
          method: 'POST',
          keepalive: true,
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken() ?? ''}` },
          body: '{}',
        }).catch(() => {});
      } catch {
        /* the page is going anyway */
      }
    },
  };
}

export type CallApi = ReturnType<typeof createCallApi>;
