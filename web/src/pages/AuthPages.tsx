import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useStore } from 'zustand';
import { useAuth } from '@dsa-portal/ui-core';
import { connectivity, desktop } from '../platform';

function useGoHomeWhenSignedIn() {
  const { status } = useAuth();
  const navigate = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from ?? '/';
  useEffect(() => {
    if (status === 'authenticated') navigate(from, { replace: true });
  }, [status, from, navigate]);
}

export function LoginPage() {
  const { login, busy, error } = useAuth();
  const { online } = useStore(connectivity);
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  useGoHomeWhenSignedIn();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void login(email.trim(), password);
  };
  return (
    <form className="card narrow" onSubmit={submit} aria-labelledby="login-title">
      <h1 id="login-title">Sign in</h1>
      <label>
        Email
        <input
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>
      <label>
        Password
        <input
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <button className="primary" disabled={busy || !online}>
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
      <p>
        New here? <Link to="/register">Create an account</Link>
      </p>
      {desktop && !online && (
        <div className="notice">
          <p>
            You are offline. You can still practise with the problems built into the app; results
            stay on this computer.
          </p>
          <button
            type="button"
            onClick={() => {
              connectivity.setState({ offlineGuest: true });
              navigate('/');
            }}
          >
            Practise offline
          </button>
        </div>
      )}
    </form>
  );
}

export function RegisterPage() {
  const { register, busy, error } = useAuth();
  const [form, setForm] = useState({ username: '', email: '', password: '' });
  useGoHomeWhenSignedIn();
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [k]: e.target.value });
  return (
    <form
      className="card narrow"
      aria-labelledby="register-title"
      onSubmit={(e) => {
        e.preventDefault();
        void register(form.username.trim(), form.email.trim(), form.password);
      }}
    >
      <h1 id="register-title">Create an account</h1>
      <label>
        Username
        <input
          autoComplete="username"
          required
          minLength={3}
          maxLength={30}
          value={form.username}
          onChange={set('username')}
        />
      </label>
      <label>
        Email
        <input
          type="email"
          autoComplete="email"
          required
          value={form.email}
          onChange={set('email')}
        />
      </label>
      <label>
        Password
        <input
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={form.password}
          onChange={set('password')}
          aria-describedby="pw-rules"
        />
      </label>
      <p id="pw-rules" className="muted">
        8–72 characters, with a letter and a digit, not containing your username or email.
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <button className="primary" disabled={busy}>
        {busy ? 'Creating…' : 'Create account'}
      </button>
      <p>
        Already registered? <Link to="/login">Sign in</Link>
      </p>
    </form>
  );
}
