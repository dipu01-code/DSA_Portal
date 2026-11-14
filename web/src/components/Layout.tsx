import { useEffect, useRef } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth, useSettings } from '@dsa-portal/ui-core';
import { desktop } from '../platform';
import { SyncStatus } from './SyncStatus';

export function Layout() {
  const { user, logout } = useAuth();
  const { theme, setTheme } = useSettings();
  const navigate = useNavigate();
  const { pathname } = useLocation();
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
          <NavLink to="/">Practice</NavLink>
          <NavLink to="/stats">Stats</NavLink>
          <NavLink to="/leaderboard">Leaderboard</NavLink>
        </nav>
        <span className="spacer" />
        <SyncStatus />
        <label>
          <span className="sr-only">Theme</span>
          <select value={theme} onChange={(e) => setTheme(e.target.value as typeof theme)}>
            <option value="system">System theme</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
        {user ? (
          <button
            type="button"
            onClick={async () => {
              await logout();
              navigate('/login');
            }}
          >
            Log out {user.username}
          </button>
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
