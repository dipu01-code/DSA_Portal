# Day 1 — Person 3: UX design, design system, auth plan

## What was built

- Wireframes for web, desktop and mobile: `docs/design/wireframes.md` (login/register, topic + difficulty, problem view, results, stats, leaderboard, daily challenge, settings with sync status).
- Design tokens (light + dark colours, spacing, radii, type scale, motion) as plain JSON: `ui-core/src/theme/tokens.json`; `toCssVars(mode)` for CSS variables on web/desktop, React Native imports the JSON directly.
- Component inventory and the `/ui-core` folder structure: `docs/design/components.md`.
- Auth design: `docs/design/auth-design.md` (token format, storage per platform, rotation, logout, roles, threat list).
- Spec vs schema mismatches for auth and stats: listed at the end of `auth-design.md` and logged as CR-009, CR-011, CR-012, CR-014, CR-015, CR-016.

## How to check it

`npm test -w ui-core` → `theme.test.ts`: every text colour reaches WCAG AA (4.5:1) on every surface, in both modes.

## For Persons 1 and 2: auth plan and token format

- Access: JWT `{ sub: userId }`, 15 min, `Authorization: Bearer`. Your handlers read `req.user.sub`.
- Refresh: opaque 32-byte token, 7 days, only `sha256` stored in `sessions.token_hash`, rotated on every refresh, reuse revokes all the user's sessions.
- Roles `user` / `admin` are read from `users.role`, not from the token.

## Known issues

- Paths: the pack asks for `/docs/auth-design.md` and `/docs/db/stats-design.md`; those folders aren't Person 3's, so both live in `/docs/design`.

## Design decisions (viva)

- **Tokens as JSON, not CSS:** one source for web CSS variables and React Native style objects.
- **Contrast checked in a test**, not by eye: a palette change that breaks AA fails CI.
- **Refresh token never readable by page JavaScript** on any platform (HttpOnly cookie / OS-encrypted storage): XSS can't steal a long-lived session.
- **Role from the DB, not the JWT:** demotion is immediate; costs one indexed query on admin routes only.
