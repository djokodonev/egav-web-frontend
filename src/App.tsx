import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BrowserRouter, Link, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import './App.css';
import {
  exchangeCodeForTokens,
  getAuthRedirectUrl,
  startAuthRedirect,
} from './auth/oidc';
import type { TokenResponse } from './auth/oidc';

type BootstrapResponse = {
  user: { guid: string; email: string; email_verified: boolean };
  personal_org: { guid: string; slug: string; name: string } | null;
  created_user: boolean;
  created_personal_org: boolean;
  access_hint: {
    action: 'ok' | 'contact_admin' | 'personal_org_created';
    reason: string | null;
    organization?: { guid: string; slug: string; name: string };
    invited?: boolean;
  };
};

const coreValueProps = [
  {
    title: 'Tenant-First Architecture',
    description:
      'Select tenant before anything else, with strict isolation across data, workflows, and execution.',
    bullets: [
      'Tenant selection layer before all operations',
      'Tenant-scoped queries and configurations',
      'No cross-tenant data leakage',
    ],
  },
  {
    title: 'Full Branding Package',
    description:
      'Deliver a complete white-label experience with tenant-specific branding.',
    bullets: [
      'Custom logos, colors, and themes',
      'Branded email templates and domains',
      'API branding per tenant',
    ],
  },
  {
    title: 'Universal API Integration',
    description:
      'Connect any REST, SOAP, gRPC, or GraphQL API through configuration.',
    bullets: [
      'OpenAPI/Swagger import',
      'Reusable external API activities',
      'Tenant-specific external system settings',
    ],
  },
  {
    title: 'Rich Configuration System',
    description:
      'Model complex rules with flexible conditions and data mapping.',
    bullets: [
      'Event + state + time-based conditions',
      'AND/OR logic with rate limits',
      'Nested path mapping and transformations',
    ],
  },
  {
    title: 'Enterprise-Grade Reliability',
    description:
      'Durable orchestration with observability and automated recovery.',
    bullets: [
      'Temporal workflows',
      'Async signal handling',
      'Configurable retries and audit trails',
    ],
  },
  {
    title: 'Scalable Architecture',
    description:
      'Scale horizontally with priority processing and tenant throttling.',
    bullets: [
      'Priority-based Kafka channels',
      'Dynamic throttling per tenant',
      'Real-time resource monitoring',
    ],
  },
  {
    title: 'Advanced Workflow Builder',
    description:
      'Empower non-technical users with visual workflow design.',
    bullets: [
      '5-step creation wizard',
      'Reusable templates',
      'Contract-based activity definitions',
    ],
  },
  {
    title: 'Security & Compliance',
    description:
      'Built-in protections for regulated, enterprise-grade environments.',
    bullets: [
      'Immutable audit logs',
      'Encryption at rest and in transit',
      'Tenant-scoped RBAC',
    ],
  },
  {
    title: 'Fast Time-to-Value',
    description:
      'Onboard tenants and new integrations in minutes, not weeks.',
    bullets: [
      'Zero-code integrations',
      'Reusable templates',
      'Rapid tenant onboarding',
    ],
  },
];

const problemPoints = [
  'Simple filters only, no complex logic or state checks',
  'Multiple separate automations required for complex scenarios',
  'Limited reliability, scalability, and tenant isolation',
  'No white-label branding capabilities',
  'Only pre-built integrations supported',
];

const differentiators = [
  {
    feature: 'Multi-Tenancy',
    zapier: 'Single account',
    synaptagrid: 'Tenant-first with complete isolation',
  },
  {
    feature: 'Tenant Selection',
    zapier: 'Not available',
    synaptagrid: 'Layer before all operations',
  },
  {
    feature: 'Full Branding',
    zapier: 'Limited',
    synaptagrid: 'Complete white-label package',
  },
  {
    feature: 'API Integration',
    zapier: 'Pre-built only',
    synaptagrid: 'Integrate any API via configuration',
  },
  {
    feature: 'Complex Conditions',
    zapier: 'Basic filters',
    synaptagrid: 'Event + state + time + aggregate',
  },
  {
    feature: 'Reliability',
    zapier: 'Basic retries',
    synaptagrid: 'Temporal workflows with recovery',
  },
];

const architectureFlow = [
  'Tenant selection layer',
  'Tenant-scoped workflows, rules, activities, and executions',
  'Tenant-specific external systems and branding',
  'Tenant-level throttling and resource controls',
];

const proofPoints = [
  'New tenant setup in hours, not weeks',
  'New API integrations added in under a day',
  'Single rule replaces multiple point automations',
];

const buyerPersonas = [
  'SaaS platform owners delivering white-label automation',
  'Enterprise operations teams orchestrating cross-system workflows',
  'Integration partners building repeatable tenant experiences',
];

const targetUseCases = [
  'Document processing pipelines with tenant isolation',
  'Event-driven business process automation',
  'Multi-system data synchronization',
  'Custom API integrations without development overhead',
  'White-label automation platforms for resellers',
];

const qmsUseCases = [
  'Document control with approvals and versioning',
  'Training compliance with automated assignments',
  'CAPA, deviations, and corrective action workflows',
  'Change control with audit-ready trails',
];

function LandingPage() {
  return (
    <div className="app">
      <header className="hero" id="top">
        <div className="hero-content">
          <p className="eyebrow">SynaptaGrid.io</p>
          <h1>Enterprise automation with complete tenant isolation.</h1>
          <p className="hero-subtitle">
            Orchestrate complex workflows across any external system with advanced
            logic, enterprise-grade reliability, and full white-label branding.
          </p>
          <div className="hero-links">
            <Link to="/login">Login</Link>
            <span aria-hidden="true">•</span>
            <Link to="/register">Register</Link>
          </div>
          <div className="hero-actions">
            <Link className="primary-button" to="/request-demo">
              Request a demo
            </Link>
            <a className="secondary-button" href="#architecture">
              View architecture
            </a>
          </div>
          <div className="hero-metrics">
            <div>
              <strong>500+</strong>
              <span>Ready-to-use activities</span>
            </div>
            <div>
              <strong>8+</strong>
              <span>Point automations replaced by one rule</span>
            </div>
            <div>
              <strong>100%</strong>
              <span>Tenant-scoped isolation</span>
            </div>
          </div>
        </div>
      </header>

      <main>
        <section className="section">
          <div className="section-header">
            <h2>The problem</h2>
            <p>
              Automation tools built for simple tasks collapse under enterprise complexity.
            </p>
          </div>
          <ul className="bullet-grid">
            {problemPoints.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
        </section>

        <section className="section alt">
          <div className="section-header">
            <h2>The solution</h2>
            <p>
              SynaptaGrid.io delivers a multi-tenant automation platform that scales
              complex workflows with configuration-driven integrations, full branding,
              and enterprise-grade reliability.
            </p>
          </div>
        </section>

        <section className="section">
          <div className="section-header">
            <h2>Core value proposition</h2>
            <p>
              Built for enterprises and SaaS platforms that demand tenant isolation,
              extensibility, and performance.
            </p>
          </div>
          <div className="cards">
            {coreValueProps.map((item) => (
              <article className="card" key={item.title}>
                <h3>{item.title}</h3>
                <p>{item.description}</p>
                <ul>
                  {item.bullets.map((bullet) => (
                    <li key={bullet}>{bullet}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </section>

        <section className="section alt" id="architecture">
          <div className="section-header">
            <h2>Architecture flow</h2>
            <p>Every layer is tenant-aware, from selection to execution.</p>
          </div>
          <ol className="flow">
            {architectureFlow.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </section>

        <section className="section">
          <div className="section-header">
            <h2>Key differentiators</h2>
            <p>How SynaptaGrid outperforms legacy automation platforms.</p>
          </div>
          <div className="table">
            <div className="table-row table-header">
              <span>Feature</span>
              <span>Zapier</span>
              <span>SynaptaGrid.io</span>
            </div>
            {differentiators.map((row) => (
              <div className="table-row" key={row.feature}>
                <span>{row.feature}</span>
                <span>{row.zapier}</span>
                <span>{row.synaptagrid}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="section alt">
          <div className="section-header">
            <h2>Proof points</h2>
            <p>Measured outcomes that deliver real business impact.</p>
          </div>
          <ul className="bullet-grid">
            {proofPoints.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
        </section>

        <section className="section">
          <div className="section-header">
            <h2>Buyer personas</h2>
            <p>Ideal for teams that need tenant-first automation at scale.</p>
          </div>
          <ul className="bullet-grid">
            {buyerPersonas.map((persona) => (
              <li key={persona}>{persona}</li>
            ))}
          </ul>
        </section>

        <section className="section alt">
          <div className="section-header">
            <h2>Target use cases</h2>
            <p>From enterprise automation to branded SaaS platforms.</p>
          </div>
          <ul className="bullet-grid">
            {targetUseCases.map((useCase) => (
              <li key={useCase}>{useCase}</li>
            ))}
          </ul>
        </section>

        <section className="section">
          <div className="section-header">
            <h2>QMS automation &amp; integration</h2>
            <p>Built-in patterns for regulated operations and audit readiness.</p>
          </div>
          <ul className="bullet-grid">
            {qmsUseCases.map((useCase) => (
              <li key={useCase}>{useCase}</li>
            ))}
          </ul>
        </section>

        <section className="section cta" id="cta">
          <div>
            <h2>Ready to orchestrate enterprise automation?</h2>
            <p>
              SynaptaGrid.io replaces point automations with a single tenant-first platform.
              Let&apos;s map your workflows and launch faster.
            </p>
          </div>
          <Link className="primary-button" to="/request-demo">
            Talk to SynaptaGrid
          </Link>
        </section>
      </main>

      <footer className="footer">
        <p>SynaptaGrid.io — Enterprise automation with complete tenant isolation.</p>
      </footer>
    </div>
  );
}

function DemoRequestPage() {
  return (
    <div className="app">
      <header className="hero hero-compact">
        <div className="hero-content">
          <p className="eyebrow">Request a demo</p>
          <h1>Tell us about your automation goals.</h1>
          <p className="hero-subtitle">
            We&apos;ll route your request to our backend and follow up with a tailored
            walkthrough of SynaptaGrid.io.
          </p>
          <Link className="secondary-button" to="/">
            Back to overview
          </Link>
        </div>
      </header>

      <main>
        <section className="section form-section">
          <div className="section-header">
            <h2>Demo request form</h2>
            <p>All fields marked with * are required.</p>
          </div>
          <form className="form" method="post" action="/api/demo-request">
            <label>
              Full name *
              <input type="text" name="full_name" required />
            </label>
            <label>
              Work email *
              <input type="email" name="email" required />
            </label>
            <label>
              Company *
              <input type="text" name="company" required />
            </label>
            <label>
              Role
              <input type="text" name="role" />
            </label>
            <label>
              What should we focus on?
              <textarea name="message" rows={5} />
            </label>
            <button className="primary-button" type="submit">
              Send request
            </button>
          </form>
        </section>
      </main>
    </div>
  );
}

function LoginPage() {
  return (
    <div className="app">
      <header className="hero hero-compact">
        <div className="hero-content">
          <p className="eyebrow">Login</p>
          <h1>Welcome back to SynaptaGrid.io.</h1>
          <p className="hero-subtitle">
            Access your tenant workspace and manage enterprise automations.
          </p>
          <Link className="secondary-button" to="/">
            Back to overview
          </Link>
        </div>
      </header>

      <main>
        <section className="section form-section">
          <div className="section-header">
            <h2>Sign in</h2>
            <p>Use your work credentials to access your tenant.</p>
          </div>
          <div className="form">
            <p className="form-note">
              You&apos;ll be redirected to our secure identity provider to complete login.
            </p>
            <button
              className="primary-button"
              type="button"
              onClick={() => startAuthRedirect('login')}
            >
              Continue to login
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}

function RegisterPage() {
  return (
    <div className="app">
      <header className="hero hero-compact">
        <div className="hero-content">
          <p className="eyebrow">Register</p>
          <h1>Start your SynaptaGrid.io journey.</h1>
          <p className="hero-subtitle">
            Create a tenant and get a tailored onboarding experience.
          </p>
          <Link className="secondary-button" to="/">
            Back to overview
          </Link>
        </div>
      </header>

      <main>
        <section className="section form-section">
          <div className="section-header">
            <h2>Create your account</h2>
            <p>We&apos;ll connect you with the right team after signup.</p>
          </div>
          <div className="form">
            <p className="form-note">
              Registration is handled through our secure identity provider.
            </p>
            <button
              className="primary-button"
              type="button"
              onClick={() => startAuthRedirect('register')}
            >
              Continue to signup
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}

function AuthCallbackPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [status, setStatus] = useState<'loading' | 'error' | 'ready'>('loading');
  const [message, setMessage] = useState('Completing secure sign-in...');
  const [accessHint, setAccessHint] = useState<BootstrapResponse['access_hint'] | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const hasExchangedRef = useRef(false);

  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const appBaseUrl = process.env.REACT_APP_APP_BASE_URL || 'http://localhost:3000';

  useEffect(() => {
    if (hasExchangedRef.current) {
      return;
    }

    const error = searchParams.get('error');
    const actionStatus = searchParams.get('kc_action_status');
    if (error || actionStatus === 'error') {
      setStatus('error');
      setMessage('Authentication failed. Please try again.');
      return;
    }

    const code = searchParams.get('code');
    const state = searchParams.get('state');

    if (!code || !state) {
      setStatus('error');
      setMessage('Missing authentication response data.');
      return;
    }

    hasExchangedRef.current = true;

    const authnBaseUrl =
      process.env.REACT_APP_AUTHN_BASE_URL || 'https://local-app.synaptagrid.io:5005';

    exchangeCodeForTokens({ code, state })
      .then((tokens: TokenResponse) =>
        fetch(`${authnBaseUrl}/v1/authn/bootstrap/from-id-token`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${tokens.access_token}`,
          },
          body: JSON.stringify({
            id_token: tokens.id_token,
            create_personal_org_if_gmail: true,
          }),
        })
      )
      .then(async (response: Response) => {
        if (!response.ok) {
          throw new Error('Bootstrap failed');
        }
        const data = (await response.json()) as BootstrapResponse;
        setAccessHint(data.access_hint);
        setUserEmail(data.user.email);
        setStatus('ready');
        if (data.access_hint?.action === 'personal_org_created' || data.access_hint?.action === 'ok') {
          setMessage('Authentication complete. Redirecting to the app...');
          setTimeout(() => {
            window.location.assign(appBaseUrl);
          }, 1500);
        } else {
          setMessage('Additional action required.');
        }
      })
      .catch(() => {
        setStatus('error');
        setMessage('Unable to complete login. Please try again.');
      });
  }, [appBaseUrl, navigate, searchParams]);

  const callbackUrl = getAuthRedirectUrl();

  return (
    <div className="app">
      <header className="hero hero-compact">
        <div className="hero-content">
          <p className="eyebrow">Authentication</p>
          <h1>Finishing secure sign-in.</h1>
          <p className="hero-subtitle">{message}</p>
        </div>
      </header>

      <main>
        <section className="section form-section">
          {status === 'loading' && <p>Validating tokens from Keycloak...</p>}
          {status === 'error' && (
            <div className="status-card">
              <p>{message}</p>
              <div className="status-actions">
                <Link className="secondary-button" to="/login">
                  Back to login
                </Link>
                <button
                  className="primary-button"
                  type="button"
                  onClick={() => startAuthRedirect('login')}
                >
                  Go to Keycloak
                </button>
              </div>
            </div>
          )}
          {status === 'ready' && accessHint && (
            <div className="status-card">
              <h2>Next steps</h2>
              <p>
                Signed in as <strong>{userEmail}</strong>.
              </p>
              {accessHint.action === 'contact_admin' ? (
                <>
                  <p>
                    Your organization is managed by an admin. Please contact them to
                    gain access.
                  </p>
                  {accessHint.organization && (
                    <p className="status-meta">
                      Organization: {accessHint.organization.name} (
                      {accessHint.organization.slug})
                    </p>
                  )}
                </>
              ) : (
                <>
                  <p>Your account is ready. Continue to the app when you&apos;re ready.</p>
                  <a className="primary-button" href={appBaseUrl}>
                    Continue to app
                  </a>
                </>
              )}
              <p className="status-meta">Callback URL: {callbackUrl}</p>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/request-demo" element={<DemoRequestPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/auth/callback" element={<AuthCallbackPage />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
