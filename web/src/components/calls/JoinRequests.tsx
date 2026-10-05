import type { JoinRequest } from '../../types/index.ts';

type Props = {
  requests: JoinRequest[];
  onAnswer: (userId: number, accept: boolean) => void;
};

/** Shown to the host: people the host removed who are asking to come back into the call. */
export function JoinRequests({ requests, onAnswer }: Props) {
  if (!requests.length) return null;
  return (
    <ul className="call-requests" aria-label="People asking to rejoin">
      {requests.map((request) => (
        <li key={request.userId} className="call-request" data-testid="call-request" data-user-id={request.userId}>
          <span className="call-name">{request.userName} asks to rejoin</span>
          <button
            className="ok"
            data-testid="call-request-accept"
            aria-label={`Let ${request.userName} back in`}
            onClick={() => onAnswer(request.userId, true)}
          >
            Let in
          </button>
          <button
            className="no"
            data-testid="call-request-refuse"
            aria-label={`Refuse ${request.userName}`}
            onClick={() => onAnswer(request.userId, false)}
          >
            Refuse
          </button>
        </li>
      ))}
    </ul>
  );
}
