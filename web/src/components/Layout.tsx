import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth, useSettings } from '@dsa-portal/ui-core';
import { desktop } from '../platform';
import { SyncStatus } from './SyncStatus';
import { Icon } from './Icon';

export function Layout() {
  const { user, logout } = useAuth();
  const { theme, setTheme } = useSettings();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const practiceActive = pathname === '/' || pathname.startsWith('/problem/');
  const mainRef = useRef<HTMLElement>(null);
  const firstRender = useRef(true);
  // Focus management: after a route change, screen readers and keyboard users start at the new page.
  useEffect(() => {
    if (firstRender.current) return void (firstRender.current = false);
    if (!mainRef.current?.contains(document.activeElement)) mainRef.current?.focus();
  }, [pathname]);
  // Cmd/Ctrl+K from the desktop menu: back to the topic picker (HomePage focuses it).
  useEffect(() => desktop?.onMenu((a) => a === 'switch-topic' && navigate('/')), [navigate]);
  return (
    <>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <header className="topbar">
        <strong>DSA Practice</strong>
        <nav aria-label="Main">
          {/* A problem page belongs to Practice, so that tab stays highlighted there too. */}
          <Link
            to="/"
            className={practiceActive ? 'active' : undefined}
            aria-current={practiceActive ? 'page' : undefined}
          >
            Practice
          </Link>
          <NavLink to="/stats">Stats</NavLink>
          <NavLink to="/leaderboard">Leaderboard</NavLink>
        </nav>
        <span className="spacer" />
        <SyncStatus />
        <ThemeButton theme={theme} setTheme={setTheme} />
        {user ? (
          <AccountMenu
            username={user.username}
            onLogout={async () => {
              await logout();
              navigate('/login');
            }}
          />
        ) : (
          <NavLink to="/login">Sign in</NavLink>
        )}
      </header>
      <main id="main" tabIndex={-1} ref={mainRef}>
        <Outlet />
      </main>
    </>
  );
}

type Theme = 'light' | 'dark' | 'system';
const THEMES: Theme[] = ['light', 'dark', 'system'];
const THEME_LABEL: Record<Theme, string> = { light: 'Light', dark: 'Dark', system: 'System' };
const THEME_ICON = { light: 'sun', dark: 'moon', system: 'monitor' } as const;

/** One icon button that cycles light → dark → system; the icon shows the current setting. */
function ThemeButton({ theme, setTheme }: { theme: Theme; setTheme(t: Theme): void }) {
  const next = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
  const label = `Theme: ${THEME_LABEL[theme]}. Switch to ${THEME_LABEL[next]}`;
  return (
    <button
      type="button"
      className="icon-button"
      aria-label={label}
      title={label}
      onClick={() => setTheme(next)}
    >
      <Icon name={THEME_ICON[theme]} size={18} />
    </button>
  );
}

/** Avatar with the user's initial; opens a small panel with the username and Log out (Esc or outside click closes). */
function AccountMenu({ username, onLogout }: { username: string; onLogout(): void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const logoutRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    logoutRef.current?.focus();
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);
  return (
    <div
      className="account"
      ref={root}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          setOpen(false);
          toggle.current?.focus();
        }
      }}
    >
      <button
        ref={toggle}
        type="button"
        className="avatar"
        aria-label={`Account: ${username}`}
        aria-expanded={open}
        aria-controls="account-panel"
        onClick={() => setOpen((o) => !o)}
      >
        <span aria-hidden="true">{username.charAt(0).toUpperCase()}</span>
      </button>
      {open && (
        <div id="account-panel" className="card account-panel">
          <p className="small muted">Signed in as</p>
          <p className="account-name">{username}</p>
          <button ref={logoutRef} type="button" onClick={onLogout}>
            Log out
          </button>
        </div>
      )}
    </div>
  );
}
