import { getBootstrapConfig } from '../contexts/BootstrapContext';

type AuthMode = 'login' | 'register';

export type TokenResponse = {
  access_token: string;
  id_token: string;
  expires_in: number;
  refresh_token?: string;
  refresh_expires_in?: number;
  token_type: string;
  scope?: string;
};

// All auth/OIDC URLs from bootstrap only (only Control Plane URL is from env).
function getOidcIssuer(): string {
  const config = getBootstrapConfig();
  return config?.auth_provider?.issuer ?? '';
}

function getOidcClientId(): string {
  const config = getBootstrapConfig();
  return config?.auth_provider?.client_id ?? '';
}

const STORAGE_STATE_KEY = 'synaptagrid_oidc_state';
const STORAGE_VERIFIER_KEY = 'synaptagrid_oidc_verifier';

/** Redirect URI from bootstrap only (AuthN central callback; final app URL is in state). */
function getRedirectUri(): string {
  const config = getBootstrapConfig();
  const redirect = config?.auth_provider?.redirect_uri;
  if (redirect && typeof redirect === 'string' && redirect.trim()) return redirect.trim();
  const authnBase = config?.services?.authn_url;
  if (authnBase && typeof authnBase === 'string' && authnBase.trim()) {
    const base = authnBase.trim().replace(/\/+\s*$/, '');
    return `${base}/v1/authn/oauth/callback`;
  }
  return '';
}

function randomString(size = 32) {
  const cryptoObj = window.crypto;
  if (cryptoObj && cryptoObj.getRandomValues) {
    const values = new Uint8Array(size);
    cryptoObj.getRandomValues(values);
    return Array.from(values, (value) => value.toString(16).padStart(2, '0')).join('');
  }

  let result = '';
  for (let i = 0; i < size; i += 1) {
    result += Math.floor(Math.random() * 16).toString(16);
  }
  return result;
}

function base64UrlEncode(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sha256(value: string) {
  const cryptoObj = window.crypto;
  if (!cryptoObj || !cryptoObj.subtle) {
    return { challenge: value, method: 'plain' as const };
  }

  const encoded = new TextEncoder().encode(value);
  const digest = await cryptoObj.subtle.digest('SHA-256', encoded);
  return { challenge: base64UrlEncode(digest), method: 'S256' as const };
}

function buildAuthParams({
  mode,
  state,
  codeChallenge,
}: {
  mode: AuthMode;
  state: string;
  codeChallenge: string;
}) {
  const params = new URLSearchParams({
    client_id: getOidcClientId(),
    redirect_uri: getRedirectUri(),
    response_type: 'code',
    scope: 'openid email profile',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
  });

  if (mode === 'register') {
    params.set('prompt', 'login');
  }

  return params;
}

export function getAuthRedirectUrl() {
  return getRedirectUri();
}

type LoginResponse = { authorization_url: string };

async function fetchAuthUrl(provider: 'google' | 'github' | 'twitter' | 'microsoft', returnUrl: string): Promise<string> {
  const config = getBootstrapConfig();
  const authnUrl = (config?.services?.authn_url ?? '').replace(/\/$/, '');
  if (!authnUrl) {
    throw new Error('AuthN URL not configured');
  }
  const url = `${authnUrl}/v1/authn/login/${provider}?return_url=${encodeURIComponent(returnUrl)}`;
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) {
    const text = await res.text();
    console.error('[Auth] Social login failed', { provider, status: res.status, responseText: text });
    let userMessage = 'Sign-in is not available right now. Try another option or contact your administrator.';
    if (text) {
      try {
        const json = JSON.parse(text) as { message?: string; detail?: string };
        const msg = json.message ?? json.detail;
        if (typeof msg === 'string' && msg.length < 300) userMessage = msg;
      } catch {
        if (text.length < 300) userMessage = text;
      }
    }
    throw new Error(userMessage);
  }
  const data: LoginResponse = await res.json();
  if (!data?.authorization_url) {
    throw new Error('Invalid response from auth service');
  }
  return data.authorization_url;
}

/**
 * Fetch Google login URL from AuthN and redirect. Use when bootstrap has social_providers including "google".
 */
export async function redirectToGoogle(returnUrl: string): Promise<void> {
  const authorizationUrl = await fetchAuthUrl('google', returnUrl);
  window.location.href = authorizationUrl;
}

/**
 * Fetch GitHub login URL from AuthN and redirect. Use when bootstrap has social_providers including "github".
 */
export async function redirectToGitHub(returnUrl: string): Promise<void> {
  const authorizationUrl = await fetchAuthUrl('github', returnUrl);
  window.location.href = authorizationUrl;
}

/**
 * Fetch X (Twitter) login URL from AuthN and redirect. Use when bootstrap has social_providers including "twitter".
 */
export async function redirectToTwitter(returnUrl: string): Promise<void> {
  const authorizationUrl = await fetchAuthUrl('twitter', returnUrl);
  window.location.href = authorizationUrl;
}

/**
 * Fetch Microsoft login URL from AuthN and redirect. Use when bootstrap has social_providers including "microsoft".
 */
export async function redirectToMicrosoft(returnUrl: string): Promise<void> {
  const authorizationUrl = await fetchAuthUrl('microsoft', returnUrl);
  window.location.href = authorizationUrl;
}

export async function startAuthRedirect(mode: AuthMode) {
  const state = randomString(16);
  const verifier = randomString(64);
  const { challenge, method } = await sha256(verifier);

  sessionStorage.setItem(STORAGE_STATE_KEY, state);
  sessionStorage.setItem(STORAGE_VERIFIER_KEY, verifier);

  const config = getBootstrapConfig();
  const AUTH_ENDPOINT = config?.auth_provider?.authorization_endpoint ?? '';
  if (!AUTH_ENDPOINT) {
    throw new Error('Authorization endpoint not available. Check bootstrap config.');
  }
  
  const params = buildAuthParams({ mode, state, codeChallenge: challenge });
  params.set('code_challenge_method', method);
  
  console.log('[OIDC] Redirecting to auth endpoint:', AUTH_ENDPOINT);
  window.location.assign(`${AUTH_ENDPOINT}?${params.toString()}`);
}

export async function exchangeCodeForTokens({
  code,
  state,
}: {
  code: string;
  state: string;
}) {
  const expectedState = sessionStorage.getItem(STORAGE_STATE_KEY);
  const verifier = sessionStorage.getItem(STORAGE_VERIFIER_KEY);

  if (!expectedState || expectedState !== state || !verifier) {
    throw new Error('Invalid auth state');
  }

  const config = getBootstrapConfig();
  const TOKEN_ENDPOINT = config?.auth_provider?.token_endpoint ?? '';
  if (!TOKEN_ENDPOINT) {
    throw new Error('Token endpoint not available. Check bootstrap config.');
  }

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: getOidcClientId(),
    code,
    redirect_uri: getRedirectUri(),
    code_verifier: verifier,
  });

  console.log('[OIDC] Exchanging code for tokens at:', TOKEN_ENDPOINT);

  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!response.ok) {
    throw new Error('Token exchange failed');
  }

  const data = (await response.json()) as TokenResponse;
  return data;
}

export async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const config = getBootstrapConfig();
  const TOKEN_ENDPOINT = config?.auth_provider?.token_endpoint ?? '';
  if (!TOKEN_ENDPOINT) {
    throw new Error('Token endpoint not available.');
  }
  
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: getOidcClientId(),
    refresh_token: refreshToken,
  });
  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!response.ok) {
    throw new Error('Token refresh failed');
  }
  const data = (await response.json()) as TokenResponse;
  return data;
}

export type CredentialsLoginResponse = {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in: number;
  user_guid: string;
  org_guid: string;
  email: string;
  role?: string;
  org_name?: string;
};

/**
 * Login with email + password via AuthN (no IdP page). AuthN authenticates
 * against the IdP server-side and returns enriched tokens.
 * Passes client_id and hostname from bootstrap so AuthN fetches IdP credentials from Control Plane.
 */
export async function loginWithCredentials(email: string, password: string): Promise<CredentialsLoginResponse> {
  const config = getBootstrapConfig();
  const authnUrl = (config?.services?.authn_url ?? '').replace(/\/$/, '');
  if (!authnUrl) {
    throw new Error('AuthN service not available.');
  }
  const body: { email: string; password: string; client_id?: string; hostname?: string } = { email, password };
  if (config?.auth_provider?.client_id) body.client_id = config.auth_provider.client_id;
  if (typeof window !== 'undefined' && window.location?.hostname) body.hostname = window.location.hostname;
  const response = await fetch(`${authnUrl}/v1/authn/login/credentials`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    let message = 'Sign-in failed. Check your email and password.';
    try {
      const err = await response.json();
      if (err.detail && typeof err.detail === 'string' && err.detail.length < 300) {
        message = err.detail;
      }
    } catch { /* use default */ }
    throw new Error(message);
  }
  return (await response.json()) as CredentialsLoginResponse;
}
