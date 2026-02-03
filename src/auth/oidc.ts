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

const OIDC_ISSUER =
  process.env.REACT_APP_OIDC_ISSUER || 'http://host.docker.internal:8081/realms/synaptagrid';
const OIDC_CLIENT_ID = 'synaptagrid-local';
const TOKEN_ENDPOINT = `${OIDC_ISSUER}/protocol/openid-connect/token`;
const AUTH_ENDPOINT = `${OIDC_ISSUER}/protocol/openid-connect/auth`;
const REDIRECT_URI =
  process.env.REACT_APP_OIDC_REDIRECT_URI || `${window.location.origin}/auth/callback`;

const STORAGE_STATE_KEY = 'synaptagrid_oidc_state';
const STORAGE_VERIFIER_KEY = 'synaptagrid_oidc_verifier';

function getRedirectUri() {
  return REDIRECT_URI;
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
    client_id: OIDC_CLIENT_ID,
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

export async function startAuthRedirect(mode: AuthMode) {
  const state = randomString(16);
  const verifier = randomString(64);
  const { challenge, method } = await sha256(verifier);

  sessionStorage.setItem(STORAGE_STATE_KEY, state);
  sessionStorage.setItem(STORAGE_VERIFIER_KEY, verifier);

  const params = buildAuthParams({ mode, state, codeChallenge: challenge });
  params.set('code_challenge_method', method);
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

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: OIDC_CLIENT_ID,
    code,
    redirect_uri: getRedirectUri(),
    code_verifier: verifier,
  });

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
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: OIDC_CLIENT_ID,
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
