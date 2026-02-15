/**
 * Control Plane = users/accounts backend (REACT_APP_CONTROL_PLANE_BASE_URL, port 5207).
 * Public endpoints: captcha-config, contact-us, schedule-demo, signup.
 * Now uses bootstrap config for dynamic URL resolution.
 */

import { getBootstrapConfig } from '../contexts/BootstrapContext';

export function getControlPlaneBaseUrl(): string {
  // For public endpoints (contact-us, schedule-demo, bootstrap itself),
  // we need the control plane URL which is either from env or default
  const config = getBootstrapConfig();
  
  // Bootstrap doesn't return control plane URL (it IS the control plane),
  // so we use env var directly
  return (
    process.env.REACT_APP_CONTROL_PLANE_BASE_URL ||
    'https://api.local.synaptagrid.io:5207'
  );
}

// Helper to get AuthN URL from bootstrap (for authenticated endpoints)
export function getAuthnBaseUrl(): string {
  const config = getBootstrapConfig();
  if (config?.services?.authn_url) {
    return config.services.authn_url;
  }
  return process.env.REACT_APP_AUTHN_BASE_URL || 'https://authn-api.local.synaptagrid.io:5209';
}

export type CaptchaConfigResponse = {
  site_key: string;
  captcha_enabled: boolean;
};

const CAPTCHA_CONFIG_PATH = '/v1/public/captcha-config';

export async function fetchCaptchaConfig(): Promise<CaptchaConfigResponse> {
  const baseUrl = getControlPlaneBaseUrl();
  const res = await fetch(`${baseUrl}${CAPTCHA_CONFIG_PATH}`, {
    method: 'GET',
    credentials: 'omit',
  });
  if (!res.ok) {
    throw new Error('Failed to load captcha config');
  }
  return res.json() as Promise<CaptchaConfigResponse>;
}

export const CONTACT_US_PATH = '/v1/users-accounts/public/contact-us';
export const SCHEDULE_DEMO_PATH = '/v1/users-accounts/public/schedule-demo';
export const SIGNUP_PATH = '/v1/users-accounts/public/signup';
