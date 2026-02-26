'use client';

import { useEffect, useMemo, useState } from 'react';
import { fetchMe, login, signUp, type ApiError, type AuthMePayload } from '../lib/api-client';
import { readStoredToken, storeToken } from '../lib/session-store';

type Mode = 'login' | 'signup';

const toErrorMessage = (error: unknown) => {
  if (!error || typeof error !== 'object') return 'Unknown error';
  const api = error as Partial<ApiError>;
  if (api.message) return api.message;
  return String(error);
};

export function AuthPanel() {
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const [me, setMe] = useState<AuthMePayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>('');

  useEffect(() => {
    const existing = readStoredToken();
    if (existing) {
      setToken(existing);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const payload = await fetchMe(token);
        if (!cancelled) {
          setMe(payload);
          if (!payload.authenticated && token) {
            storeToken(null);
            setToken(null);
          }
        }
      } catch (error) {
        if (!cancelled) {
          setMessage(`Auth status error: ${toErrorMessage(error)}`);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [token]);

  const authSummary = useMemo(() => {
    if (!me) return 'Lade Auth-Status ...';
    if (!me.authenticated) return me.authRequired ? 'Nicht eingeloggt (Auth required)' : 'Auth optional';
    return `Eingeloggt als ${me.user?.email ?? 'unknown'} · plan=${me.user?.plan ?? 'n/a'} · canRunJob=${me.canRunJob}`;
  }, [me]);

  const submit = async () => {
    if (!email || password.length < 8) {
      setMessage('Bitte gültige Email und Passwort (>=8 Zeichen) eingeben.');
      return;
    }

    setBusy(true);
    setMessage('');
    try {
      const payload = mode === 'signup' ? await signUp(email, password) : await login(email, password);
      if (payload.accessToken) {
        storeToken(payload.accessToken);
        setToken(payload.accessToken);
      }

      if (payload.requiresEmailConfirmation) {
        setMessage('Signup ok, bitte Email bestätigen (kein Access Token zurückgegeben).');
      } else {
        setMessage(`Auth ok · canRunJob=${payload.canRunJob} · reason=${payload.reason}`);
      }
    } catch (error) {
      setMessage(`Auth failed: ${toErrorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const logout = () => {
    storeToken(null);
    setToken(null);
    setMe(null);
    setMessage('Ausgeloggt');
  };

  return (
    <section className="section-card" aria-labelledby="auth-panel-title">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
        <h2 id="auth-panel-title" className="section-title" style={{ margin: 0 }}>
          Supabase Auth (MVP)
        </h2>
        <span className={`chip ${me?.authenticated ? 'chip-success' : 'chip-neutral'}`}>
          {me?.authenticated ? 'authenticated' : 'not authenticated'}
        </span>
      </div>

      <p className="section-copy">{authSummary}</p>

      <div className="auth-form-grid">
        <label className="auth-field">
          <span>Email</span>
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
          />
        </label>

        <label className="auth-field">
          <span>Passwort</span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Mindestens 8 Zeichen"
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
          />
        </label>
      </div>

      <div className="state-toggle-row">
        <button type="button" className={`state-toggle ${mode === 'login' ? 'active' : ''}`} onClick={() => setMode('login')}>
          Login
        </button>
        <button type="button" className={`state-toggle ${mode === 'signup' ? 'active' : ''}`} onClick={() => setMode('signup')}>
          Signup
        </button>
      </div>

      <div className="action-row">
        <button className="button" type="button" onClick={submit} disabled={busy}>
          {busy ? 'Läuft ...' : mode === 'signup' ? 'Signup starten' : 'Login starten'}
        </button>
        <button className="button-ghost" type="button" onClick={logout}>
          Logout
        </button>
      </div>

      {message ? <p className="section-copy" style={{ marginTop: 0 }}>{message}</p> : null}
    </section>
  );
}
