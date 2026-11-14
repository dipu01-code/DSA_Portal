# DSA Practice — user manual

DSA Practice helps you practise data structures and algorithms: pick a topic and a difficulty, get a problem, write JavaScript, run it against the examples and submit it to be judged. It works in the **browser**, as a **desktop app** (Windows, macOS, Linux) and on **Android**, all with the same account.

Screenshots referenced as **[S1]**…: see the list at the end.

## 1. Getting started

### Install

| App     | How                                                                                                                                                        |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web     | Open the address your course gives you (e.g. `https://dsa.example.edu`).                                                                                   |
| macOS   | Open `DSA-Practice-0.0.1-arm64.dmg`, drag **DSA Practice** to Applications. First start: right-click → **Open** (the course build is not signed by Apple). |
| Windows | Run `DSA-Practice-Setup-0.0.1.exe`. If Windows says "protected your PC": **More info → Run anyway**.                                                       |
| Linux   | `chmod +x DSA-Practice-0.0.1-x86_64.AppImage` and run it.                                                                                                  |
| Android | Copy `app-release.apk` to the phone, open it, allow "install unknown apps" for your file manager.                                                          |

### Create an account and sign in **[S1] [S2]**

1. Choose **Create an account**. Username 3–30 characters; the password needs 8–72 characters with a letter and a digit, and must not contain your username or email.
2. You are signed in straight away. The app remembers you: next time it opens signed in (the web app for 7 days of inactivity).
3. **Log out** is at the top right (web/desktop) or in the tab header (Android).

## 2. Practising

### Pick a problem **[S3]**

On **Practice**, choose a **topic** (Arrays, Strings, Graphs, Trees, Dynamic Programming, …) and a **difficulty** (Easy, Medium, Hard, or Any), then **Start**. A random matching problem opens. The **Daily challenge** card above it opens today's problem for everyone.

### Solve it **[S4]**

- The left side has the description and examples (input → expected output).
- **Hints** appear one at a time ("Show hint 1 of 3"). Use them before the solution.
- Write a function `solve(input)` in the editor. `input` is the object shown in the examples.
- **Run tests** (Ctrl/Cmd+Enter) runs your code on the visible examples on your own device: quick feedback, not graded.
- **Submit** sends your code to be judged against all test cases on the server. You see "Judging…", then **Accepted** or **Wrong answer** with a row per test case (expected vs. your output, or the error) **[S5]**.
- **Reveal solution…** asks you to confirm; the reference solution unlocks once you have solved the problem.
- **Reset code** puts the starter code back.

## 3. Your progress **[S6]**

**Stats** shows problems solved (of all problems), attempted, accuracy (solved ÷ attempted) and your streak, then charts by topic and by difficulty (also as a table under "Show as table") and a 12-week calendar. A streak day is a UTC day on which you solved a problem for the first time.

**Leaderboard** ranks everyone by problems solved, then score (Easy 1, Medium 2, Hard 3). Your row is highlighted. **Load more** shows the next 50 **[S7]**.

## 4. Working offline **[S8] [S9]**

The badge in the header (desktop/web) or the bar at the top (Android) always tells you where you are:

| Badge                | Meaning                                                  |
| -------------------- | -------------------------------------------------------- |
| ● Online             | Connected.                                               |
| ○ Offline · 2 queued | No connection; 2 submissions are waiting on this device. |
| ↻ Syncing 2…         | Back online, sending and judging what was queued.        |
| ! Sync problem       | Something needs your attention: open the badge.          |

What still works offline:

- **Desktop:** everything for practice: all problems are built in, Run and Submit are judged on your computer, hints work, and the solution unlocks when you solve it. Results are marked "Judged on this computer".
- **Web and Android:** problems you opened before ("On this device" / "On this phone" on Practice), and Run tests (web). **Submit** is queued.
- Stats and the leaderboard need a connection.

When the connection returns, queued submissions are sent automatically (or press **Sync now**) and judged by the server; **the server's result is the one that counts**. Open the badge (Android: **Settings → Sync**) to see each one:

- _Waiting to sync_ → _Sending and judging…_ → **Synced · Accepted 5/5**
- **Conflict**: your offline run and the server disagree (e.g. a time limit). The server's verdict counts.
- **Not accepted**: the server refused it (e.g. the problem was removed).
- **Clear finished** removes the finished entries.
  If your session ended while you were offline, you are asked to sign in; your queued work is kept and syncs after sign-in. Queued work belongs to the account that made it; another person signing in on the same device does not see it.

On desktop you can also **Practise offline** without signing in when the server can't be reached; that work syncs to the account you sign in with next.

## 5. Settings

- **Theme:** System, Light or Dark (header select on web/desktop; **Settings** tab on Android). Remembered on the device.
- **Keyboard (desktop/web):** Ctrl/Cmd+Enter run tests, Ctrl/Cmd+K jump to the topic picker, Tab/Shift+Tab move between controls, Esc closes dialogs and the sync panel. "Skip to content" is the first Tab stop.
- **Screen readers:** all controls are labelled; results, sync changes and errors are announced.

## 6. Troubleshooting

| Problem                        | Try                                                                                                                                                |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| "No connection to the server…" | Check your network; on Android check the API address the app was built with.                                                                       |
| "Invalid email or password"    | Check both; after several failures wait a few minutes (sign-in is rate-limited).                                                                   |
| "Judging is taking too long"   | The judge is busy. The submission is still judged and counts in Stats when done; check Stats later.                                                |
| macOS: "cannot be opened"      | Right-click the app → Open.                                                                                                                        |
| Desktop data location          | macOS `~/Library/Application Support/DSA Practice`, Windows `%APPDATA%\DSA Practice`, Linux `~/.config/DSA Practice` (tokens there are encrypted). |

## Screenshots to take (for this manual and the report)

Take each in light and dark mode where marked (L/D); web at 1280×800, desktop at the default window, Android on the Pixel 7 emulator.

| #   | Platform      | Screen              | State to show                                      |
| --- | ------------- | ------------------- | -------------------------------------------------- |
| S1  | web           | Create an account   | form filled, password rules visible                |
| S2  | web           | Sign in             | the "Invalid email or password" error              |
| S3  | web (L/D)     | Practice            | topic + difficulty chosen, daily-challenge card    |
| S4  | desktop (L/D) | Problem             | 2 hints shown, code in the editor                  |
| S5  | web           | Problem → Results   | "Accepted · 5/5 passed" with test rows             |
| S6  | web (L/D)     | Stats               | tiles, topic chart, calendar with a streak         |
| S7  | Android       | Leaderboard         | your row highlighted                               |
| S8  | desktop       | header + sync panel | "○ Offline · 1 queued", panel open                 |
| S9  | desktop       | sync panel          | "Synced · Accepted 5/5" after reconnecting         |
| S10 | Android       | Practice offline    | sync bar + "On this phone" list                    |
| S11 | Android       | Problem             | queued message, then "Synced · Accepted"           |
| S12 | Android (D)   | Settings            | Theme chips + Sync list                            |
| S13 | macOS         | first launch        | Gatekeeper "Open" dialog (for the install section) |
| S14 | Windows       | installer           | NSIS choose-folder page                            |

Two screenshots already produced by the automated tests: `desktop/test-results/offline-solved.png` (S4-like, offline) and `desktop/test-results/synced.png` (S9).
