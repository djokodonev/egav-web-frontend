/**
 * Persist access and refresh tokens in cookies so the FE can send Bearer on all API requests.
 * Cookies are readable by JS (not HttpOnly) and set for the parent domain so they are
 * available across marketing site, portal, and other apps on the same domain.
 */

const COOKIE_NAME =
  process.env.REACT_APP_ACCESS_TOKEN_COOKIE_NAME || 'synaptagrid_access_token';
const REFRESH_COOKIE_NAME =
  process.env.REACT_APP_REFRESH_TOKEN_COOKIE_NAME || 'synaptagrid_refresh_token';

/**
 * Get the parent domain for cookie sharing across subdomains (e.g. .synaptagrid.io).
 * Returns null for localhost or single-label hostnames.
 */
function getCookieDomain(): string | null {
  const envDomain = process.env.REACT_APP_ACCESS_TOKEN_COOKIE_DOMAIN;
  if (envDomain) {
    return envDomain.startsWith('.') ? envDomain : `.${envDomain}`;
  }
  const hostname = window.location.hostname;
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return null;
  }
  const parts = hostname.split('.');
  if (parts.length >= 2) {
    return `.${parts.slice(-2).join('.')}`;
  }
  return null;
}

export function setAccessTokenCookie(value: string, maxAgeSeconds: number): void {
  const secure = window.location.protocol === 'https:';
  const parts = [
    `${encodeURIComponent(COOKIE_NAME)}=${encodeURIComponent(value)}`,
    'path=/',
    `max-age=${maxAgeSeconds}`,
    'SameSite=Lax',
  ];
  const domain = getCookieDomain();
  if (domain) {
    parts.push(`domain=${domain}`);
  }
  if (secure) {
    parts.push('Secure');
  }
  document.cookie = parts.join('; ');
}

export function getAccessTokenCookie(): string | null {
  const name = encodeURIComponent(COOKIE_NAME);
  const cookies = document.cookie.split(';');
  for (const cookie of cookies) {
    const trimmed = cookie.trim();
    if (trimmed.startsWith(`${name}=`)) {
      const value = trimmed.slice(name.length + 1).trim();
      try {
        return decodeURIComponent(value) || null;
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function clearAccessTokenCookie(): void {
  const parts = [
    `${encodeURIComponent(COOKIE_NAME)}=`,
    'path=/',
    'max-age=0',
    'SameSite=Lax',
  ];
  const domain = getCookieDomain();
  if (domain) {
    parts.push(`domain=${domain}`);
  }
  document.cookie = parts.join('; ');
}

export function setRefreshTokenCookie(value: string, maxAgeSeconds: number): void {
  const secure = window.location.protocol === 'https:';
  const parts = [
    `${encodeURIComponent(REFRESH_COOKIE_NAME)}=${encodeURIComponent(value)}`,
    'path=/',
    `max-age=${maxAgeSeconds}`,
    'SameSite=Lax',
  ];
  const domain = getCookieDomain();
  if (domain) {
    parts.push(`domain=${domain}`);
  }
  if (secure) {
    parts.push('Secure');
  }
  document.cookie = parts.join('; ');
}

export function getRefreshTokenCookie(): string | null {
  const name = encodeURIComponent(REFRESH_COOKIE_NAME);
  const cookies = document.cookie.split(';');
  for (const cookie of cookies) {
    const trimmed = cookie.trim();
    if (trimmed.startsWith(`${name}=`)) {
      const value = trimmed.slice(name.length + 1).trim();
      try {
        return decodeURIComponent(value) || null;
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function clearRefreshTokenCookie(): void {
  const parts = [
    `${encodeURIComponent(REFRESH_COOKIE_NAME)}=`,
    'path=/',
    'max-age=0',
    'SameSite=Lax',
  ];
  const domain = getCookieDomain();
  if (domain) {
    parts.push(`domain=${domain}`);
  }
  document.cookie = parts.join('; ');
}
