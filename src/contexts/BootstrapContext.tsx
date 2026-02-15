import React, { createContext, useContext, useState, useEffect } from 'react';

export type BootstrapConfig = {
  organization: {
    guid: string;
    slug: string;
    name: string;
    type: string;
    subdomain: string | null;
  };
  application?: {
    id: number;
    guid: string;
    code: string;
    name: string;
    is_system: boolean;
  };
  instance?: {
    id: number;
    guid: string;
    subdomain: string | null;
    environment: string;
    slug: string;
    region: string;
  };
  services: {
    authn_url: string;
    authz_url: string;
    keycloak_url: string;
    region: string;
  };
  auth: {
    sso_config_url: string;
    auth_config_url: string;
  };
  // OAuth/OIDC Provider Configuration
  auth_provider?: {
    provider_type: string;  // 'keycloak', 'workos', 'auth0', etc.
    issuer: string;
    authorization_endpoint: string;
    token_endpoint: string;
    userinfo_endpoint: string;
    end_session_endpoint: string;
    jwks_uri: string;
    client_id: string;
    redirect_uri: string;
    oauth_callback_url?: string;  // AuthN central callback URL (when using social/central flow)
    social_providers?: string[];  // e.g. ['google', 'github'] when SSO config has credentials
    scope: string;
    response_type: string;
    flow: string;
    sso_required: boolean;
    sso_button_text: string | null;
    allow_social_login: boolean;
    kc_idp_hint?: string;  // Keycloak IDP hint
    workos_connection_id?: string;  // WorkOS specific
    workos_organization_id?: string;  // WorkOS specific
  };
};

interface BootstrapContextType {
  config: BootstrapConfig | null;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

const BootstrapContext = createContext<BootstrapContextType | null>(null);

export const BootstrapProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [config, setConfig] = useState<BootstrapConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadBootstrapConfig = async () => {
    try {
      setLoading(true);
      setError(null);

      // Get current hostname
      const hostname = window.location.hostname;
      
      console.log('[Bootstrap] Loading config for hostname:', hostname);

      // Call bootstrap endpoint (NO AUTH REQUIRED - public endpoint)
      const controlPlaneUrl = process.env.REACT_APP_CONTROL_PLANE_BASE_URL || 
                              'https://api.local.synaptagrid.io:5207';
      
      const url = `${controlPlaneUrl}/v1/users-accounts/public/bootstrap?hostname=${encodeURIComponent(hostname)}`;
      console.log('[Bootstrap] Fetching from:', url);

      const response = await fetch(url);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[Bootstrap] Request failed', { status: response.status, responseText: errorText });
        let message: string;
        try {
          const err = JSON.parse(errorText);
          message = err.detail || err.message || 'Failed to load configuration. Try again or contact your administrator.';
        } catch {
          message = 'Failed to load configuration. Try again or contact your administrator.';
        }
        throw new Error(message);
      }

      const data = await response.json();
      setConfig(data);
      
      console.log('[Bootstrap] Config loaded successfully:', {
        org: data.organization?.slug,
        app: data.application?.code,
        instance: data.instance?.subdomain,
        services: data.services,
        auth_provider: data.auth_provider
      });
    } catch (err: any) {
      console.error('[Bootstrap] Failed to load config:', err);
      setError(err.message);
      
      // Fallback to environment variables if bootstrap fails
      console.warn('[Bootstrap] Using fallback configuration from environment variables');
      const fallbackConfig: BootstrapConfig = {
        organization: {
          guid: '',
          slug: 'synaptagrid',
          name: 'SynaptaGrid',
          type: 'system',
          subdomain: null,
        },
        services: {
          authn_url: process.env.REACT_APP_AUTHN_BASE_URL || 'https://authn-api.local.synaptagrid.io:5209',
          authz_url: process.env.REACT_APP_AUTHZ_BASE_URL || 'https://authz-api.local.synaptagrid.io:5206',
          keycloak_url: process.env.REACT_APP_OIDC_ISSUER?.split('/realms/')[0] || 'https://keycloak.local.synaptagrid.io:5281',
          region: 'us-east-1',
        },
        auth: {
          sso_config_url: '',
          auth_config_url: '',
        },
      };
      setConfig(fallbackConfig);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadBootstrapConfig();
  }, []);
  
  // Update cached config when config changes
  useEffect(() => {
    if (config) {
      cachedBootstrapConfig = config;
    }
  }, [config]);

  return (
    <BootstrapContext.Provider value={{ config, loading, error, reload: loadBootstrapConfig }}>
      {children}
    </BootstrapContext.Provider>
  );
};

export const useBootstrap = (): BootstrapContextType => {
  const context = useContext(BootstrapContext);
  if (!context) {
    throw new Error('useBootstrap must be used within BootstrapProvider');
  }
  return context;
};

// Helper to get bootstrap config (for use outside React components)
let cachedBootstrapConfig: BootstrapConfig | null = null;

export const getBootstrapConfig = (): BootstrapConfig | null => {
  return cachedBootstrapConfig;
};
