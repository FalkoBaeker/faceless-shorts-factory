import { spawn } from 'node:child_process';
import { logEvent } from '../utils/app-logger.ts';

export type AlertSeverity = 'critical' | 'warn' | 'info';

export type AlertInput = {
  severity: AlertSeverity;
  subject: string;
  message: string;
  data?: Record<string, unknown>;
};

export type AlertResult = {
  sent: boolean;
  target: 'email' | 'logs';
  detail: string;
};

const parseCsv = (input: string) =>
  new Set(
    input
      .split(',')
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean)
  );

const alertTarget = () => (process.env.ALERT_TARGET ?? 'logs').trim().toLowerCase();

const emailSeverities = () => parseCsv(process.env.ALERT_EMAIL_SEVERITIES ?? 'critical,warn');

const formatBody = (input: AlertInput) => {
  const lines = [
    `timestamp=${new Date().toISOString()}`,
    `severity=${input.severity}`,
    `message=${input.message}`
  ];

  if (input.data && Object.keys(input.data).length) {
    lines.push(`data=${JSON.stringify(input.data)}`);
  }

  return lines.join('\n');
};

const runCommand = (bin: string, args: string[], stdinBody?: string): Promise<{ stdout: string; stderr: string }> => {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', (error) => {
      reject(error);
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
      } else {
        reject(new Error(`CMD_FAILED:${bin}:${code}:${stderr || stdout}`));
      }
    });

    if (stdinBody !== undefined) {
      child.stdin.write(stdinBody);
    }
    child.stdin.end();
  });
};

let cachedGogAccount: string | null = null;

const resolveGogAccount = async () => {
  if (cachedGogAccount) return cachedGogAccount;

  const envAccount = process.env.GOG_ACCOUNT?.trim();
  if (envAccount) {
    cachedGogAccount = envAccount;
    return cachedGogAccount;
  }

  try {
    const result = await runCommand('gog', ['auth', 'status', '--json']);
    const parsed = JSON.parse(result.stdout) as { account?: { email?: string } };
    const email = parsed?.account?.email?.trim() ?? '';
    cachedGogAccount = email || null;
    return cachedGogAccount;
  } catch {
    cachedGogAccount = null;
    return null;
  }
};

const resolveRecipient = async () => {
  const explicit = process.env.ALERT_EMAIL_TO?.trim();
  if (explicit) return explicit;

  const fallback = await resolveGogAccount();
  return fallback;
};

const sendEmailViaGog = async (subject: string, body: string) => {
  const to = await resolveRecipient();
  if (!to) {
    throw new Error('ALERT_EMAIL_RECIPIENT_MISSING');
  }

  const args = ['gmail', 'send', '--to', to, '--subject', subject, '--body-file', '-'];
  const account = await resolveGogAccount();
  if (account) {
    args.push('--account', account);
  }

  const result = await runCommand('gog', args, body);
  return { to, result };
};

const shouldRouteToEmail = (severity: AlertSeverity) => {
  if (alertTarget() !== 'email') return false;
  return emailSeverities().has(severity);
};

export const sendAlert = async (input: AlertInput): Promise<AlertResult> => {
  const body = formatBody(input);

  if (!shouldRouteToEmail(input.severity)) {
    logEvent({
      event: 'alert_log_only',
      level: input.severity === 'critical' ? 'ERROR' : input.severity === 'warn' ? 'WARN' : 'INFO',
      detail: `${input.subject} | ${input.message}`,
      data: input.data
    });

    return {
      sent: false,
      target: 'logs',
      detail: 'ROUTED_TO_LOGS'
    };
  }

  try {
    const delivery = await sendEmailViaGog(input.subject, body);
    logEvent({
      event: 'alert_email_sent',
      level: 'INFO',
      provider: 'gmail-api',
      detail: `to=${delivery.to} severity=${input.severity}`
    });

    return {
      sent: true,
      target: 'email',
      detail: `EMAIL_SENT:${delivery.to}`
    };
  } catch (error) {
    const detail = String((error as Error)?.message ?? error);
    logEvent({
      event: 'alert_email_failed_fallback_logs',
      level: 'WARN',
      provider: 'gmail-api',
      detail,
      data: { severity: input.severity, subject: input.subject }
    });

    return {
      sent: false,
      target: 'logs',
      detail: `EMAIL_FALLBACK_LOGS:${detail}`
    };
  }
};

export const sendStandardTestAlert = async () => {
  return sendAlert({
    severity: 'warn',
    subject: '[faceless-shorts-factory] test alert',
    message: 'Configured test alert from API',
    data: {
      trigger: 'manual_test',
      allowed: process.env.ALERT_TEST_ALLOWED ?? 'false'
    }
  });
};
