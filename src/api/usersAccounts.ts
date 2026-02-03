/**
 * Control Plane = users/accounts backend (REACT_APP_CONTROL_PLANE_BASE_URL, port 5007).
 * Public endpoints: captcha-config, contact-us, schedule-demo, signup.
 */

export function getControlPlaneBaseUrl(): string {
  return (
    process.env.REACT_APP_CONTROL_PLANE_BASE_URL ||
    'https://local-app.synaptagrid.io:5007'
  );
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

export const CONTACT_US_PATH = '/v1/public/contact-us';
export const SCHEDULE_DEMO_PATH = '/v1/public/schedule-demo';
export const SIGNUP_PATH = '/v1/public/signup';
