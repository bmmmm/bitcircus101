# bitcircus101 on rails

Buildless subpage at `/anmeldung/`. Run `pnpm dev` in the repository root and open
<http://localhost:8080/anmeldung/>. The local server stays running until Ctrl+C.

The date is confirmed: **23 January 2027, arrival 11:00 Europe/Berlin**, at
**bitcircus 101, Dorotheenstraße 101, Bonn**. End time and what to bring remain open. Shared event details live in
`event.mjs`. Visible date/title copies in both HTML files should be updated if
the event changes, so they remain useful without JavaScript.

## Preview

`registrationMode: 'preview'` is intentional. The form validates and opens a
clearly labelled preview ticket. It does not call an API, send emails or store a
registration. A first name passes through sessionStorage to the next page and
is removed immediately when read. Surname and email never enter browser storage
or URLs. A direct ticket-page visit shows generic event information.

The CSS uses the existing site's fonts, colours and themes. The inline SVG is
hand-authored. Its single 3.2-second entrance is optional; a reduced-motion
preference shows the parked train immediately. No external font, image, tracking
or animation dependency is loaded. The shared stylesheet benefits from caching
when arriving from the main site.

## Real registrations

The current GitHub Pages deployment serves static files only. It **does not run**
`functions/api/anmelden.js`. Do not switch to live mode on GitHub Pages without
also routing `/api/anmelden` to a functioning backend on the same origin.

An adapter for **Cloudflare Pages Functions** is included:

1. Deploy the static repository and its `functions/` directory with Cloudflare
   Pages, or adapt the handler in `server/registration.mjs` to a same-origin
   Cloudflare Worker route on the existing domain.
2. Create a D1 database, apply `server/schema.sql` and bind it as `DB`.
3. Set the secret `RESEND_API_KEY` and a verified sender in `REGISTRATION_FROM`.
   Keys stay server-side. Use a sender/domain you control; no sender is assumed.
4. Confirm the missing event details in `event.mjs`, and the wording and
   retention policy below. Add the confirmed details to the static HTML copies.
5. Set `registrationMode: 'live'`, test a real registration, its email, duplicate
   handling and retry after mail failure. Preview mode fails closed at the API.

The handler stores a pending registration, sends its confirmation and then marks
the email as sent. Failed sends can be retried; the same Resend idempotency key
prevents duplicate mail on short retries. A UNIQUE constraint covers event/email.
“Already on the list” is returned only for registrations with a sent email.
Actual inbox delivery is subject to the mail provider.

The retention period remains an operational decision. Before opening registration,
confirm a retention policy and arrange a deletion job (including backups
and mail-provider retention as applicable); no scheduled cleanup is installed by
this local feature. The D1 cleanup query for this event is:

```sql
DELETE FROM registrations WHERE event_id = 'bitcircus101-on-rails-2027';
```

`_headers` sets `Cache-Control: no-store` for the ticket on Cloudflare Pages.
For the existing GitHub Pages setup, apply that header at the Cloudflare proxy;
GitHub Pages ignores `_headers`. The local preview server sets the header too.

## Validation

`pnpm run test:quick` includes API validation/retry tests and calendar formatting.
`pnpm run test:e2e --grep 'On rails'` covers the browser flow on desktop and
mobile, including reduced motion, validation, preview, calendar download,
server errors and unavailable storage. Browser tests send no real email.
