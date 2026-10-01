import { io, type Socket } from 'socket.io-client';

export function createChatSocket({ baseUrl, getToken }: { baseUrl: string; getToken: () => string | null }): Socket {
  return io(`${baseUrl}/chat`, {
    path: '/socket.io',
    auth: (cb) => cb({ token: getToken() || '' }),
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelayMax: 10000,
  });
}
