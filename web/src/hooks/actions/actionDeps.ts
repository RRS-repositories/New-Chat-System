import type { Dispatch, MutableRefObject } from 'react';
import type { Socket } from 'socket.io-client';
import type { Action, State } from '../../context/chatReducer.ts';
import type { ChatApi } from '../../services/chatApi.ts';
import type { ChatUser } from '../../types/index.ts';

/** What every group of chat actions needs: the server calls, the live connection, and the shared state. */
export type ActionDeps = {
  chatApi: ChatApi;
  socket: Socket;
  user: ChatUser;
  dispatch: Dispatch<Action>;
  /** Always the newest state, for actions that must read it without being rebuilt when it changes. */
  stateRef: MutableRefObject<State>;
};
