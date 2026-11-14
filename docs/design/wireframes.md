# Wireframes (Day 1)

Low-fidelity layouts for web, desktop and mobile. Web and desktop share one React UI (`/web`); desktop adds the
connectivity badge and native menu. Mobile (Expo, Day 6) uses single-column stacks of the same screens.
✅ = built (Days 3–5), ⏳ = later day.

## Shared header (web/desktop)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ DSA Practice   Practice  Stats  [Leaderboard⏳]   ● Online   [Theme ▾] [Log out] │
└──────────────────────────────────────────────────────────────────────────────┘
  "Skip to content" link first in tab order; badge only on desktop ("○ Offline: local practice")
```

## Login / register ✅

```
Web / desktop                               Mobile
┌──────────── Sign in ─────────────┐        ┌──────────────┐
│ Email     [_____________________]│        │  Sign in     │
│ Password  [_____________________]│        │ Email [____] │
│ ⚠ Invalid email or password      │        │ Pass  [____] │
│            [ Sign in ]           │        │ [  Sign in ] │
│ New here? Create an account      │        │ Create acct  │
│ ── desktop + offline only ──     │        └──────────────┘
│ You are offline… [Practise offline]│
└──────────────────────────────────┘
Register: Username, Email, Password + rule text (8–72 chars, letter + digit, not your name/email)
```

## Topic + difficulty selection ✅ (Cmd/Ctrl+K jumps here)

```
┌────────────── Practice ──────────────┐   ┌─ Daily challenge ⏳ ─┐
│ Topic       [ Any topic          ▾ ] │   │ Two Sum · Easy       │
│ Difficulty  (•) Any ( ) Easy ( ) Med  │   │ [ Solve today's ]    │
│             ( ) Hard                 │   └──────────────────────┘
│ [ Start ]   ⚠ No problem matches…    │
└──────────────────────────────────────┘
```

## Problem view + results ✅

```
Web / desktop (two columns ≥ 900 px, stacked below)
┌───────────── Description ─────────────┐┌──────────────── Editor (Monaco, JS) ───────────────┐
│ Two Sum            [Easy] [Arrays]    ││ 1 function solve({ nums, target }) {               │
│ Given nums and target, return …       ││ 2   …                                              │
│ Examples                              ││                                                    │
│  input: {"nums":[2,7],"target":9}     │└────────────────────────────────────────────────────┘
│  output: [0,1]                        │ [Run tests ⌘↵] [Submit ⌘⇧↵] [Reset code]
│ Hints                                 │┌──────────────── Results ───────────────────────────┐
│  1. Brute force is O(n²)…             ││ Accepted · 5/5 passed                              │
│ [Show hint 2 of 3]                    ││ # │ Result │ Expected │ Actual                     │
│ Solution                              ││ 1 │ ✓ pass │ [0,1]    │ [0,1]                      │
│ [Reveal solution…] → confirm dialog   ││ 2 │ ✗ fail │ [1,2]    │ Error: …                   │
└───────────────────────────────────────┘└────────────────────────────────────────────────────┘
Mobile: tabs [Problem | Code | Results]; Submit is a sticky bottom button; editor full width.
```

## Stats dashboard ✅

```
┌ Solved 12/40 ┐┌ Attempted 15 ┐┌ Accuracy 80% ┐┌ Streak 3 d (longest 5) ┐
┌──────────── By topic (bars: Attempted / Solved, legend, tooltip with accuracy) ────────────┐
┌──────────── By difficulty ─────────────────────────────────────────────────────────────────┐
▸ Show as table
┌──────────── Streak calendar (12 weeks × 7 days, filled = first solve that day, UTC) ────────┐
Empty state: "No attempts yet…"  ·  Loading: skeleton tiles  ·  Error: message + [Try again]
Mobile: tiles 2×2, charts full width, calendar scrolls horizontally.
```

## Leaderboard ⏳ (Day 7)

```
┌ Rank │ User      │ Solved │ Score ┐   your row highlighted; [Load more] (cursor pagination)
│ 1    │ ada       │ 31     │ 940   │
```

## Settings with sync status ⏳ (Day 8)

```
┌──────────────── Settings ────────────────┐
│ Theme        (•) System ( ) Light ( ) Dark│   ← theme already in the header (✅)
│ Editor font  [14] px                      │
│ Sync         ● Synced 2 min ago           │   states: online · offline · syncing · error
│              3 submissions waiting [Sync now]│
│ Server       http://localhost:3000        │   (desktop only)
└───────────────────────────────────────────┘
```
