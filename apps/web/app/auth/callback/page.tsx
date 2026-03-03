'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabaseBrowserClient } from '../../lib/supabase-browser';
import { storeToken } from '../../lib/session-store';

export default function AuthCallbackPage() {
  const router = useRouter();
  const [message, setMessage] = useState('OAuth callback wird verarbeitet ...');

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const code = new URLSearchParams(window.location.search).get('code');
      if (!code) {
        setMessage('OAuth callback enthält keinen Code.');
        return;
      }

      try {
        const supabase = getSupabaseBrowserClient();
        const { data, error } = await supabase.auth.exchangeCodeForSession(code);

        if (error) throw error;

        const accessToken = data?.session?.access_token ?? null;
        storeToken(accessToken);

        if (!cancelled) {
          setMessage('Login erfolgreich. Weiterleitung ...');
          router.replace('/');
        }
      } catch (error) {
        if (!cancelled) {
          const detail = String((error as Error)?.message ?? error);
          if (detail.includes('PKCE code verifier not found')) {
            setMessage(
              'OAuth callback fehlgeschlagen: PKCE verifier fehlt. Bitte Login erneut starten und dabei auf demselben Host bleiben (z. B. nur localhost:3000, nicht zwischen localhost und 127.0.0.1 wechseln), denselben Tab verwenden und keine Storage/Cookies löschen.'
            );
          } else {
            setMessage(`OAuth callback fehlgeschlagen: ${detail}`);
          }
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <main style={{ maxWidth: 680, margin: '40px auto', padding: 20 }}>
      <h1 style={{ marginBottom: 8 }}>Google Sign-In Callback</h1>
      <p>{message}</p>
    </main>
  );
}
