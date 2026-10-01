# Rules — boundaries for the AI

These rules bind any AI (or developer) working on this project.
They are taken from the owner's `rules.txt` and from decisions the owner has made during the build.
If a rule here and an instruction from the owner disagree, the owner's latest instruction wins, and this file gets updated.

## 1. How to work

1. **Read the documents first.** At the start of every session read `Memory.md`, then `Phases.md`. Do not re-read the whole codebase or guess.
2. **One phase at a time.** Work only on the current phase in `Phases.md`. Finish it, report, and wait for the owner before starting the next.
3. **Do what was asked, nothing more.** No extra features, no unrequested changes to other parts of the app.
4. **Ask before big or irreversible actions.** Especially anything that changes what staff see, anything on the server, and anything involving accounts or credentials.
5. **Everything stays local.** All work is done in this folder and this repository. Do not create artifacts, documents or chats in the owner's Claude account.
6. **Update `Memory.md`** after every piece of finished work: what changed, where, and what is next.
7. **Explain in plain words.** Reports to the owner say what was done and what it means, not how the code works.
8. **Keep the process light.** Do the work directly. Do not run long multi-agent pipelines unless the owner asks for them.

## 2. Product boundaries

1. The chat runs **only on chat2**. Never add it to the CRM until the owner says so.
2. **No paid services.** Self-hosted or free only.
3. **No camera video.** Calls are voice and screen share.
4. Calls stay **decentralised**: audio and screen go browser to browser, never through our server.
5. Keep it **minimal and lightweight**. Prefer removing to adding.

## 3. Code quality

1. Code must be clean, modular, readable, maintainable and easy to debug.
2. **One job per file.** Keep files small. If a file grows large or does several unrelated things, split it.
3. **Follow the folder structure in `Architecture.md`.** Do not mix UI, business logic, database queries, API calls and configuration in one file.
4. **Reuse, do not repeat.** Shared components and functions instead of copies.
5. **Clear, consistent names** for files, functions, variables, components, routes and database objects.
6. **No needless abstraction.** Do not add files, folders, classes or patterns unless they give a real benefit.
7. **Centralise the common things:** error handling, sign-in checks, validation, logging, API replies and database access.
8. **Preserve existing behaviour** when changing something, unless the requirement says to change it.
9. **Follow the conventions already in the code.** Do not introduce a new style without a reason.
10. **Clean up before calling a feature complete:** no unused imports, dead code, duplicates, needless comments or leftover debugging lines.
11. **Review after each significant feature** for duplication, needless complexity, poor separation and bugs, and tidy what you find.
12. The codebase should read like a professionally engineered production project.

## 4. Libraries

1. **Check what already exists before adding a library.** Avoid dependency bloat.
2. **Use:** Express, Socket.IO, `pg`, React, TypeScript, Vite, lucide-react, `web-push`, and the browser's own WebRTC.
3. **Avoid:** WebRTC wrapper libraries, UI component kits, CSS frameworks, state-management libraries, and anything that needs a paid account.
4. A new dependency needs a one-line reason recorded in `Memory.md`.

## 5. Security and secrets

1. **Never hard-code** secrets, API keys, passwords, tokens or server-specific settings. Use environment variables.
2. Never commit an environment file.
3. Every server route checks the person is signed in and allowed. Admin routes are Management only.
4. All database queries use parameters, never text built from user input.
5. Remember `users.role` is a special database type: cast it to text before comparing it with text.

## 6. Error handling

1. The server answers errors in one shape: `{ success: false, code, message }`, through one central error handler.
2. The web app shows a short, clear message next to the thing that failed. Never a blank screen, never a raw error.
3. Background work (notifications, presence, digest) must never break the request that triggered it. Log the failure and carry on.

## 7. Testing and release

1. **Test locally before the server.** Automated tests, then a real browser run against the local test server, then deploy.
2. A fix comes with a test that fails before the fix and passes after.
3. Say plainly what was tested and what was not.
4. **Deploy only when the owner says so.** After deploying, confirm the service started.
5. **Git:** never commit straight to `main` after the first setup commit. Work on a branch, open a pull request, then merge. Never force-push.

## 8. What the AI must not do

- Add the chat to the CRM, or change the CRM's menus.
- Sign in to, switch, or create accounts without asking.
- Delete data on the production server.
- Run ahead into the next phase.
- Claim something works without having run it.
