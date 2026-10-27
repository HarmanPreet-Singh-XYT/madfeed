# Preview build

The real app, running on sample data, with no backend and no sign-in. It exists so the screens can be worked
on and judged without a database, an API or an account. What you change here is the real UI, so there is
nothing to port afterwards.

## Run it

```
cd web
npm run dev:preview      # http://localhost:3100/mock   (live reload)
npm run build:preview && npm run start:preview     # a production-style preview
npm run test:preview     # walks every screen at desktop and phone size, with the accessibility scan
```

`/mock` lists every screen and lets you switch how the data behaves: normal, empty workspace, slow responses,
everything failing, signed in or out, and **Reset sample data**. Changes you make while clicking around
(accepting a quote, shipping a request, voting) are kept until you reset or restart the server.

## How it stays out of the real app

The real app talks to the API and reads the session in exactly one place, `lib/server/transport.ts`. A preview
build (`MOCK_UI=true`) tells `next.config.ts` to swap four files for versions in this folder:

| Real file                      | Preview stand-in                                                                      |
| ------------------------------ | ------------------------------------------------------------------------------------- |
| `lib/server/transport.ts`      | `mock/transport.ts` (answers API calls from memory; always signed in)                 |
| `lib/server/auth-transport.ts` | `mock/auth-transport.ts` (a pretend sign-in service: any email and password signs in) |
| `lib/server/preview.ts`        | `mock/preview.ts` (lets the `/mock` pages open; the real one says "not found")        |
| `components/preview-badge.tsx` | `mock/preview-badge.tsx` ("Preview · sample data" tag; the real one renders nothing)  |

Rules, checked by `mock/rules.test.ts` and `mock/alias-check.ts` (a failing test or build means one was broken):

- `MOCK_UI` is read in `next.config.ts` and nowhere else. It refuses to run with `APP_ENV=production`.
- Nothing outside `mock/` and `app/mock/` imports from `mock/`.
- The swapped modules are always imported by their full name (`@/lib/server/transport`, ...), which is
  what the swap matches.
- Pages and components have no "is this a preview" checks. If a screen cannot be shown with sample data, fix
  the screen.
- Each stand-in must offer exactly what the real module offers (the compiler checks this).

A normal build contains no sample data and its `/mock` pages answer "not found". A preview build writes to
`.next-preview`, so it never overwrites the real build.

## Adding sample data

- **Data** lives in `mock/seed.ts` (and `mock/seed-surveys.ts`), typed from the API contract
  (`lib/api/schema.gen.d.ts`), so a changed contract breaks the build here instead of silently going stale.
  Quotes must appear word for word in their conversation; use the `span()` helper so the saved positions are
  right.
- **Behaviour** lives in `mock/handlers/*`, grouped by area (feedback, loop, public, research, recordings, surveys,
  findings, support, workspace, integrations). One `on("GET", "/v1/…/{id}", ({ s, params, body, query }) => …)` per
  endpoint, using the same `{names}` as `api/openapi.yaml`. Mutate `s` (the store) to make flows work, and throw
  `notFound()` or `new MockError(status, code, message)` to fail.
- **Coverage is enforced.** `mock/coverage.test.ts` fails if an API operation that has a screen has no handler, so
  a new endpoint cannot be forgotten. Operations with no screen (health checks, the key-authenticated `/v1/ext`
  routes for other programs) are exempt.
- Everything is made up. No real people or companies, no competitor names, no invented product name.

## What works

Every screen, the main flows (accept, ship, approve, vote, answer a survey, reply in the inbox, upload a
recording and read its transcript, connect a tool, change settings, delete a workspace), sign-in, sign-up and
password reset (any email and password works; see `mock/auth-transport.ts` for the special cases), and the pages
customers see (roadmap, release notes, chat window, surveys, unsubscribe, invitations, the AI-assistant
approval page).

## Known limits

- Company sign-in (single sign-on and provider buttons) is not simulated.
- Uploaded files are not kept: a recording plays as silence, and chat and conversation attachments download a
  sample text file.
- Nothing is really sent: messages, invitations and webhooks only change what the screens show.
- State is per server process and resets on restart (or with **Reset sample data**). It is not shared between
  people, and a hot reload keeps it.
- The sample is signed in by default. Use **Signed out** on `/mock` to see the signed-out screens; **Sign out** in
  the app leads to the sign-in page, and signing in leads back.
