import { useEffect, useRef } from 'react';
import {
  getAccessTokenCookie,
  getRefreshTokenCookie,
  setAccessTokenCookie,
  setRefreshTokenCookie,
  clearAccessTokenCookie,
  clearRefreshTokenCookie,
} from '../auth/cookie';
import { refreshAccessToken } from '../auth/oidc';

/**
 * Refreshes access token 1 minute before expiry (same as admin).
 * On failure, clears tokens and redirects to /login.
 */
export function useTokenRefresh() {
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const scheduleRefresh = () => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
      }
      const accessToken = getAccessTokenCookie();
      const refreshToken = getRefreshTokenCookie();
      if (!accessToken || !refreshToken) return;
      try {
        const payload = JSON.parse(atob(accessToken.split('.')[1]));
        const expiresAt = payload.exp * 1000;
        const timeUntilExpiry = expiresAt - Date.now();
        const refreshIn = Math.max(0, timeUntilExpiry - 60000);
        refreshTimerRef.current = setTimeout(async () => {
          try {
            const newTokens = await refreshAccessToken(refreshToken);
            setAccessTokenCookie(newTokens.access_token, newTokens.expires_in);
            if (newTokens.refresh_token) {
              setRefreshTokenCookie(newTokens.refresh_token, newTokens.refresh_expires_in ?? 1800);
            }
            scheduleRefresh();
          } catch {
            clearAccessTokenCookie();
            clearRefreshTokenCookie();
            window.location.href = '/login';
          }
        }, refreshIn);
      } catch {
        /* ignore */
      }
    };
    scheduleRefresh();
    return () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, []);
}
