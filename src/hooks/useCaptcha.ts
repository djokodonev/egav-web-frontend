import { useCallback, useEffect, useState } from 'react';
import { fetchCaptchaConfig } from '../api/usersAccounts';

const RECAPTCHA_SCRIPT_URL = 'https://www.google.com/recaptcha/api.js';

declare global {
  interface Window {
    grecaptcha?: {
      ready: (cb: () => void) => void;
      execute: (siteKey: string, options: { action: string }) => Promise<string>;
    };
    __recaptchaOnLoad?: () => void;
  }
}

export type UseCaptchaResult = {
  captchaEnabled: boolean;
  siteKey: string | null;
  loading: boolean;
  error: string | null;
  getToken: (action?: string) => Promise<string | null>;
  reset: () => void;
};

function loadRecaptchaScript(siteKey: string): Promise<void> {
  const scriptUrl = `${RECAPTCHA_SCRIPT_URL}?render=${encodeURIComponent(siteKey)}`;
  const existing = document.querySelector(`script[src^="${RECAPTCHA_SCRIPT_URL}"]`);
  if (existing && window.grecaptcha) {
    return new Promise((resolve) => {
      window.grecaptcha?.ready(resolve);
    });
  }
  if (window.grecaptcha) return Promise.resolve();
  return new Promise((resolve, reject) => {
    window.__recaptchaOnLoad = () => resolve();
    const script = document.createElement('script');
    script.src = `${scriptUrl}&onload=__recaptchaOnLoad`;
    script.async = true;
    script.defer = true;
    script.onerror = () => reject(new Error('Failed to load reCAPTCHA'));
    document.head.appendChild(script);
  });
}

/**
 * Fetches captcha config, loads reCAPTCHA v3 script when enabled.
 * Use getToken() on form submit to get a token (no visible widget).
 */
export function useCaptcha(): UseCaptchaResult {
  const [captchaEnabled, setCaptchaEnabled] = useState(false);
  const [siteKey, setSiteKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetchCaptchaConfig()
      .then((config) => {
        if (cancelled) return;
        setCaptchaEnabled(config.captcha_enabled);
        setSiteKey(config.captcha_enabled ? config.site_key : null);
        if (!config.captcha_enabled) {
          setLoading(false);
          return;
        }
        if (!config.site_key?.trim()) {
          setLoading(false);
          return;
        }
        loadRecaptchaScript(config.site_key.trim())
          .then(() => {
            if (!cancelled) setLoading(false);
          })
          .catch((err) => {
            if (!cancelled) {
              setError(err instanceof Error ? err.message : 'Failed to load reCAPTCHA');
              setLoading(false);
            }
          });
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load captcha config');
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const getToken = useCallback(
    async (action = 'submit'): Promise<string | null> => {
      const key = siteKey?.trim();
      if (!key || !window.grecaptcha) return null;
      try {
        await new Promise<void>((resolve) => window.grecaptcha!.ready(resolve));
        const token = await window.grecaptcha.execute(key, { action });
        return token || null;
      } catch {
        return null;
      }
    },
    [siteKey]
  );

  const reset = useCallback(() => {
    /* v3 tokens are one-time use; no client-side reset needed */
  }, []);

  return {
    captchaEnabled,
    siteKey,
    loading,
    error,
    getToken,
    reset,
  };
}
