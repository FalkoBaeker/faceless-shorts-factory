import type { IncomingMessage } from 'node:http';
import { logEvent } from '../utils/app-logger.ts';
import type { AuthIdentity } from './entitlement-service.ts';

type AuthConfig = {
  supabaseUrl: string;
  supabaseAnonKey: string;
  supabaseServiceRoleKey: string;
  authMethod: string;
};

type RawUser = {
  id: string;
  email?: string;
  app_metadata?: Record<string, unknown>;
  user_metadata?: Record<string, unknown>;
};

type AuthSessionPayload = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  user?: RawUser;
  session?: {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    user?: RawUser;
  };
  id?: string;
  email?: string;
  app_metadata?: Record<string, unknown>;
  user_metadata?: Record<string, unknown>;
  error_description?: string;
  msg?: string;
};

export type AuthSessionResult = {
  accessToken: string | null;
  refreshToken: string | null;
  expiresIn: number | null;
  user: AuthIdentity;
  requiresEmailConfirmation: boolean;
};

const config: AuthConfig = {
  supabaseUrl: process.env.SUPABASE_URL ?? '',
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY ?? '',
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
  authMethod: process.env.AUTH_METHOD ?? 'email'
};

const boolFromEnv = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined) return fallback;
  return value.trim().toLowerCase() === 'true';
};

export const authConfigured = () => Boolean(config.supabaseUrl && config.supabaseAnonKey && config.supabaseServiceRoleKey);

export const authRequired = () => {
  const fallback = authConfigured();
  return boolFromEnv(process.env.AUTH_REQUIRED, fallback);
};

const ensureAuthConfigured = () => {
  if (!authConfigured()) {
    throw new Error('AUTH_CONFIG_MISSING:SUPABASE_URL/SUPABASE_ANON_KEY/SUPABASE_SERVICE_ROLE_KEY');
  }
};

const authHeaders = (mode: 'anon' | 'service', accessToken?: string) => {
  const key = mode === 'service' ? config.supabaseServiceRoleKey : config.supabaseAnonKey;
  return {
    apikey: key,
    Authorization: accessToken ? `Bearer ${accessToken}` : `Bearer ${key}`,
    'Content-Type': 'application/json'
  };
};

const supabaseAuthJson = async (path: string, init: RequestInit, mode: 'anon' | 'service') => {
  ensureAuthConfigured();

  const response = await fetch(`${config.supabaseUrl}${path}`, {
    ...init,
    headers: {
      ...authHeaders(mode),
      ...(init.headers ?? {})
    }
  });

  const raw = await response.text();
  let parsed: Record<string, unknown> | null = null;
  if (raw) {
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      parsed = { raw };
    }
  }

  if (!response.ok) {
    const detail =
      String(parsed?.error_description ?? parsed?.msg ?? parsed?.error ?? parsed?.message ?? response.statusText) ||
      'AUTH_PROVIDER_ERROR';
    throw new Error(`AUTH_PROVIDER_${response.status}:${detail}`);
  }

  return parsed ?? {};
};

const normalizeIdentity = (rawUser: RawUser | null | undefined): AuthIdentity => {
  if (!rawUser?.id) {
    throw new Error('AUTH_INVALID_USER_PAYLOAD');
  }

  return {
    id: rawUser.id,
    email: String(rawUser.email ?? ''),
    appMetadata: rawUser.app_metadata ?? {},
    userMetadata: rawUser.user_metadata ?? {}
  };
};

const extractRawUser = (raw: AuthSessionPayload): RawUser | null => {
  if (raw.user?.id) {
    return raw.user;
  }

  if (raw.session?.user?.id) {
    return raw.session.user;
  }

  if (raw.id) {
    return {
      id: raw.id,
      email: raw.email,
      app_metadata: raw.app_metadata,
      user_metadata: raw.user_metadata
    };
  }

  return null;
};

const parseSession = (payload: Record<string, unknown>): AuthSessionResult => {
  const raw = payload as AuthSessionPayload;
  const session = raw.session;

  const rawUser = extractRawUser(raw);
  if (!rawUser) {
    throw new Error('AUTH_SESSION_USER_MISSING');
  }

  const user = normalizeIdentity(rawUser);
  const accessToken = raw.access_token ?? session?.access_token ?? null;
  const refreshToken = raw.refresh_token ?? session?.refresh_token ?? null;
  const expiresInRaw = raw.expires_in ?? session?.expires_in;

  return {
    accessToken,
    refreshToken,
    expiresIn: typeof expiresInRaw === 'number' ? expiresInRaw : null,
    user,
    requiresEmailConfirmation: !accessToken
  };
};

export const signupWithEmailPassword = async (email: string, password: string): Promise<AuthSessionResult> => {
  if (config.authMethod !== 'email') {
    throw new Error(`AUTH_METHOD_UNSUPPORTED:${config.authMethod}`);
  }

  const payload = await supabaseAuthJson(
    '/auth/v1/signup',
    {
      method: 'POST',
      headers: authHeaders('anon'),
      body: JSON.stringify({ email, password })
    },
    'anon'
  );

  return parseSession(payload);
};

export const loginWithEmailPassword = async (email: string, password: string): Promise<AuthSessionResult> => {
  if (config.authMethod !== 'email') {
    throw new Error(`AUTH_METHOD_UNSUPPORTED:${config.authMethod}`);
  }

  const payload = await supabaseAuthJson(
    '/auth/v1/token?grant_type=password',
    {
      method: 'POST',
      headers: authHeaders('anon'),
      body: JSON.stringify({ email, password })
    },
    'anon'
  );

  return parseSession(payload);
};

export const getUserFromAccessToken = async (accessToken: string): Promise<AuthIdentity> => {
  const payload = await supabaseAuthJson(
    '/auth/v1/user',
    {
      method: 'GET',
      headers: {
        ...authHeaders('service'),
        Authorization: `Bearer ${accessToken}`
      }
    },
    'service'
  );

  return normalizeIdentity(payload as RawUser);
};

export const readBearerToken = (req: IncomingMessage): string | null => {
  const header = req.headers.authorization;
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  if (!scheme || !token) return null;
  if (scheme.toLowerCase() !== 'bearer') return null;
  return token.trim();
};

export const resolveRequestUser = async (req: IncomingMessage): Promise<AuthIdentity | null> => {
  const token = readBearerToken(req);
  if (!token) return null;

  try {
    return await getUserFromAccessToken(token);
  } catch (error) {
    logEvent({
      event: 'auth_token_invalid',
      level: 'WARN',
      detail: String((error as Error)?.message ?? error)
    });
    throw error;
  }
};

export const requireRequestUser = async (req: IncomingMessage): Promise<AuthIdentity> => {
  const user = await resolveRequestUser(req);
  if (!user) throw new Error('AUTH_REQUIRED');
  return user;
};
