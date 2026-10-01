# Server notes

How the chat is installed on the office server, and how to deploy it.
Nothing secret is written here: passwords and keys live only in the settings file on the server.

## Where things are

| Item | Where |
|---|---|
| Code | `/opt/chat` (a copy of this repository, branch `main`) |
| Process | `chat-server`, managed by pm2, defined in `deploy/ecosystem.config.cjs` |
| Port | 5020, on the server itself only. nginx site `chat2` passes requests to it. |
| Settings | `/opt/chat/.env`, which is a link to `/opt/crm/.env` (see below) |
| Uploaded files | `/data/chat-uploads` |
| Database | The CRM's Postgres, schema `chat` |
| Call relay | coturn (`/etc/turnserver.conf`), port 3478 and ports 49160–49200 |
| Logs | `pm2 logs chat-server` |

## Settings

The chat signs people in through the CRM and uses the CRM's database, so both read the **same settings file**.
`/opt/chat/.env` is a link to `/opt/crm/.env`. There is one place to change a password, and the two can never disagree.

The chat reads these names from it (the list is in `server/src/config/index.js`):
the database settings (`DB_*`), `SESSION_JWT_SECRET`, `REDIS_URL`, the mail settings (`SMTP_*`, `MAIL_FROM*`), and everything starting with `CHAT_`.

After changing a setting: `pm2 restart chat-server`.

## Deploy

```
/opt/chat/deploy/deploy.sh
```

It pulls `main` and does only what the change needs:

| What changed | What the script does |
|---|---|
| Web app only | Rebuilds the web app. **No restart**, so calls in progress are not cut. People get the new version on their next page load. |
| Server code | Restarts the chat process. Takes a few seconds; calls in progress end and people reconnect by themselves. |
| Server libraries | Installs them, then restarts. |
| Nothing | Says so and stops. |

At the end it checks the chat answers. If any step fails, it stops with an error and the live site stays as it was where possible
(a failed web build never replaces the working one). Fix the cause and run the script again: it carries on from the last deploy that finished.

`deploy.sh --force` reinstalls, rebuilds and restarts everything. Use it to repair.

The script never touches the CRM. The other direction is not fully separate: the CRM's `deploy.sh --all` restarts **every** pm2 process, chat included.

## Database changes

Database files are in `server/migrations/`, numbered in order. The deploy script does **not** apply them.

```
cd /opt/chat
node server/migrations/apply.mjs                                # shows what would run, changes nothing
node server/migrations/apply.mjs --commit --only=chat_004_x.sql   # applies one file
```

Apply a new database file **before** deploying the code that needs it.

## Going back to an earlier version

Undo the change on GitHub (revert the pull request), then run the deploy script. The server only ever follows `main`.

## Installing on a new server

1. Node 20, pm2, nginx, Postgres access and Redis must already be there (the CRM needs the same).
2. `git clone https://github.com/RRS-repositories/New-Chat-System.git /opt/chat`
3. `ln -s /opt/crm/.env /opt/chat/.env`
4. `/opt/chat/deploy/deploy.sh` (the first run installs everything and starts the process)
5. nginx: a site that passes everything, including websockets, to `http://127.0.0.1:5020`.

## Testing the deploy script

`bash deploy/rehearse.sh` runs the deploy script on a developer PC against throwaway copies, with stand-ins for pm2, npm and curl.
Run it after any change to `deploy.sh`.
