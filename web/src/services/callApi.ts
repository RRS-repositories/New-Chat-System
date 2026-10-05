// Every call-related request the web app makes to the chat server.
import type { ApiClient } from './apiClient.ts';
import type { Call, CallInvite, CallJoinResponse, CallParticipant } from '../types/index.ts';

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
    /** Rings another person into the call this tab is in. */
    invite: (callId: string, userId: number) =>
      api.post<{ invite: CallInvite }>(`${callPath(callId)}/invite`, { user_id: userId }),
    /** Stops the ring and takes the invitation back. */
    cancelInvite: (callId: string, userId: number) => api.del(`${callPath(callId)}/invite/${userId}`),
    /** Being rung one-to-one while in a call: brings that caller into the call instead. */
    merge: (ringingCallId: string, intoCallId: string) =>
      api.post(`${callPath(ringingCallId)}/merge`, { into_call_id: intoCallId }),
    get: (callId: string) => api.get<{ call: Call }>(callPath(callId)),
    /** Saves a finished call recording into the call's conversation as a file message. */
    async uploadRecording(channelId: string, file: File, callId: string, durationSecs: number): Promise<void> {
      const form = new FormData();
      form.append('files', file, file.name);
      form.append('content', 'Call recording');
      form.append('recordingCallId', callId);
      form.append('recordingSecs', String(durationSecs));
      const res = await fetch(`${channelPath(channelId)}/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken() ?? ''}` },
        body: form,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || 'The recording could not be saved');
      }
    },
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
