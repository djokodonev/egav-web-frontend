import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BrowserRouter, Link, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import './App.css';
import {
  setAccessTokenCookie,
  setRefreshTokenCookie,
  getAccessTokenCookie,
} from './auth/cookie';
import {
  exchangeCodeForTokens,
  startAuthRedirect,
  redirectToGoogle,
  redirectToGitHub,
  redirectToTwitter,
  redirectToMicrosoft,
} from './auth/oidc';
import type { TokenResponse } from './auth/oidc';
import { useTokenRefresh } from './hooks/useTokenRefresh';
import { useCaptcha } from './hooks/useCaptcha';
import { getControlPlaneBaseUrl, getAuthnBaseUrl, SCHEDULE_DEMO_PATH, CONTACT_US_PATH } from './api/usersAccounts';
import { BootstrapProvider, useBootstrap } from './contexts/BootstrapContext';

/** IANA timezones for demo form (common + browser default first). */
function getTimezoneOptions(): { value: string; label: string }[] {
  const browserTz = typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : '';
  let list: string[] = [];
  try {
    const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
    if (typeof intl.supportedValuesOf === 'function') {
      list = intl.supportedValuesOf('timeZone');
    }
  } catch {
    list = [];
  }
  const fallback = [
    'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Sofia', 'Europe/Athens', 'Europe/Moscow',
    'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
    'Asia/Dubai', 'Asia/Kolkata', 'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney',
    'UTC',
  ];
  const zones = (list.length > 0 ? list : fallback).slice(0, 400);
  const opts = zones.map((tz) => ({
    value: tz,
    label: tz.replace(/_/g, ' '),
  }));
  if (browserTz && !opts.some((o) => o.value === browserTz)) {
    opts.unshift({ value: browserTz, label: `${browserTz.replace(/_/g, ' ')} (your timezone)` });
  }
  return opts;
}

/** Parse API error response (JSON with message/error_code) into a user-friendly string. */
async function parseApiErrorMessage(res: Response, fallbackText: string): Promise<string> {
  const text = await res.text();
  try {
    const data = JSON.parse(text) as { message?: string; error_code?: number };
    if (typeof data.message === 'string' && data.message.trim()) {
      const msg = data.message.trim();
      if (/captcha_token.*at least 1 character/i.test(msg)) {
        return 'Please complete the captcha before submitting.';
      }
      return msg;
    }
  } catch {
    /* ignore */
  }
  return text.trim() || fallbackText;
}

type BootstrapResponse = {
  user: { guid: string; email: string; email_verified: boolean; name?: string };
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

const MARKETING_USER_KEY = 'synaptagrid_marketing_user';
const MARKETING_USER_FETCHED_AT_KEY = 'synaptagrid_marketing_user_fetched_at_ms';

/** Parse tokens from AuthN central callback fragment (hash). AuthN social returns access_token only; Keycloak flow may include id_token. */
function parseFragmentTokens(hash: string): { access_token: string; refresh_token?: string; expires_in: number; id_token?: string } | null {
  if (!hash || !hash.startsWith('#')) return null;
  const params = new URLSearchParams(hash.slice(1));
  const access_token = params.get('access_token');
  if (!access_token) return null;
  const expires_in = parseInt(params.get('expires_in') ?? '3600', 10);
  const refresh_token = params.get('refresh_token') ?? undefined;
  const id_token = params.get('id_token') ?? undefined;
  return { access_token, refresh_token, expires_in, id_token };
}

function getAppBaseUrl(): string {
  const env = process.env.REACT_APP_APP_BASE_URL;
  if (env) return env;
  return `${window.location.protocol}//${window.location.hostname}:3201`;
}

function getPortalBaseUrl(): string {
  return process.env.REACT_APP_PORTAL_BASE_URL || 'https://portal.local.synaptagrid.io:3203';
}

type CurrentUserResponse = {
  user: { email: string; display_name?: string; name?: string };
};

function getStoredUser(): { name: string; email?: string } | null {
  try {
    const stored = sessionStorage.getItem(MARKETING_USER_KEY);
    if (!stored) return null;
    const parsed = JSON.parse(stored) as { name?: string; email?: string };
    const name = parsed.name ?? parsed.email?.split('@')[0] ?? 'User';
    return { name, email: parsed.email };
  } catch {
    return null;
  }
}

function getStoredUserFetchedAtMs(): number | null {
  try {
    const raw = sessionStorage.getItem(MARKETING_USER_FETCHED_AT_KEY);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

async function fetchCurrentUser(): Promise<{ name: string; email?: string } | null> {
  const authnBaseUrl = getAuthnBaseUrl();
  const mePath = process.env.REACT_APP_AUTHN_ME_PATH || '/v1/authn/me';
  const token = getAccessTokenCookie();
  const headers: Record<string, string> = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  try {
    const res = await fetch(`${authnBaseUrl}${mePath}`, {
      method: 'GET',
      credentials: 'omit',
      headers,
    });
    if (!res.ok) return getStoredUser();
    const data = (await res.json()) as CurrentUserResponse;
    const u = data.user;
    if (!u?.email) return getStoredUser();
    const name = u.display_name ?? u.name ?? u.email.split('@')[0] ?? 'User';
    const user = { name, email: u.email };
    try {
      sessionStorage.setItem(MARKETING_USER_KEY, JSON.stringify(user));
      sessionStorage.setItem(MARKETING_USER_FETCHED_AT_KEY, String(Date.now()));
    } catch {
      /* ignore */
    }
    return user;
  } catch {
    return getStoredUser();
  }
}

type TopNavUser = { name: string; email?: string };

function TopNav({ user: userProp, authChecked: authCheckedProp }: { user?: TopNavUser | null; authChecked?: boolean } = {}) {
  const initialToken = getAccessTokenCookie();
  const initialUser = initialToken ? getStoredUser() : null;

  const [userState, setUserState] = useState<TopNavUser | null>(initialUser);
  const [authCheckedState, setAuthCheckedState] = useState(() => {
    if (!initialToken) return true;
    return initialUser !== null;
  });
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const location = useLocation();

  useEffect(() => {
    // Close the mobile menu on navigation to avoid "stuck open" states.
    setMobileMenuOpen(false);
  }, [location.pathname]);

  const hasExternalAuthState = typeof userProp !== 'undefined' || typeof authCheckedProp !== 'undefined';

  useEffect(() => {
    if (hasExternalAuthState) return;

    const token = getAccessTokenCookie();
    if (!token) {
      setUserState(null);
      setAuthCheckedState(true);
      return;
    }

    const cached = getStoredUser();
    const fetchedAt = getStoredUserFetchedAtMs();
    const isFresh = typeof fetchedAt === 'number' && Date.now() - fetchedAt < 5 * 60 * 1000;
    if (cached && isFresh) {
      setUserState(cached);
      setAuthCheckedState(true);
      return;
    }

    let cancelled = false;
    fetchCurrentUser().then((u) => {
      if (!cancelled) {
        setUserState(u);
        setAuthCheckedState(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [hasExternalAuthState]);

  const user = typeof userProp !== 'undefined' ? userProp : userState;
  const authChecked = typeof authCheckedProp !== 'undefined' ? authCheckedProp : authCheckedState;

  return (
    <nav className="top-nav">
      <Link to="/" className="top-nav-brand" aria-label="SynaptaGrid home">
        <span className="top-nav-logo" aria-hidden="true">
          <svg viewBox="0 0 32 32" width="24" height="24" fill="none" xmlns="http://www.w3.org/2000/svg">
            {/* Frame: EGAV model container */}
            <rect x="4" y="6" width="24" height="20" rx="4" stroke="currentColor" strokeWidth="2" />

            {/* Nodes inside the model */}
            <circle cx="11" cy="16" r="2.4" stroke="currentColor" strokeWidth="2" />
            <circle cx="20" cy="12" r="2.4" stroke="currentColor" strokeWidth="2" />
            <circle cx="20" cy="20" r="2.4" stroke="currentColor" strokeWidth="2" />

            {/* Connections (automation graph) */}
            <path d="M13.2 14.9 L17.6 13.2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <path d="M13.2 17.1 L17.6 18.8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </span>
        <span className="top-nav-brand-text">SynaptaGrid</span>
      </Link>
      <button
        type="button"
        className="top-nav-menu-button"
        aria-label="Open navigation menu"
        aria-expanded={mobileMenuOpen}
        aria-controls="top-nav-mobile-menu"
        onClick={() => setMobileMenuOpen((v) => !v)}
      >
        ☰
      </button>
      <div className="top-nav-right">
        <div className="top-nav-links">
          <Link to="/egav" className="top-nav-link">EGAV</Link>
          <Link to="/automation" className="top-nav-link">Automation</Link>
          <Link to="/case-studies" className="top-nav-link">Case studies</Link>
          <Link to="/contact-us" className="top-nav-link">Contact us</Link>
          <Link to="/request-demo" className="top-nav-link top-nav-cta">Schedule your technical review</Link>
        </div>
        <div className="top-nav-auth" aria-label="Account">
          {!authChecked ? (
            <span className="top-nav-link" aria-hidden="true">&nbsp;</span>
          ) : user ? (
            <div className="top-nav-user">
              <a className="top-nav-link" href={getPortalBaseUrl()}>
                Portal
              </a>
              <a className="top-nav-link" href={getAppBaseUrl()}>
                Applications
              </a>
              <span className="top-nav-user-name" title={user.name}>{user.name}</span>
              <span className="top-nav-user-avatar" aria-hidden="true">
                {user.name.charAt(0).toUpperCase()}
              </span>
            </div>
          ) : (
            <div className="top-nav-auth-actions">
              <a className="top-nav-link" href={`${getPortalBaseUrl().replace(/\/$/, '')}/login`}>Login</a>
              <Link to="/register" className="top-nav-link top-nav-cta">Evaluate</Link>
            </div>
          )}
        </div>
      </div>
      <div
        id="top-nav-mobile-menu"
        className={`top-nav-mobile-menu${mobileMenuOpen ? ' is-open' : ''}`}
        aria-hidden={!mobileMenuOpen}
      >
        <div className="top-nav-mobile-links">
          <Link to="/egav" className="top-nav-link">EGAV</Link>
          <Link to="/automation" className="top-nav-link">Automation</Link>
          <Link to="/case-studies" className="top-nav-link">Case studies</Link>
          <Link to="/contact-us" className="top-nav-link">Contact us</Link>
          <Link to="/request-demo" className="top-nav-link top-nav-cta">Schedule your technical review</Link>
        </div>
        <div className="top-nav-mobile-auth" aria-label="Account">
          {!authChecked ? (
            <span className="top-nav-link" aria-hidden="true">&nbsp;</span>
          ) : user ? (
            <div className="top-nav-user">
              <a className="top-nav-link" href={getPortalBaseUrl()}>
                Portal
              </a>
              <a className="top-nav-link" href={getAppBaseUrl()}>
                Applications
              </a>
              <span className="top-nav-user-name" title={user.name}>{user.name}</span>
              <span className="top-nav-user-avatar" aria-hidden="true">
                {user.name.charAt(0).toUpperCase()}
              </span>
            </div>
          ) : (
            <div className="top-nav-auth-actions">
              <a className="top-nav-link" href={`${getPortalBaseUrl().replace(/\/$/, '')}/login`}>Login</a>
              <Link to="/register" className="top-nav-link top-nav-cta">Evaluate</Link>
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}

const heroStats = [
  { value: "700+", label: "Built-in activities", detail: "Google, OpenAI, and more" },
  { value: "Isolated", label: "Per-customer data", detail: "Architecture you can defend" },
  { value: "99.9%", label: "Execution reliability", detail: "Durable execution (Temporal)" },
];

const problems = [
  {
    icon: "🔧",
    title: "Build vs buy: automation as a product capability",
    description: "Building workflow engines, integrations, and a visual builder in-house takes 12–18 months and a dedicated team. You need a decision that de-risks the roadmap.",
  },
  {
    icon: "🔄",
    title: "Evolving data models without constant rework",
    description: "New document types, new fields, new relationships — every schema change shouldn't mean migrations and redeploys. You need versioning and governance, not rebuilds.",
  },
  {
    icon: "📋",
    title: "Audit trail and governance for compliance",
    description: "Compliance and security require controlled change and full auditability. Consumer tools don't offer versioning, retention, or proper RBAC for production.",
  },
  {
    icon: "📈",
    title: "Outgrowing consumer automation tools",
    description: "Zapier, Make, n8n work until you need multi-tenancy, complex conditions, or state-aware decisions. You need an architecture that scales with your product.",
  },
  {
    icon: "💰",
    title: "Enterprise capability without enterprise budget",
    description: "Workato and Tray.io target large budgets. You need enterprise-grade governance, isolation, and reliability at a fit-for-your-scale cost.",
  },
];

const whatItIs = {
  headline: "One platform. Governed data. Reliable automation.",
  oneLiner: "Model complex data fast, govern it, then automate its lifecycle safely.",
  products: [
    {
      name: "SynaptaGrid EGAV",
      tagline: "Model and store your data — on our cloud or yours",
      description: "Use EGAV to model and store your data — on our cloud or yours. Define entity types and attribute sets; get versioned schema evolution, generated REST APIs, and dynamic CRUD frontends. No custom backend or UI per data model — so your team ships features instead of migrations. JSON Schema & JSON UI compatible; full history and restore.",
      features: [
        "Model & store your data — on our cloud or yours",
        "Model the structure → versioning, APIs & CRUD out of the box",
        "JSON Schema & JSON UI; instant CRUD APIs + frontend",
        "Full version history & restore; complete audit log for compliance",
        "Horizontal scaling with per-attribute-set databases",
      ],
    },
    {
      name: "SynaptaGrid Automation",
      tagline: "Workflows for anything — full control",
      description: "Send your data to the automation (API, Kafka, or SNS) → we process it → you get the updates back to your system. Any API can be added: import OpenAPI, map any entity to API input and API output to any entity. Unlimited activities per workflow. Rich conditions: event attributes, entity state, time-based rules, AND/OR logic — one rule instead of many. Full control: concurrency, per-activity throttling, notifications on failure/success/stale, pause/stop/start, emergency throttle, crash prevention. Process documents, uploads, content generation, and approvals.",
      features: [
        "Send data in (API / Kafka / SNS) → we process → updates back to your system",
        "Any API: add any API via OpenAPI; unlimited activities per workflow",
        "Rich conditions: event + entity state + time-based + AND/OR — one rule, not many Zaps",
        "Full control: concurrency, throttling, notifications, pause, stop, start, emergency throttle",
        "State-aware automation, branching, human approvals; DAG execution & execution history",
      ],
    },
  ],
};

const egavCapabilities: Array<{
  title: string;
  tagline: string;
  description: string;
  features: string[];
}> = [
  {
    title: 'Data modeling primitives',
    tagline: 'Unlimited nested, repeatable field groups',
    description: 'Build any data structure with nested, repeatable groups (unlimited depth) — then get compliant JSON Schema, UI schema, and generated CRUD automatically.',
    features: [
      'Define entity types and attribute sets',
      'Define attributes (data types, constraints, defaults)',
      'Optional/required fields and validation rules',
      'Reusable attribute sets across multiple entity types',
      'Relationships between entities (link/lookup patterns)',
      'Nested, repeatable field groups (unlimited depth) for complex document-like structures',
      'Support for evolving domains (new fields and structures over time)',
    ],
  },
  {
    title: 'Versioning & schema evolution',
    tagline: 'Change safely, keep history',
    description: 'EGAV treats your model as a governed artifact: changes are tracked, versioned, and reversible.',
    features: [
      'Versioned schema definitions',
      'Backward/forward evolution strategy (introduce new fields without breaking existing consumers)',
      'Full history of model changes',
      'Restore/rollback to prior versions',
      'Auditability of who changed what and when (governance-ready change trail)',
    ],
  },
  {
    title: 'Generated APIs',
    tagline: 'CRUD without custom backend work',
    description: 'Expose your model through generated REST endpoints so teams integrate quickly without hand-built boilerplate.',
    features: [
      'Instant CRUD endpoints per entity type',
      'Consistent request/response shapes across entity types',
      'Generated OpenAPI specs for CRUD operations (endpoints + request/response schemas)',
      'Validation aligned with the current schema version',
      'Listing endpoints with pagination and filtering',
      'Stable contract evolution as schema versions change',
    ],
  },
  {
    title: 'Dynamic CRUD frontends',
    tagline: 'UI generated from the model',
    description: 'Avoid building and maintaining a bespoke UI for every new entity type or schema change.',
    features: [
      'Dynamic CRUD UI generated from schema + UI schema',
      'Form generation, field rendering, and validation from definitions',
      'Generated list views with filtering for rapid admin/operator workflows',
      'Consistent admin/operator experience across entity types',
      'Lower UI maintenance as models evolve',
    ],
  },
  {
    title: 'JSON Schema & JSON UI compatibility',
    tagline: 'Interoperable by design',
    description: 'Define structure and UI behavior using industry-standard JSON artifacts that tooling can understand.',
    features: [
      'Compliant JSON Schema output from your model (including nested, repeatable groups)',
      'Compliant UI schema output (form rendering and UI behavior)',
      'Schema-driven validation',
      'Share schemas across teams and environments',
    ],
  },
  {
    title: 'Audit, compliance & governance',
    tagline: 'Production-grade traceability',
    description: 'Designed for regulated and compliance-heavy environments where changes and data access must be explainable.',
    features: [
      'Complete audit log of changes (model and data operations)',
      'Version history and restore support',
      'Clear separation of configuration vs customer application data',
      'Policy-friendly approach to retention and traceability (deployment dependent)',
    ],
  },
  {
    title: 'Tenant isolation & deployment flexibility',
    tagline: 'Your cloud or yours',
    description: 'Run EGAV in a way that matches your customer and compliance needs—shared control plane, isolated data.',
    features: [
      'Customer-hosted data option (on-prem or customer cloud)',
      'Dedicated instances where required (by customer/segment)',
      'Per-tenant isolation patterns (data and runtime)',
      'Clear boundary: store configuration centrally, keep app data isolated (deployment dependent)',
    ],
  },
  {
    title: 'Scalability approach',
    tagline: 'Divide & conquer data placement',
    description: 'Scale by splitting your model data across server sets: keep everything together, or place specific models/attribute sets on different servers for independent scaling.',
    features: [
      'Horizontal scaling with per-attribute-set databases',
      'Choose where each model’s data lives: same server set or split across multiple server sets',
      'Move/partition hot or heavy attribute sets independently (deployment dependent)',
      'Reduce migration churn by schema-driven modeling',
      'Operate multiple domains without multiplying bespoke services',
    ],
  },
  {
    title: 'Integration with automation',
    tagline: 'Data + workflows',
    description: 'EGAV pairs naturally with SynaptaGrid Automation: model data, then automate lifecycle events and business processes.',
    features: [
      'Use EGAV as the governed system of record for workflow inputs/outputs',
      'Map entities to API inputs and outputs (workflow dependent)',
      'Support document + content + approval style workflows when combined with Automation',
    ],
  },
  {
    title: 'External systems & sync',
    tagline: 'Connect your models anywhere',
    description: 'Connect external systems to your EGAV models: pull data out, push updates back, and run full operations via generated APIs — or use the included CRUD UI when that’s enough.',
    features: [
      'Integrate external systems against generated CRUD APIs',
      'Pull model data into external systems for analytics, search, or downstream processing',
      'Push updates back into EGAV (create/update/delete operations)',
      'Optionally rely on the included CRUD UI for day-to-day operations',
    ],
  },
  {
    title: 'Developer & platform ergonomics',
    tagline: 'Ship faster with less glue',
    description: 'Reduce the long-tail cost of building platform features repeatedly for each domain team.',
    features: [
      'Eliminate per-model backend boilerplate',
      'Eliminate per-model CRUD UI work',
      'Standardized patterns across teams and environments',
      'Faster time-to-first-feature for new data domains',
    ],
  },
];

const egavOrganization: Array<{
  title: string;
  tagline: string;
  description: string;
  points: string[];
}> = [
  {
    title: 'Entity types',
    tagline: 'The “things” in your domain',
    description: 'Entity types define the kinds of records you store (e.g., Customer, Quote, Claim, Product).',
    points: [
      'Named domain objects you can version and govern',
      'Each type can have multiple attribute sets (modules)',
      'Supports relationships/links between entities',
    ],
  },
  {
    title: 'Attribute sets',
    tagline: 'Reusable modules of fields',
    description: 'Attribute sets are composable groups of fields you attach to entity types—shared across models and independently scalable.',
    points: [
      'Reuse the same field groups across multiple entity types',
      'Version and evolve modules independently',
      'Backed by per-attribute-set databases for scaling/placement',
    ],
  },
  {
    title: 'Fields (attributes)',
    tagline: 'Typed + validated',
    description: 'Fields carry types, constraints, defaults, and validation. This is the source of truth for schemas, APIs, and UI generation.',
    points: [
      'Data types, constraints, defaults, required/optional',
      'Validation rules align across UI + API',
      'Designed for evolving structures without migrations',
    ],
  },
  {
    title: 'Nested, repeatable field groups',
    tagline: 'Unlimited structure',
    description: 'Build document-like structures with nested sections and repeating groups at unlimited depth.',
    points: [
      'Repeatable groups (line items, evidence blocks, sections)',
      'Unlimited nesting for complex shapes',
      'Produces compliant JSON Schema + UI schema from the model',
    ],
  },
  {
    title: 'Schema artifacts',
    tagline: 'JSON Schema + UI schema',
    description: 'Your model yields compliant schema artifacts used for validation, rendering, and integration contracts.',
    points: [
      'Compliant JSON Schema output (structure + validation)',
      'Compliant UI schema output (rendering + behavior)',
      'Versioned alongside the model for safe evolution',
    ],
  },
  {
    title: 'Generated API surface',
    tagline: 'CRUD + OpenAPI',
    description: 'EGAV exposes models through generated CRUD APIs and generates OpenAPI specs including request/response schemas.',
    points: [
      'CRUD endpoints per entity type',
      'Listing with pagination + filtering',
      'Generated OpenAPI specs (endpoints + request/response schemas)',
    ],
  },
  {
    title: 'Generated CRUD UI',
    tagline: 'Frontend included',
    description: 'EGAV includes a dynamic CRUD frontend that renders forms and list views directly from the schemas.',
    points: [
      'Forms generated from schema + UI schema',
      'List views with filtering for operations and admins',
      'No bespoke UI per model required',
    ],
  },
  {
    title: 'Data placement (“divide & conquer”)',
    tagline: 'Choose where model data lives',
    description: 'Scale by placing different attribute sets on different server sets—keep everything together or split hot/heavy sets out.',
    points: [
      'Per-attribute-set databases enable horizontal scaling',
      'Place attribute sets on server set 1/2/3… or separate sets',
      'Scale the hottest parts independently (deployment dependent)',
    ],
  },
  {
    title: 'External APIs as model “options”',
    tagline: 'Dynamic dropdowns & lookups',
    description: 'Connect external APIs to your models so fields can offer dynamic options (e.g., dropdown values) sourced from external systems.',
    points: [
      'Configure option sources from external APIs (via OpenAPI-integrated endpoints)',
      'Use external reference data to populate dropdowns / selectors',
      'Keep UI, validation, and integrations aligned with the same model',
    ],
  },
  {
    title: 'Events (Kafka / SNS)',
    tagline: 'Send + receive all events',
    description: 'Publish EGAV model events (create/update/delete and more) to Kafka or SNS, and consume events back to create/update entities—event-driven integrations without bespoke glue per model.',
    points: [
      'Send all EGAV events to Kafka or SNS (model-driven event stream)',
      'Consume Kafka/SNS events to create/update entities in EGAV',
      'EGAV Automation consumes these events to run data processing workflows and write results back to EGAV',
      'Keep external systems in sync using model-driven contracts',
    ],
  },
];

const differentiators = [
  {
    title: "Customer-hosted data",
    description: "Data can reside on‑premises or in your chosen cloud. Each tenant's application data lives in a per-tenant database you can provision or operate yourself. We store only configuration — not your application data. Data does not leave your premises when you host it.",
    icon: "🔒",
  },
  {
    title: "Dedicated instances",
    description: "Dedicated AuthN, AuthZ, EGAV, and Automation instances per customer or segment. Identity and policy traffic stay isolated; full runtime isolation and capacity for high-compliance or high-scale accounts.",
    icon: "🏢",
  },
  {
    title: "RBAC across the platform",
    description: "Authorization applies everywhere: Control Plane, EGAV Core, and Automation. Every feature is behind role-based access. One AuthZ service, many orgs and apps — tenant admins assign roles and control who can do what.",
    icon: "🛡️",
  },
  {
    title: "Plans that fit",
    description: "Trial, starter, pro, and enterprise tiers with clear limits and features. Custom plans available: negotiated enterprise with your limits and feature set. No fixed list — plans are data, managed via Control Plane.",
    icon: "📋",
  },
  {
    title: "Any API, unlimited activities",
    description: "Send your data to the automation (API, Kafka, or SNS) → we process it → updates back to your system. Any API can be added via OpenAPI. No fixed activity list — unlimited activities per workflow. Activities auto-sync when APIs update.",
    icon: "🔌",
  },
  {
    title: "Rich workflow conditions",
    description: "Event attributes, entity state, time-based rules, AND/OR logic — one rule handles complex scenarios that would need many Zaps elsewhere. State-aware: query live entity data mid-execution.",
    icon: "🔍",
  },
  {
    title: "State-Aware Automation",
    description: "Workflows query live entity data mid-execution. Check inventory before fulfilling. Verify user permissions. Look up related records. Consumer tools can't do this.",
    icon: "🔍",
  },
  {
    title: "Complete Data Isolation",
    description: "Each customer gets their own isolated environment. Separate databases, separate workflows, separate configurations. Your data never mixes.",
    icon: "🔐",
  },
  {
    title: "DAG Workflow Execution",
    description: "True parallel branches, conditional paths, wait-all gates. Run 10 steps simultaneously, not sequentially. Process batches with real parallelism.",
    icon: "⚡",
  },
  {
    title: "Total control over automation",
    description: "Concurrency, per-activity throttling, per-source limits. Notifications on failure, success, or stale updates. Pause, stop, start, emergency throttle. Crash prevention (auto pause/resume on resource thresholds). No black box.",
    icon: "🎛️",
  },
  {
    title: "Enterprise Reliability",
    description: "Built on Temporal for durable execution. Workflows survive failures, retry intelligently, and maintain state. Complete audit trail for compliance.",
    icon: "✓",
  },
  {
    title: "White-Label Ready",
    description: "Custom domains, branded UI, per-tenant theming. Launch automation as a feature of your product, not a redirect to another service.",
    icon: "🏷️",
  },
];

const planTiers = [
  {
    tier: "Trial",
    tagline: "Prove value quickly",
    description: "Personal evaluation with smallest quotas, minimal automation, and short retention. Ideal for trying EGAV and Automation before committing.",
  },
  {
    tier: "Starter",
    tagline: "First production workload",
    description: "Small teams and limited schema scale. Uploads, basic audit, and limited automation schedules. Your first real deployment.",
  },
  {
    tier: "Pro",
    tagline: "Serious production",
    description: "Multiple workflows, higher usage, bulk operations, advanced search, longer retention. Approvals, branching, and operational visibility.",
  },
  {
    tier: "Enterprise",
    tagline: "Compliance + scale + control",
    description: "Configurable or custom limits, long retention, multi-environment, dedicated runtime options. Region choice, customer-hosted data, and dedicated instances when you need them.",
  },
];

const useCases = [
  {
    icon: "🚀",
    title: "SaaS Platforms",
    scenario: "Automation as a product capability",
    description: "Add workflow automation to your product with multi-tenant, white-label delivery. One platform decision instead of a long build.",
    outcome: "Ship in weeks, not quarters",
  },
  {
    icon: "📄",
    title: "Document Processing Pipeline",
    scenario: "Automate your data workflows",
    description: "Governed document pipelines: AI extraction, approval flows, sync to external systems. Audit trail and retention built in.",
    outcome: "Scale without operational risk",
  },
  {
    icon: "🔗",
    title: "Integration Hub",
    scenario: "Connect any system to any system",
    description: "REST, SOAP, GraphQL, databases. Configure once, use everywhere. No vendor lock-in on connectors.",
    outcome: "New integrations in hours",
  },
  {
    icon: "⚙️",
    title: "Operations Automation",
    scenario: "Business process orchestration",
    description: "Order fulfillment, inventory sync, customer onboarding. Durable execution and visibility so operations can own the process.",
    outcome: "Replace manual processes",
  },
];

const comparisonTable = [
  {
    feature: "Multi-tenant architecture",
    synaptagrid: "Native",
    zapier: "No",
    make: "No",
    n8n: "Limited",
  },
  {
    feature: "State-aware automation",
    synaptagrid: "Yes",
    zapier: "No",
    make: "No",
    n8n: "No",
  },
  {
    feature: "Dynamic data modeling",
    synaptagrid: "Built-in EGAV",
    zapier: "No",
    make: "No",
    n8n: "No",
  },
  {
    feature: "Horizontal scaling",
    synaptagrid: "Native PostgreSQL",
    zapier: "No",
    make: "No",
    n8n: "No",
  },
  {
    feature: "White-label / embed",
    synaptagrid: "Full",
    zapier: "Limited",
    make: "No",
    n8n: "Self-host",
  },
  {
    feature: "Complex conditions",
    synaptagrid: "Event + State + Time",
    zapier: "Basic filters",
    make: "Routers",
    n8n: "IF nodes",
  },
  {
    feature: "Durable execution",
    synaptagrid: "Temporal",
    zapier: "Basic retry",
    make: "Basic retry",
    n8n: "Basic retry",
  },
  {
    feature: "User imports own APIs",
    synaptagrid: "Any API via OpenAPI; unlimited activities",
    zapier: "No",
    make: "No",
    n8n: "Manual code",
  },
  {
    feature: "Self-hosted or on‑premises",
    synaptagrid: "Customer-hosted data",
    zapier: "No",
    make: "No",
    n8n: "Yes",
  },
  {
    feature: "Pricing model",
    synaptagrid: "Flexible",
    zapier: "Per task",
    make: "Per operation",
    n8n: "Free / Enterprise",
  },
];

const techStack = [
  { 
    name: "React", 
    role: "Frontend",
    logo: "https://cdn.jsdelivr.net/gh/devicons/devicon/icons/react/react-original.svg"
  },
  { 
    name: "Keycloak", 
    role: "Bridges our platform with your users",
    logo: "https://cdn.jsdelivr.net/gh/simple-icons/simple-icons/icons/keycloak.svg"
  },
  { 
    name: "Temporal", 
    role: "Workflow orchestration",
    logo: "https://avatars.githubusercontent.com/u/56493103?s=200&v=4"
  },
  { 
    name: "Apache Kafka", 
    role: "Event streaming",
    logo: "https://cdn.jsdelivr.net/gh/devicons/devicon/icons/apachekafka/apachekafka-original.svg"
  },
  { 
    name: "PostgreSQL", 
    role: "Data storage",
    logo: "https://cdn.jsdelivr.net/gh/devicons/devicon/icons/postgresql/postgresql-original.svg"
  },
  { 
    name: "FastAPI", 
    role: "REST APIs",
    logo: "https://cdn.jsdelivr.net/gh/devicons/devicon/icons/fastapi/fastapi-original.svg"
  },
  { 
    name: "Redis", 
    role: "Caching",
    logo: "https://cdn.jsdelivr.net/gh/devicons/devicon/icons/redis/redis-original.svg"
  },
  { 
    name: "Docker & K8s", 
    role: "Deployment",
    logo: "https://cdn.jsdelivr.net/gh/devicons/devicon/icons/kubernetes/kubernetes-plain.svg"
  },
  { 
    name: "AWS", 
    role: "Hosting",
    logo: "https://cdn.jsdelivr.net/gh/devicons/devicon/icons/amazonwebservices/amazonwebservices-original-wordmark.svg"
  },
];

const keycloakFeatures = [
  { title: "Single Sign-On (SSO)", description: "Your users sign in once and access all connected applications. Single sign-out supported." },
  { title: "OpenID Connect, OAuth 2.0, SAML 2.0", description: "Standard protocols so your apps and services plug into your existing identity strategy." },
  { title: "Identity brokering & social login", description: "Connect to your IdP or social providers (Google, GitHub, etc.) so your users use the logins they already have." },
  { title: "User federation", description: "Your LDAP or Active Directory; custom user storage so we don't hold a copy of your directory." },
  { title: "Centralized management", description: "Admin console for apps, users, roles, permissions, sessions. Account console so users manage profile, password, 2FA." },
  { title: "Authorization services", description: "Fine-grained permissions when you need more than roles." },
  { title: "Multi-tenancy", description: "Realms per tenant, brand, or environment so each of your customers can have their own identity boundary." },
  { title: "Two-factor authentication (2FA)", description: "OTP, WebAuthn, and other second factors for your users." },
  { title: "Client adapters", description: "Libraries and adapters for Java, JavaScript, Node, and more so your stack integrates easily." },
];

const integrations = [
  {
    name: "OpenAI",
    activities: "50+ activities",
    logo: "https://cdn.jsdelivr.net/gh/simple-icons/simple-icons/icons/openai.svg",
    examples: ["GPT-4 Completion", "DALL-E Generation", "Whisper Transcription", "Embeddings"],
  },
  {
    name: "Google Cloud",
    activities: "120+ activities", 
    logo: "https://cdn.jsdelivr.net/gh/devicons/devicon/icons/googlecloud/googlecloud-original.svg",
    examples: ["Vision AI", "Cloud Storage", "BigQuery", "Translate API"],
  },
  {
    name: "Google Workspace",
    activities: "80+ activities",
    logo: "https://cdn.jsdelivr.net/gh/devicons/devicon/icons/google/google-original.svg",
    examples: ["Gmail", "Google Sheets", "Google Drive", "Calendar"],
  },
  {
    name: "AWS",
    activities: "150+ activities",
    logo: "https://cdn.jsdelivr.net/gh/devicons/devicon/icons/amazonwebservices/amazonwebservices-plain-wordmark.svg",
    examples: ["S3", "Lambda", "DynamoDB", "SES"],
  },
  {
    name: "Salesforce",
    activities: "60+ activities",
    logo: "https://cdn.jsdelivr.net/gh/devicons/devicon/icons/salesforce/salesforce-original.svg",
    examples: ["Leads", "Contacts", "Opportunities", "Custom Objects"],
  },
  {
    name: "Databases",
    activities: "40+ activities",
    logo: "https://cdn.jsdelivr.net/gh/devicons/devicon/icons/postgresql/postgresql-original.svg",
    examples: ["PostgreSQL", "MySQL", "MongoDB", "Redis"],
  },
];

const targetAudience = [
  {
    icon: "📋",
    who: "Compliance-driven organizations",
    need: "Auditability and controlled change",
    message: "Full audit trail, versioning, retention, and RBAC. Govern who changes what and when.",
  },
  {
    icon: "🔗",
    who: "Integration-heavy teams",
    need: "Brittle or limited external APIs",
    message: "Total control over APIs: concurrency, notifications on failure/success/stale, pause/stop/start. SSO and role-based access.",
  },
  {
    icon: "📐",
    who: "Teams with complex, evolving data",
    need: "Can't keep rebuilding schemas",
    message: "Define entity types and attribute sets; get versioned evolution, APIs, and CRUD without custom code.",
  },
  {
    icon: "🏢",
    who: "Enterprises",
    need: "Dev/stage/prod and operational governance",
    message: "Multi-environment, dedicated instances, customer-hosted data. Plans that scale from trial to enterprise.",
  },
];

const caseStudies = [
  {
    slug: "financial-services",
    audience: "Compliance-driven organizations",
    sector: "Financial services",
    summary: "A regulated lender needed full auditability for document workflows and approvals without slowing down product delivery.",
    challenge: "The team was building document processing and approval workflows (KYC, contracts, underwriting) but couldn't meet compliance requirements with point solutions. They needed a full audit trail, retention policies, versioning, and role-based access so that who changed what and when was always traceable. Custom builds would have taken 12–18 months and tied up engineering.",
    solution: "They adopted SynaptaGrid for governed document pipelines: AI extraction, approval flows, and sync to external systems. RBAC, versioning, and retention are built in. Workflows run as DAGs with human-in-the-loop steps and conditional branches, so business logic stays in one place while satisfying audit and architecture review.",
    outcome: "They shipped compliant document workflows in weeks instead of quarters. Full audit trail and retention are in place; they passed architecture and compliance review. The team can add new document types and approval paths without custom code.",
    quote: "We needed to move fast without cutting corners on compliance. SynaptaGrid gave us governed pipelines and auditability out of the box.",
  },
  {
    slug: "saas-operations",
    audience: "Integration-heavy teams",
    sector: "SaaS operations",
    summary: "An operations team was drowning in brittle point-to-point integrations and had no visibility when external APIs failed.",
    challenge: "The company relied on dozens of integrations—CRM, billing, support, internal services—each wired with custom scripts or one-off connectors. When an API changed or failed, they found out from customer complaints. There was no single place to see run history, retry logic, or concurrency limits. Adding a new integration meant weeks of work and more fragile code.",
    solution: "They consolidated on SynaptaGrid as their automation layer. Any API can be added via OpenAPI; workflows are DAGs with parallel execution, conditional steps, and gated steps. They set concurrency and per-activity throttling, and get notifications on failure, success, or stale runs. Pause, stop, and start give them control when something goes wrong.",
    outcome: "New integrations go live in hours instead of weeks. They have full visibility into run history and failures, and can throttle or pause without deploying code. Operations owns the process instead of depending on engineering for every change.",
    quote: "One platform replaced our patchwork of scripts. We finally have visibility and control over every integration.",
  },
  {
    slug: "product-data-platform",
    audience: "Teams with complex, evolving data",
    sector: "Product & data platform",
    summary: "A product team’s schema changes required custom code and long release cycles every time the data model evolved.",
    challenge: "The product relied on a rich, evolving data model—entities, attributes, and relationships that changed as the business grew. Every schema change meant database migrations, API updates, and front-end work. Release cycles stretched to months. They couldn’t let non-engineers define new entity types or attributes without risking production.",
    solution: "They introduced SynaptaGrid’s data modeling (EGAV) alongside their automation. Entity types and attribute sets are defined in the platform; versioned evolution handles schema changes without big-bang migrations. They get APIs and CRUD for each entity type without writing custom code. Workflows can react to entity state and event attributes, so automation and data stay in sync.",
    outcome: "Schema evolution is now a configuration change, not a multi-week release. Product and operations can add entity types and attributes within guardrails. APIs and automation stay aligned with the data model.",
    quote: "We stopped treating every schema change as an engineering project. The platform handles evolution and we focus on product.",
  },
  {
    slug: "multi-tenant-b2b",
    audience: "Enterprises",
    sector: "Multi-tenant B2B",
    summary: "A B2B vendor needed strict dev/stage/prod isolation and customer-hosted data for high-compliance accounts.",
    challenge: "They sell into regulated and enterprise accounts. Some customers require data to stay in their own environment; others need guaranteed isolation between tenants. The team needed multi-environment support (dev, stage, prod), dedicated instances for high-compliance or high-scale customers, and a licensing model that could scale from trial to enterprise without re-architecting.",
    solution: "They use SynaptaGrid’s multi-tenant architecture with dedicated instances and customer-hosted data options. Identity and policy traffic are isolated per customer or segment; runtime isolation is clear. Plans scale from trial through starter, pro, and enterprise, with optional custom plans. They manage everything from a single control plane while meeting each customer’s compliance and hosting requirements.",
    outcome: "They onboard enterprise and regulated customers without custom deployments. Trial and starter tiers use shared infrastructure; high-compliance accounts get dedicated instances or customer-hosted data. The same platform serves every segment.",
    quote: "We needed one platform that could do trials, scale-ups, and locked-down enterprise. SynaptaGrid’s plans and isolation model made it possible.",
  },
  {
    slug: "custom-objects-saas",
    audience: "Teams with complex, evolving data",
    sector: "B2B SaaS (custom objects)",
    summary: "A SaaS product needed customer-specific data models (nested, repeatable structures) without turning every onboarding into a migration project.",
    challenge: "Enterprise customers demanded custom objects and deeply nested, repeatable field groups (think: forms, checklists, line items, and sub-sections). The product team couldn’t keep shipping migrations, bespoke APIs, and bespoke UIs for each customer. They also needed compliant JSON Schema and UI schema so external tooling and validations stayed aligned.",
    solution: "They adopted EGAV to model entities with unlimited nested, repeatable groups and generate compliant JSON Schema + UI schema. EGAV generated CRUD APIs and a full CRUD frontend (forms + listing with filtering), while external systems integrated via OpenAPI specs produced from the same models.",
    outcome: "They onboarded new customers in days instead of weeks. Schema changes became versioned configuration updates; APIs and UI updated automatically. Product shipped more domain features instead of rebuilding CRUD.",
    quote: "EGAV let us offer true custom objects without the migration treadmill — and our APIs stayed documented via OpenAPI automatically.",
  },
  {
    slug: "documents-line-items",
    audience: "Compliance-driven organizations",
    sector: "Insurance & claims",
    summary: "A claims workflow required complex, repeatable document structures (line items and nested evidence) with full auditability.",
    challenge: "Claims data included repeating line items, nested evidence blocks, and changing requirements by region. Teams were stuck between rigid relational schemas and brittle JSON blobs. They needed a model that could evolve safely, produce a compliant schema for validation, and preserve a full audit trail.",
    solution: "They modeled claims and attachments in EGAV using nested, repeatable field groups, then exposed them through generated CRUD APIs (with OpenAPI specs) and used the built-in CRUD UI for operations. Versioning and restore supported governance; audit logging provided traceability.",
    outcome: "They moved from ad-hoc JSON to governed, versioned models. Validation became consistent across services, and compliance review was simplified with clear audit trails and restore capability.",
    quote: "We finally had a flexible model that still felt governed. Nested structures became first-class instead of a constant workaround.",
  },
  {
    slug: "data-placement-scale-out",
    audience: "Enterprises",
    sector: "High-scale platforms",
    summary: "A platform team scaled a growing domain by splitting model data across server sets (“divide & conquer”) instead of re-architecting storage.",
    challenge: "A subset of models grew much faster than the rest (hot datasets and large attribute sets). Scaling the whole database cluster for every growth spike was expensive and risky. They needed flexibility to place different parts of the model on different server sets without changing how teams used the APIs.",
    solution: "They used EGAV’s per-attribute-set database approach and configured model data placement across multiple server sets: some attribute sets stayed co-located; hot/heavy sets were moved to separate server sets for independent scaling. APIs remained generated and consistent; operations continued to use the same CRUD and listing/filtering experience.",
    outcome: "They scaled the hottest workloads independently, reduced blast radius, and avoided repeated storage redesigns. Teams kept shipping features while infrastructure scaled behind the scenes.",
    quote: "Being able to split the model by server set was the breakthrough — we scaled the hot parts without dragging the whole system along.",
  },
  {
    slug: "forms-checklists-builder",
    audience: "Product teams & designers",
    sector: "Forms / checklists / inspections",
    summary: "A product team shipped a form + checklist builder with unlimited nested repeatable sections, without building custom schema tooling or CRUD per template.",
    challenge: "Users needed dynamic templates: sections, sub-sections, repeating groups, and conditional fields. The team tried hand-rolled JSON with brittle validation and a UI that constantly broke when templates changed. They needed compliant JSON Schema + UI schema, generated CRUD UI, and a reliable listing/filtering experience for operators.",
    solution: "They modeled templates and submissions in EGAV using unlimited nested, repeatable field groups. EGAV produced compliant JSON Schema and UI schema, generated CRUD APIs (with OpenAPI specs), and a full CRUD frontend with listing and filtering — keeping templates and runtime validation aligned.",
    outcome: "Designers shipped new templates weekly without migrations. Validation became consistent across systems, and operations gained a stable admin UI for submissions and audits.",
    quote: "Nested repeatables were non-negotiable. EGAV made them first-class — and the schema/UI stayed compliant automatically.",
  },
  {
    slug: "cpq-quotes-line-items",
    audience: "Product teams & designers",
    sector: "CPQ / quotes / billing",
    summary: "A CPQ product modeled quotes with complex repeating line items and nested pricing details, while keeping APIs and UI generation in sync.",
    challenge: "Quotes required repeating line items, nested discount rules, and evolving fields per customer segment. Every change previously meant DB migrations and coordinated API/UI releases. They also needed integration-ready APIs for downstream ERP and billing systems.",
    solution: "They used EGAV to model the quote structure with nested repeatable groups and version it safely. EGAV generated CRUD APIs and OpenAPI specs (request/response schemas included), plus a CRUD UI with listing and filtering for sales ops and finance teams.",
    outcome: "Schema evolution moved from quarterly releases to controlled configuration changes. Integrations consumed stable OpenAPI docs, and internal teams used the generated UI for day-to-day operations.",
    quote: "We stopped rebuilding the same quote CRUD every quarter — EGAV kept structure, APIs, and UI aligned.",
  },
  {
    slug: "product-catalog-configurator",
    audience: "Product teams & designers",
    sector: "Catalogs / configurators",
    summary: "A team built a flexible product catalog and configurator where product structures evolved continuously, without constant migrations.",
    challenge: "Products had variable attributes, nested option groups, bundles, and customer-specific fields. A rigid relational schema created constant migrations; a JSON blob approach lacked governance and validation. They needed a way to evolve safely and keep UIs consistent across products.",
    solution: "They hosted product models in EGAV: nested structures were modeled as repeatable groups; schemas were versioned; JSON Schema + UI schema were generated for validation and rendering. EGAV provided CRUD APIs (OpenAPI documented) and a CRUD UI with listing/filtering for catalog operations.",
    outcome: "Teams shipped new catalog structures quickly while keeping governance and validation. Operators managed catalog data through a consistent UI, and downstream systems integrated via generated APIs.",
    quote: "EGAV gave us a catalog that can evolve forever — without the migration treadmill.",
  },
  {
    slug: "master-data-admin",
    audience: "Operations & customer success",
    sector: "Internal admin systems",
    summary: "Ops teams managed governed reference data and customer configuration via generated CRUD UI instead of engineering tickets.",
    challenge: "Support and ops needed to manage reference datasets (plans, limits, mappings, settings) and customer-specific configuration. The old approach required engineers to add admin endpoints and UI screens per dataset. They needed a safe, auditable workflow with listing/filtering.",
    solution: "They modeled admin datasets in EGAV, enabling versioned evolution and auditability. EGAV generated CRUD APIs and a full CRUD frontend with listing and filtering, allowing ops to manage data within guardrails while keeping changes traceable.",
    outcome: "Ops resolved configuration requests in minutes, not days. Engineering focused on product features rather than building one-off admin tools.",
    quote: "The generated CRUD UI became our operations console — governed, searchable, and fast.",
  },
  {
    slug: "integration-hub-openapi-egav",
    audience: "Platform & integration teams",
    sector: "Integration hub",
    summary: "A platform team exposed EGAV models as a stable integration surface: CRUD APIs + OpenAPI specs, plus bidirectional sync with external systems.",
    challenge: "Multiple downstream systems needed the same entities, but every integration required bespoke mapping and undocumented endpoints. The team needed a consistent API contract with request/response schemas, plus the ability to pull/push data across systems safely.",
    solution: "They hosted the source-of-truth models in EGAV and used generated CRUD APIs with generated OpenAPI specs. External systems pulled data out and pushed updates back (full operations), while operators used the included CRUD UI for manual exceptions and audits.",
    outcome: "Integrations became repeatable and self-documenting. Teams onboarded new external systems faster and reduced integration drift with schema-driven contracts.",
    quote: "OpenAPI from the model was huge — every system could integrate consistently without bespoke docs.",
  },
];

const egavUseCases = [
  {
    icon: "🧩",
    title: "Custom objects (configurable SaaS)",
    scenario: "Customer-specific data models",
    description: "Offer customer-defined entities and fields with unlimited nested repeatable groups, and keep schema/UI/APIs aligned automatically.",
    outcome: "Ship custom objects without migrations",
    caseStudySlug: "custom-objects-saas",
  },
  {
    icon: "📝",
    title: "Forms & checklists builder",
    scenario: "Templates → submissions",
    description: "Build sections, sub-sections, and repeatable groups at any depth, then generate compliant JSON Schema/UI plus CRUD UI and listing/filtering.",
    outcome: "New templates weekly, governed",
    caseStudySlug: "forms-checklists-builder",
  },
  {
    icon: "🧾",
    title: "CPQ quotes & line items",
    scenario: "Repeatable commercial structures",
    description: "Model quotes with repeating line items and nested pricing rules; version it safely; expose OpenAPI-documented CRUD for downstream systems.",
    outcome: "Evolve quote models safely",
    caseStudySlug: "cpq-quotes-line-items",
  },
  {
    icon: "🛒",
    title: "Catalogs & configurators",
    scenario: "Evolving product structures",
    description: "Host flexible product models with nested option groups and bundles; generate schemas, UI, and CRUD, plus listing/filtering for ops.",
    outcome: "Evolve catalogs without migrations",
    caseStudySlug: "product-catalog-configurator",
  },
  {
    icon: "🛠️",
    title: "Internal admin & master data",
    scenario: "Ops-managed configuration",
    description: "Model reference data and configuration with auditability, then give ops a generated CRUD UI with listing/filtering.",
    outcome: "Fewer engineering tickets",
    caseStudySlug: "master-data-admin",
  },
  {
    icon: "🔌",
    title: "Integration hub",
    scenario: "Model-driven contracts",
    description: "Expose EGAV models through generated CRUD APIs and generated OpenAPI specs, and sync data in/out of external systems.",
    outcome: "Faster, consistent integrations",
    caseStudySlug: "integration-hub-openapi-egav",
  },
  {
    icon: "⚡",
    title: "Scale-out by data placement",
    scenario: "Divide & conquer",
    description: "Place different attribute sets on different server sets to scale hot models independently, without changing how teams use the APIs/UI.",
    outcome: "Independent scaling per domain",
    caseStudySlug: "data-placement-scale-out",
  },
  {
    icon: "🧾",
    title: "Document-like structures",
    scenario: "Line items + nested evidence",
    description: "Model document-shaped data (claims, invoices, applications) with repeatables and governance, plus compliant schema outputs.",
    outcome: "Governed, auditable documents",
    caseStudySlug: "documents-line-items",
  },
];

const egavAutomationOrganization: Array<{
  title: string;
  tagline: string;
  description: string;
  points: string[];
}> = [
  {
    title: 'Visual workflow builder',
    tagline: 'Steps chained into a DAG',
    description: 'Design workflows visually by chaining steps (activities), adding conditions, parallel branches, and human approvals.',
    points: [
      'Steps = activity nodes you can chain into pipelines',
      'Parallel branches, AND/OR conditions, wait-all gates',
      'State-aware workflows: query EGAV entities (or your own data) mid-execution',
    ],
  },
  {
    title: 'Activities catalog',
    tagline: '700+ built-in + bring your own',
    description: 'Choose from a large activity catalog (email, AI, data processing, SaaS APIs) or add your own activities and any external API-accessible service.',
    points: [
      'Pick from 700+ activities (and growing)',
      'Add your own activities (custom code or wrappers)',
      'Any external API-accessible service can become an activity via OpenAPI',
    ],
  },
  {
    title: 'External systems management',
    tagline: 'Your integrations registry',
    description: 'Manage integrations and APIs in one place: import OpenAPI, configure auth/connection details, and expose them as activities.',
    points: [
      'Import/manage APIs via OpenAPI',
      'Configure connection and authentication per external system',
      'Reuse the same integration across many workflows',
    ],
  },
  {
    title: 'Entities (EGAV) / Your data',
    tagline: 'The data your workflows operate on',
    description: 'Automation can run on your own data (API/Kafka/SNS inputs) and can also natively integrate with EGAV entities when you use EGAV.',
    points: [
      'Send your own events/data in via API, Kafka, or SNS',
      'When EGAV is used, entity state can drive branching and decisions',
      'Write back updates/results to your systems and (optionally) EGAV',
    ],
  },
  {
    title: 'Mappings',
    tagline: 'Connect entities ↔ activities',
    description: 'Map your data (and/or EGAV entities) to activity inputs and map activity outputs back into your data (and/or EGAV). These mappings are then used to build workflows quickly.',
    points: [
      'Map entity fields to API/activity inputs',
      'Map API/activity outputs back to entity fields',
      'Reuse mappings across multiple workflows',
    ],
  },
  {
    title: 'Events (Kafka / SNS)',
    tagline: 'Trigger and sync',
    description: 'Send and receive events via Kafka or SNS. When EGAV is used, you can stream all EGAV events; Automation consumes events to start workflows and keep systems in sync.',
    points: [
      'Send events to Kafka or SNS (your data stream)',
      'When EGAV is used: stream all EGAV events to Kafka or SNS',
      'Consume Kafka/SNS events to create/update EGAV entities or your own systems',
      'Automation consumes events to run data processing workflows and trigger emails/AI calls',
    ],
  },
  {
    title: 'Operations & reliability',
    tagline: 'Control, visibility, governance',
    description: 'Run workflows with durability, retries, throttling, and clear operational controls so automation can be a product capability.',
    points: [
      'Execution history, retries, and durable state',
      'Concurrency and per-activity throttling',
      'Notifications on failure/success/stale; pause/stop/start controls',
    ],
  },
];

// DAG Workflow visualization
function WorkflowVisualization() {
  return (
    <div className="dag-workflow">
      <div className="dag-header">
        <div className="dag-header-title">
          <span className="dag-title">Document Processing Pipeline</span>
          <span className="dag-subtitle">Automate your data workflows</span>
        </div>
        <span className="dag-status running">Running</span>
      </div>
      
      {/* Trigger */}
      <div className="dag-row">
        <div className="dag-node trigger">
          <div className="node-icon">📄</div>
          <div className="node-content">
            <span className="node-label">Trigger</span>
            <span className="node-name">document_uploaded</span>
          </div>
          <div className="node-status completed">✓</div>
        </div>
      </div>
      
      <div className="dag-connector single" />
      
      {/* Gateway - Condition Check */}
      <div className="dag-row">
        <div className="dag-node gateway">
          <div className="node-icon">◇</div>
          <div className="node-content">
            <span className="node-label">Gateway</span>
            <span className="node-name">Check document type</span>
          </div>
          <div className="node-status completed">✓</div>
        </div>
      </div>
      
      {/* Parallel Split */}
      <div className="dag-connector split">
        <div className="split-line left" />
        <div className="split-line center" />
        <div className="split-line right" />
      </div>
      
      {/* Parallel Activities */}
      <div className="dag-row parallel">
        <div className="dag-node activity completed">
          <div className="node-icon">🔍</div>
          <div className="node-content">
            <span className="node-label">AI Service</span>
            <span className="node-name">OCR Extract</span>
          </div>
          <div className="node-status completed">✓</div>
        </div>
        
        <div className="dag-node activity completed">
          <div className="node-icon">🧠</div>
          <div className="node-content">
            <span className="node-label">AI Service</span>
            <span className="node-name">Field Detection</span>
          </div>
          <div className="node-status completed">✓</div>
        </div>
        
        <div className="dag-node activity running">
          <div className="node-icon">🌐</div>
          <div className="node-content">
            <span className="node-label">Translation</span>
            <span className="node-name">Translate Text</span>
          </div>
          <div className="node-status running"><span className="spinner" /></div>
        </div>
      </div>
      
      {/* Merge */}
      <div className="dag-connector merge">
        <div className="merge-line left" />
        <div className="merge-line center" />
        <div className="merge-line right" />
      </div>
      
      {/* Merge Gateway */}
      <div className="dag-row">
        <div className="dag-node gateway pending">
          <div className="node-icon">◇</div>
          <div className="node-content">
            <span className="node-label">Wait All</span>
            <span className="node-name">Merge results</span>
          </div>
          <div className="node-status pending">○</div>
        </div>
      </div>
      
      <div className="dag-connector single" />
      
      {/* Conditional Branch */}
      <div className="dag-row">
        <div className="dag-node gateway pending">
          <div className="node-icon">◇</div>
          <div className="node-content">
            <span className="node-label">Condition</span>
            <span className="node-name">confidence {">"} 0.9?</span>
          </div>
          <div className="node-status pending">○</div>
        </div>
      </div>
      
      {/* Conditional Split */}
      <div className="dag-connector conditional">
        <div className="cond-line yes">
          <span className="cond-label">Yes</span>
        </div>
        <div className="cond-line no">
          <span className="cond-label">No</span>
        </div>
      </div>
      
      {/* Conditional Activities */}
      <div className="dag-row parallel conditional-row">
        <div className="dag-node activity pending">
          <div className="node-icon">💾</div>
          <div className="node-content">
            <span className="node-label">EGAV API</span>
            <span className="node-name">Auto-save</span>
          </div>
          <div className="node-status pending">○</div>
        </div>
        
        <div className="dag-node activity pending human">
          <div className="node-icon">👤</div>
          <div className="node-content">
            <span className="node-label">Human in the Loop</span>
            <span className="node-name">Manual Review</span>
          </div>
          <div className="node-status pending">○</div>
        </div>
      </div>
      
      {/* Final Merge */}
      <div className="dag-connector merge-final">
        <div className="merge-line left" />
        <div className="merge-line right" />
      </div>
      
      {/* End */}
      <div className="dag-row">
        <div className="dag-node end pending">
          <div className="node-icon">🔔</div>
          <div className="node-content">
            <span className="node-label">Notification</span>
            <span className="node-name">Notify User</span>
          </div>
          <div className="node-status pending">○</div>
        </div>
      </div>
      
      {/* Legend */}
      <div className="dag-legend">
        <div className="legend-item">
          <span className="legend-icon completed">✓</span>
          <span>Completed</span>
        </div>
        <div className="legend-item">
          <span className="legend-icon running"><span className="spinner small" /></span>
          <span>Running</span>
        </div>
        <div className="legend-item">
          <span className="legend-icon pending">○</span>
          <span>Pending</span>
        </div>
        <div className="legend-item">
          <span className="legend-icon gateway">◇</span>
          <span>Gateway</span>
        </div>
      </div>
    </div>
  );
}

const HERO_SVG_SCROLL_FACTOR = 0.06;
/** Gravity: dots pull toward mouse. Strength and max pull in viewBox units. */
const HERO_GRAVITY_STRENGTH = 1200;
const HERO_GRAVITY_SOFTEN = 100;
const HERO_GRAVITY_MAX_PULL = 28;

/** Hero dots in SVG order: cx, cy, r (viewBox units). */
const HERO_DOTS: { cx: number; cy: number; r: number }[] = [
  { cx: 180, cy: 120, r: 3 }, { cx: 320, cy: 180, r: 2.5 }, { cx: 480, cy: 100, r: 4 },
  { cx: 620, cy: 200, r: 2 }, { cx: 780, cy: 140, r: 3.5 }, { cx: 920, cy: 220, r: 2 },
  { cx: 1050, cy: 160, r: 3 }, { cx: 220, cy: 280, r: 2 }, { cx: 400, cy: 320, r: 3 },
  { cx: 560, cy: 380, r: 2.5 }, { cx: 720, cy: 300, r: 2 }, { cx: 860, cy: 360, r: 3 },
  { cx: 1000, cy: 400, r: 2 }, { cx: 300, cy: 440, r: 2.5 }, { cx: 500, cy: 480, r: 2 },
  { cx: 680, cy: 460, r: 3 }, { cx: 840, cy: 500, r: 2 },
];
/** Path edges as [fromIndex, toIndex] into HERO_DOTS. */
const HERO_PATH_EDGES: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [0, 7], [1, 8], [2, 8], [8, 9], [3, 10], [9, 10],
  [10, 11], [4, 11], [11, 12], [7, 13], [8, 13], [13, 14], [9, 14], [14, 15], [10, 15], [15, 16], [11, 16],
];

function LandingPage() {
  const [user, setUser] = useState<{ name: string; email?: string } | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const heroRef = useRef<HTMLElement | null>(null);
  const heroSvgRef = useRef<SVGSVGElement | null>(null);
  const [heroMouse, setHeroMouse] = useState<{ x: number; y: number } | null>(null);
  const [heroScrollY, setHeroScrollY] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetchCurrentUser().then((u) => {
      if (!cancelled) {
        setUser(u);
        setAuthChecked(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const hero = heroRef.current;
    const svg = heroSvgRef.current;
    if (!hero || !svg) return;
    const onMouseMove = (e: MouseEvent) => {
      const rect = hero.getBoundingClientRect();
      if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) {
        setHeroMouse(null);
        return;
      }
      const pt = svg.createSVGPoint();
      pt.x = e.clientX;
      pt.y = e.clientY;
      const ctm = svg.getScreenCTM();
      if (!ctm) return;
      const svgPt = pt.matrixTransform(ctm.inverse());
      setHeroMouse({ x: svgPt.x, y: svgPt.y });
    };
    const onMouseLeave = () => setHeroMouse(null);
    hero.addEventListener('mousemove', onMouseMove);
    hero.addEventListener('mouseleave', onMouseLeave);
    return () => {
      hero.removeEventListener('mousemove', onMouseMove);
      hero.removeEventListener('mouseleave', onMouseLeave);
    };
  }, []);

  useEffect(() => {
    const onScroll = () => setHeroScrollY(window.scrollY);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const pulledDots = useMemo(() => {
    if (!heroMouse) return HERO_DOTS.map((d) => ({ ...d, cx: d.cx, cy: d.cy }));
    return HERO_DOTS.map((dot) => {
      const dx = heroMouse.x - dot.cx;
      const dy = heroMouse.y - dot.cy;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const pull = Math.min(HERO_GRAVITY_MAX_PULL, HERO_GRAVITY_STRENGTH / (dist + HERO_GRAVITY_SOFTEN));
      const shiftX = (dx / dist) * pull;
      const shiftY = (dy / dist) * pull;
      return { ...dot, cx: dot.cx + shiftX, cy: dot.cy + shiftY };
    });
  }, [heroMouse]);

  const heroSvgScrollTransform = `translate(0, ${heroScrollY * HERO_SVG_SCROLL_FACTOR}px)`;

  return (
    <div className="app">
      <TopNav user={user} authChecked={authChecked} />
      <header className="hero" id="top" ref={heroRef}>
        <div className="hero-bg-svg" aria-hidden="true">
          <svg ref={heroSvgRef} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 600" fill="none" preserveAspectRatio="xMidYMid slice">
            <g style={{ transform: heroSvgScrollTransform }}>
              <defs>
                <linearGradient id="heroLineGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="rgba(59,130,246,0.06)" />
                  <stop offset="50%" stopColor="rgba(139,92,246,0.08)" />
                  <stop offset="100%" stopColor="rgba(59,130,246,0.06)" />
                </linearGradient>
                <linearGradient id="heroNodeGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="rgba(59,130,246,0.12)" />
                  <stop offset="100%" stopColor="rgba(139,92,246,0.08)" />
                </linearGradient>
                <pattern id="heroGrid" width="60" height="60" patternUnits="userSpaceOnUse">
                  <path d="M 60 0 L 0 0 0 60" fill="none" stroke="rgba(255,255,255,0.02)" strokeWidth="0.5" />
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill="url(#heroGrid)" />
              {pulledDots.map((dot, i) => (
                <circle key={i} cx={dot.cx} cy={dot.cy} r={dot.r} fill="url(#heroNodeGrad)" />
              ))}
              {HERO_PATH_EDGES.map(([a, b], i) => {
                const w = i < 6 ? (i % 2 === 0 ? 0.8 : 0.6) : (i % 2 === 0 ? 0.6 : 0.5);
                const o = i < 6 ? (i % 2 === 0 ? 0.7 : 0.6) : (i % 2 === 0 ? 0.6 : 0.5);
                return (
                  <path
                    key={i}
                    d={`M ${pulledDots[a].cx} ${pulledDots[a].cy} L ${pulledDots[b].cx} ${pulledDots[b].cy}`}
                    stroke="url(#heroLineGrad)"
                    strokeWidth={w}
                    strokeOpacity={o}
                  />
                );
              })}
            </g>
          </svg>
        </div>
        <div className="hero-content">
          <p className="eyebrow">Automation infrastructure for SaaS</p>
          <h1>Platform strategy without the 18‑month build.</h1>
          <p className="hero-subtitle">
            Governed data modeling and durable workflows for SaaS. Send events via API, Kafka, or SNS, process them reliably, and write results back—multi-tenant and white-label by design. Use EGAV to model and store complex data (cloud or customer-hosted) with versioning, generated APIs, and dynamic CRUD UI. Ship in weeks.
          </p>
          <div className="hero-actions">
            <Link className="primary-button" to="/request-demo">
              Schedule your technical review
            </Link>
            <a className="secondary-button" href="#how-it-works">
              See the platform
            </a>
          </div>
          <div className="hero-metrics">
            {heroStats.map((stat) => (
              <div key={stat.label}>
                <strong>{stat.value}</strong>
                <span>{stat.label}</span>
                <small>{stat.detail}</small>
              </div>
            ))}
          </div>
        </div>
      </header>

      <main>
        {/* The Problem */}
        <section className="section">
          <div className="section-header">
            <h2>Decisions you're facing</h2>
            <p>
              These trade-offs show up on every platform roadmap.
            </p>
          </div>
          <div className="problems-grid">
            {problems.map((problem) => (
              <div className="problem-card" key={problem.title}>
                <span className="problem-icon">{problem.icon}</span>
                <div className="problem-content">
                  <h3>{problem.title}</h3>
                  <p>{problem.description}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* What It Is */}
        <section className="section alt" id="how-it-works">
          <div className="section-header">
            <h2>{whatItIs.headline}</h2>
            <p>
              Use both together or adopt incrementally. Architecture that fits your roadmap.
            </p>
          </div>
          <div className="products-grid">
            {whatItIs.products.map((product) => (
              <div className="product-card" key={product.name}>
                <h3>{product.name}</h3>
                <p className="product-tagline">{product.tagline}</p>
                <p>{product.description}</p>
                <ul>
                  {product.features.map((feature) => (
                    <li key={feature}>{feature}</li>
                  ))}
                </ul>
                {product.name.toLowerCase().includes('egav') && (
                  <div className="product-actions">
                    <Link className="secondary-button" to="/egav">
                      Learn more
                    </Link>
                    <Link className="primary-button" to="/request-demo">
                      Schedule your technical review
                    </Link>
                  </div>
                )}
                {product.name.toLowerCase().includes('automation') && (
                  <div className="product-actions">
                    <Link className="secondary-button" to="/egav-automation">
                      Learn more
                    </Link>
                    <Link className="primary-button" to="/request-demo">
                      Schedule your technical review
                    </Link>
                  </div>
                )}
              </div>
            ))}
          </div>
          
          {/* Usage Modes */}
          <div className="usage-modes">
            <div className="usage-mode">
              <div className="mode-icon">🔗</div>
              <div className="mode-content">
                <h4>Full Platform</h4>
                <p>Use EGAV to model and store your data — on our cloud or yours. Define a model, get instant APIs and UI, then run workflows: add any API, map entities to inputs and outputs, and operate governed pipelines for documents, uploads, content generation, and approvals.</p>
                <div className="mode-flow">
                  <span>EGAV: model & store (our cloud or yours)</span>
                  <span className="flow-arrow">→</span>
                  <span>Instant APIs + UI</span>
                  <span className="flow-arrow">→</span>
                  <span>Workflows for anything</span>
                </div>
              </div>
            </div>
            <div className="usage-mode">
              <div className="mode-icon">⚡</div>
              <div className="mode-content">
                <h4>Workflows for anything</h4>
                <p>Send your data to the automation (API, Kafka, or SNS) → we process it → you get the updates back to your system. Any API via OpenAPI; unlimited activities. Rich conditions and full operational control, with support for documents, uploads, content generation, and approvals.</p>
                <div className="mode-flow">
                  <span>Send data in (API / Kafka / SNS)</span>
                  <span className="flow-arrow">→</span>
                  <span>We process</span>
                  <span className="flow-arrow">→</span>
                  <span>Updates back to your system</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* What Makes It Different */}
        <section className="section">
          <div className="section-header">
            <h2>What makes it different</h2>
            <p>
              Any API, unlimited activities, rich workflow conditions, and full control over automation — infrastructure for building automation into your product.
            </p>
          </div>
          <div className="differentiators-grid">
            {differentiators.map((diff) => (
              <div className="differentiator-card" key={diff.title}>
                <span className="diff-icon">{diff.icon}</span>
                <div className="diff-content">
                  <h3>{diff.title}</h3>
                  <p>{diff.description}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Plans and tiers */}
        <section className="section alt" id="plans">
          <div className="section-header">
            <h2>Plans that scale with your organization</h2>
            <p>
              Trial to enterprise. Clear tiers and optional custom plans — choose the right fit for scope and budget.
            </p>
          </div>
          <div className="plans-grid">
            {planTiers.map((plan) => (
              <div className="plan-tier-card" key={plan.tier}>
                <h3>{plan.tier}</h3>
                <p className="plan-tagline">{plan.tagline}</p>
                <p className="plan-description">{plan.description}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Comparison Table */}
        <section className="section alt">
          <div className="section-header">
            <h2>Evaluate against alternatives</h2>
            <p>
              Compare capabilities when you're choosing a platform — we fit where you've outgrown consumer tools.
            </p>
          </div>
          <div className="comparison-table-wrapper">
            <table className="comparison-table">
              <thead>
                <tr>
                  <th>Criteria</th>
                  <th className="highlight">SynaptaGrid</th>
                  <th>Zapier</th>
                  <th>Make</th>
                  <th>n8n</th>
                </tr>
              </thead>
              <tbody>
                {comparisonTable.map((row) => (
                  <tr key={row.feature}>
                    <td>{row.feature}</td>
                    <td className="highlight">{row.synaptagrid}</td>
                    <td>{row.zapier}</td>
                    <td>{row.make}</td>
                    <td>{row.n8n}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Use Cases */}
        <section className="section">
          <div className="section-header">
            <h2>Where it fits your roadmap</h2>
            <p>
              Use cases that align with product and platform strategy — SaaS automation to enterprise integration.
            </p>
          </div>
          <div className="use-cases-grid">
            {useCases.map((useCase) => (
              <div className="use-case-card" key={useCase.title}>
                <div className="use-case-icon">{useCase.icon}</div>
                <h3>{useCase.title}</h3>
                <p className="scenario">{useCase.scenario}</p>
                <p className="description">{useCase.description}</p>
                <div className="outcome-badge">{useCase.outcome}</div>
              </div>
            ))}
          </div>
        </section>

        {/* Workflow Visualization */}
        <section className="section alt" id="workflow">
          <div className="section-header">
            <h2>See the platform in action</h2>
            <p>
              DAG-like execution with parallel steps, conditional branches, gated approvals, and human-in-the-loop workflows.
              One workflow replaces many point-to-point automations.
            </p>
          </div>
          <WorkflowVisualization />
        </section>

        {/* Integrations */}
        <section className="section">
          <div className="section-header">
            <h2>700+ built-in activities</h2>
            <p>
              Google and OpenAI included. Extend with any API via OpenAPI — no waiting on vendor roadmaps.
            </p>
          </div>
          <div className="integrations-grid">
            {integrations.map((integration) => (
              <div className="integration-card" key={integration.name}>
                <div className="integration-header">
                  <img src={integration.logo} alt={integration.name} className="integration-logo" />
                  <div className="integration-info">
                    <span className="integration-name">{integration.name}</span>
                    <span className="integration-count">{integration.activities}</span>
                  </div>
                </div>
                <div className="integration-examples">
                  {integration.examples.map((example) => (
                    <span className="example-tag" key={example}>{example}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
          
          {/* OpenAPI Import Feature */}
          <div className="openapi-feature">
            <div className="openapi-content">
              <div className="openapi-icon">📄</div>
              <div className="openapi-text">
                <h3>Import any API</h3>
                <p>Paste an OpenAPI/Swagger URL in the UI and instantly get all endpoints as workflow activities. When the API updates, your activities sync automatically. No code required.</p>
              </div>
            </div>
            <div className="openapi-steps">
              <div className="openapi-step">
                <span className="step-number">1</span>
                <span className="step-text">Paste OpenAPI URL</span>
              </div>
              <span className="step-arrow">→</span>
              <div className="openapi-step">
                <span className="step-number">2</span>
                <span className="step-text">Select endpoints</span>
              </div>
              <span className="step-arrow">→</span>
              <div className="openapi-step done">
                <span className="step-number">✓</span>
                <span className="step-text">42 activities ready</span>
              </div>
            </div>
          </div>
          
          <div className="integrations-cta">
            <p>Slack, HubSpot, Stripe, Twilio, SendGrid + any API with an OpenAPI spec.</p>
          </div>
        </section>

        {/* Who It's For */}
        <section className="section alt">
          <div className="section-header">
            <h2>Who it's for</h2>
            <p>
              Teams that need governance, compliance, and scale without betting the roadmap on a long build.
            </p>
          </div>
          <div className="audience-grid">
            {targetAudience.map((audience) => (
              <div className="audience-card" key={audience.who}>
                <span className="audience-icon">{audience.icon}</span>
                <h3>{audience.who}</h3>
                <p className="need">{audience.need}</p>
                <p className="message">{audience.message}</p>
              </div>
            ))}
          </div>
          <p className="section-cta-link">
            <Link to="/case-studies">Read case studies →</Link>
          </p>
        </section>

        {/* Tech Stack */}
        <section className="section">
          <div className="section-header">
            <h2>Stack you can rely on</h2>
            <p>
              We host on AWS. Proven, enterprise-grade components — React, Keycloak, Temporal, PostgreSQL, and more. Lower risk, easier to defend in architecture review.
            </p>
          </div>
          <div className="tech-grid">
            {techStack.map((tech) => (
              <div className="tech-item" key={tech.name}>
                <img src={tech.logo} alt={tech.name} className="tech-logo" />
                <strong>{tech.name}</strong>
                <span>{tech.role}</span>
              </div>
            ))}
          </div>

          <div className="keycloak-features">
            <h3>Keycloak: bridge between our system and your users</h3>
            <p className="keycloak-features-intro">
              We use Keycloak to connect our platform to your users and your identity stack. You get the well-known features you expect from a modern IdP.
            </p>
            <div className="keycloak-features-grid">
              {keycloakFeatures.map((f) => (
                <div className="keycloak-feature-card" key={f.title}>
                  <h4>{f.title}</h4>
                  <p>{f.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section className="section cta">
          <div>
            <h2>Ready to evaluate?</h2>
            <p>
              Schedule your technical review. See the platform, discuss your architecture, and get a clear recommendation for your use case.
            </p>
          </div>
          <div className="cta-actions">
            <Link className="primary-button" to="/request-demo">
              Schedule your technical review
            </Link>
            <Link className="secondary-button" to="/register">
              Evaluate the platform
            </Link>
          </div>
        </section>
      </main>

      <footer className="footer">
        <p>SynaptaGrid — Automation infrastructure for SaaS</p>
        <p className="footer-sub">Governed data. Reliable automation. Multi-tenant. White-label. Deployment-flexible.</p>
        <p className="footer-links">
          <Link to="/contact-us">Contact us</Link>
          <Link to="/request-demo">Schedule your technical review</Link>
        </p>
      </footer>
    </div>
  );
}

const TIMEZONE_OPTIONS = getTimezoneOptions();

function formatPreferredTime(dateStr: string, timeStr: string): string {
  if (!dateStr || !timeStr) return '';
  const d = new Date(`${dateStr}T${timeStr}`);
  if (Number.isNaN(d.getTime())) return `${dateStr} ${timeStr}`;
  const day = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${day} at ${time}`;
}

function DemoRequestPage() {
  const captcha = useCaptcha();
  const [submitting, setSubmitting] = useState(false);
  const [submitMessage, setSubmitMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const today = useMemo(() => {
    const t = new Date();
    return t.toISOString().slice(0, 10);
  }, []);
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    company: '',
    preferred_date: '',
    preferred_time_slot: '09:00',
    timezone: (typeof Intl !== 'undefined' ? (Intl.DateTimeFormat().resolvedOptions().timeZone ?? '') : '') || 'UTC',
    role: '',
    use_case: '',
    notes: '',
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitMessage(null);
    let token: string | null = null;
    if (captcha.captchaEnabled) {
      token = await captcha.getToken('schedule_demo');
    }
    const hasToken = typeof token === 'string' && token.trim().length > 0;
    if (!hasToken) {
      setSubmitMessage({
        type: 'error',
        text: captcha.captchaEnabled
          ? 'Please complete the captcha before submitting.'
          : 'Captcha is required but not available. Please refresh the page and try again.',
      });
      return;
    }
    const preferredTimeStr = formatPreferredTime(formData.preferred_date, formData.preferred_time_slot);
    if (!formData.preferred_date || !preferredTimeStr) {
      setSubmitMessage({ type: 'error', text: 'Please select a date and time for your technical review.' });
      return;
    }
    setSubmitting(true);
    try {
      const notesParts = [
        formData.role && `Role: ${formData.role}`,
        formData.use_case && `Use case: ${formData.use_case}`,
        formData.notes,
      ].filter(Boolean);
      const body = {
        name: formData.name,
        email: formData.email,
        company: formData.company,
        preferred_time: preferredTimeStr,
        timezone: formData.timezone,
        notes: notesParts.length ? notesParts.join('\n\n') : undefined,
        captcha_token: token!.trim(),
      };
      const res = await fetch(`${getControlPlaneBaseUrl()}${SCHEDULE_DEMO_PATH}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'omit',
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const message = await parseApiErrorMessage(res, 'Something went wrong. Please try again.');
        setSubmitMessage({ type: 'error', text: message });
        captcha.reset();
        return;
      }
      setSubmitMessage({ type: 'success', text: 'Thanks! We\'ll be in touch soon.' });
      setFormData((prev) => ({ ...prev, name: '', email: '', company: '', preferred_date: '', preferred_time_slot: '09:00', notes: '', role: '', use_case: '' }));
      captcha.reset();
    } catch (err) {
      setSubmitMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Something went wrong. Please try again.',
      });
      captcha.reset();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="app">
      <TopNav />
      <header className="hero hero-compact">
        <div className="hero-content">
          <p className="eyebrow">Schedule your technical review</p>
          <h1>See the platform with your team</h1>
          <p className="hero-subtitle">
            We'll walk through the platform, discuss your architecture and use case,
            and show how SynaptaGrid fits your roadmap.
          </p>
          <Link className="secondary-button" to="/">
            Back to overview
          </Link>
        </div>
      </header>

      <main>
        <section className="section form-section form-section-demo">
          <div className="section-header">
            <h2>Schedule your technical review</h2>
            <p>Tell us your use case and we'll show how SynaptaGrid fits your architecture and plans.</p>
          </div>
          {captcha.loading && <p className="form-note">Loading form...</p>}
          {captcha.error && <p className="form-note form-error">{captcha.error}</p>}
          {submitMessage?.type === 'success' && (
            <div className="form-success-banner" role="alert">
              <span className="form-success-icon" aria-hidden="true">✓</span>
              <span>{submitMessage.text}</span>
            </div>
          )}
          <form className="form form-demo" onSubmit={handleSubmit}>
            <div className="form-row form-row-2">
              <label className="form-field">
                <span className="form-label">Full name *</span>
                <input type="text" name="name" value={formData.name} onChange={handleChange} required maxLength={200} placeholder="Your name" />
              </label>
              <label className="form-field">
                <span className="form-label">Work email *</span>
                <input type="email" name="email" value={formData.email} onChange={handleChange} required placeholder="you@company.com" />
              </label>
            </div>
            <label className="form-field">
              <span className="form-label">Company *</span>
              <input type="text" name="company" value={formData.company} onChange={handleChange} required maxLength={200} placeholder="Your company" />
            </label>
            <div className="form-group">
              <span className="form-group-title">Preferred demo time</span>
              <div className="form-row form-row-2">
                <label className="form-field">
                  <span className="form-label">Date *</span>
                  <input
                    type="date"
                    name="preferred_date"
                    value={formData.preferred_date}
                    onChange={handleChange}
                    required
                    min={today}
                    aria-label="Preferred date"
                  />
                </label>
                <label className="form-field">
                  <span className="form-label">Time *</span>
                  <input
                    type="time"
                    name="preferred_time_slot"
                    value={formData.preferred_time_slot}
                    onChange={handleChange}
                    required
                    min="06:00"
                    max="22:00"
                    step="900"
                    aria-label="Preferred time"
                  />
                </label>
              </div>
              <p className="form-hint">We’ll reach out to confirm. Business hours only.</p>
            </div>
            <label className="form-field">
              <span className="form-label">Your timezone *</span>
              <select
                name="timezone"
                value={formData.timezone}
                onChange={handleChange}
                required
                className="form-select-timezone"
                aria-label="Timezone"
              >
                {!formData.timezone && <option value="">Select timezone...</option>}
                {TIMEZONE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="form-row form-row-2">
              <label className="form-field">
                <span className="form-label">Role *</span>
                <input type="text" name="role" value={formData.role} onChange={handleChange} required placeholder="e.g. CTO, VP Engineering" />
              </label>
              <label className="form-field">
                <span className="form-label">What are you building?</span>
                <select name="use_case" value={formData.use_case} onChange={handleChange}>
                  <option value="">Select use case...</option>
                  <option value="saas_automation">Add automation to my SaaS product</option>
                  <option value="integration_platform">Build an integration platform</option>
                  <option value="document_processing">Document processing workflows</option>
                  <option value="operations">Internal operations automation</option>
                  <option value="other">Other</option>
                </select>
              </label>
            </div>
            <label className="form-field">
              <span className="form-label">Tell us more about your needs</span>
              <textarea name="notes" rows={4} value={formData.notes} onChange={handleChange} placeholder="What problems are you trying to solve? What have you tried?" maxLength={4000} />
            </label>
            {submitMessage && submitMessage.type === 'error' && (
              <p className="form-message form-message-error">
                {submitMessage.text}
              </p>
            )}
            <button className="primary-button form-submit" type="submit" disabled={submitting || captcha.loading}>
              {submitting ? 'Sending...' : 'Schedule your technical review'}
            </button>
            {captcha.captchaEnabled && (
              <p className="form-note form-captcha-badge">This form is protected by reCAPTCHA.</p>
            )}
          </form>
        </section>
      </main>
    </div>
  );
}

function ContactUsPage() {
  const captcha = useCaptcha();
  const [submitting, setSubmitting] = useState(false);
  const [submitMessage, setSubmitMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    company: '',
    message: '',
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitMessage(null);
    let token: string | null = null;
    if (captcha.captchaEnabled) {
      token = await captcha.getToken('contact_us');
    }
    const hasToken = typeof token === 'string' && token.trim().length > 0;
    if (!hasToken) {
      setSubmitMessage({
        type: 'error',
        text: captcha.captchaEnabled
          ? 'Please complete the captcha before submitting.'
          : 'Captcha is required but not available. Please refresh the page and try again.',
      });
      return;
    }
    setSubmitting(true);
    try {
      const body = {
        name: formData.name,
        email: formData.email,
        company: formData.company,
        message: formData.message,
        source_page: window.location.pathname || undefined,
        captcha_token: token!.trim(),
      };
      const res = await fetch(`${getControlPlaneBaseUrl()}${CONTACT_US_PATH}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'omit',
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const message = await parseApiErrorMessage(res, 'Something went wrong. Please try again.');
        setSubmitMessage({ type: 'error', text: message });
        captcha.reset();
        return;
      }
      setSubmitMessage({ type: 'success', text: 'Thanks! We\'ll get back to you soon.' });
      setFormData({ name: '', email: '', company: '', message: '' });
      captcha.reset();
    } catch (err) {
      setSubmitMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Something went wrong. Please try again.',
      });
      captcha.reset();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="app">
      <TopNav />
      <header className="hero hero-compact">
        <div className="hero-content">
          <p className="eyebrow">Technical and sales inquiries</p>
          <h1>Contact us</h1>
          <p className="hero-subtitle">
            Questions about architecture, pricing, or fit? We typically respond within one business day.
          </p>
          <Link className="secondary-button" to="/">
            Back to overview
          </Link>
        </div>
      </header>

      <main>
        <section className="section form-section">
          <div className="section-header">
            <h2>Send a message</h2>
            <p>We typically respond within one business day.</p>
          </div>
          {captcha.loading && <p className="form-note">Loading form...</p>}
          {captcha.error && <p className="form-note form-error">{captcha.error}</p>}
          {submitMessage?.type === 'success' && (
            <div className="form-success-banner" role="alert">
              <span className="form-success-icon" aria-hidden="true">✓</span>
              <span>{submitMessage.text}</span>
            </div>
          )}
          <form className="form" onSubmit={handleSubmit}>
            <label>
              Name *
              <input type="text" name="name" value={formData.name} onChange={handleChange} required maxLength={200} />
            </label>
            <label>
              Email *
              <input type="email" name="email" value={formData.email} onChange={handleChange} required />
            </label>
            <label>
              Company *
              <input type="text" name="company" value={formData.company} onChange={handleChange} required maxLength={200} />
            </label>
            <label>
              Message *
              <textarea name="message" rows={5} value={formData.message} onChange={handleChange} required placeholder="How can we help?" maxLength={4000} />
            </label>
            {submitMessage && submitMessage.type === 'error' && (
              <p className="form-message form-message-error">
                {submitMessage.text}
              </p>
            )}
            <button className="primary-button form-submit" type="submit" disabled={submitting || captcha.loading}>
              {submitting ? 'Sending...' : 'Send message'}
            </button>
            {captcha.captchaEnabled && (
              <p className="form-note form-captcha-badge">This form is protected by reCAPTCHA.</p>
            )}
          </form>
        </section>
      </main>
    </div>
  );
}

function EgavPage() {
  const egav = whatItIs.products.find((p) => p.name.toLowerCase().includes('egav'));
  const features = Array.isArray(egav?.features) ? (egav?.features ?? []) : [];
  return (
    <div className="app">
      <TopNav />

      <header className="hero hero-compact">
        <div className="hero-content">
          <p className="eyebrow">Product</p>
          <h1>SynaptaGrid EGAV</h1>
          <p className="hero-subtitle">
            Model and store your data — on our cloud or yours. Versioned schema evolution, generated APIs,
            and dynamic CRUD frontends.
          </p>
          <div className="hero-actions">
            <Link className="primary-button" to="/request-demo">
              Schedule your technical review
            </Link>
            <Link className="secondary-button" to="/register">
              Evaluate
            </Link>
          </div>
        </div>
      </header>

      <main>
        <section className="section">
          <div className="section-header">
            <h2>What EGAV is</h2>
            <p>
              Flexible entity and attribute modeling with governance. Define entity types and attribute sets,
              then ship changes safely with versioning and full history.
            </p>
          </div>
          <div className="product-card">
            <h3>{egav?.name ?? 'SynaptaGrid EGAV'}</h3>
            <p className="product-tagline">{egav?.tagline ?? 'Model and store your data — on our cloud or yours'}</p>
            <p>{egav?.description ?? 'EGAV helps you model and store complex data without rebuilding APIs and UIs for every schema change.'}</p>
            {features.length > 0 && (
              <ul>
                {features.map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section className="section alt">
          <div className="section-header">
            <h2>How EGAV is organized</h2>
            <p>
              EGAV is built from a small set of composable building blocks. Model once, then get schemas, APIs, UI, events, and scale knobs out of the same source of truth.
            </p>
          </div>
          <div className="products-grid">
            {egavOrganization.map((part) => (
              <div className="product-card" key={part.title}>
                <h3>{part.title}</h3>
                <p className="product-tagline">{part.tagline}</p>
                <p>{part.description}</p>
                <ul>
                  {part.points.map((point) => (
                    <li key={point}>{point}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        <section className="section alt">
          <div className="section-header">
            <h2>Everything EGAV includes</h2>
            <p>
              A complete, governed data modeling platform: define the model, evolve it safely, and expose it via generated APIs and UI.
            </p>
          </div>
          <div className="products-grid">
            {egavCapabilities.map((capability) => (
              <div className="product-card" key={capability.title}>
                <h3>{capability.title}</h3>
                <p className="product-tagline">{capability.tagline}</p>
                <p>{capability.description}</p>
                <ul>
                  {capability.features.map((feature) => (
                    <li key={feature}>{feature}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        <section className="section">
          <div className="section-header">
            <h2>EGAV use cases</h2>
            <p>
              Each use case below is a full case study with a dedicated page.
            </p>
          </div>
          <div className="use-cases-grid">
            {egavUseCases.map((useCase) => (
              <Link
                key={useCase.title}
                to={`/case-studies/${useCase.caseStudySlug}`}
                className="use-case-card use-case-card-link"
              >
                <div className="use-case-icon">{useCase.icon}</div>
                <h3>{useCase.title}</h3>
                <p className="scenario">{useCase.scenario}</p>
                <p className="description">{useCase.description}</p>
                <span className="outcome-badge">{useCase.outcome}</span>
              </Link>
            ))}
          </div>
        </section>

        <section className="section alt">
          <div className="section-header">
            <h2>How teams use EGAV</h2>
            <p>
              Adopt EGAV as your core data layer, or introduce it for evolving domains where schema churn is the norm.
            </p>
          </div>
          <div className="usage-modes">
            <div className="usage-mode">
              <div className="mode-icon">🧩</div>
              <div className="mode-content">
                <h4>Model → API → UI</h4>
                <p>
                  Define entities and attribute sets, then get generated REST APIs and CRUD frontends without custom
                  backend or UI work per data model.
                </p>
                <div className="mode-flow">
                  <span>Define entity types</span>
                  <span className="flow-arrow">→</span>
                  <span>Version schema</span>
                  <span className="flow-arrow">→</span>
                  <span>Generated APIs</span>
                  <span className="flow-arrow">→</span>
                  <span>Dynamic CRUD UI</span>
                </div>
              </div>
            </div>
            <div className="usage-mode">
              <div className="mode-icon">🧾</div>
              <div className="mode-content">
                <h4>Governance & audit</h4>
                <p>
                  Keep full version history, restore when needed, and maintain a complete audit log for compliance.
                  Designed for production governance, not ad-hoc consumer tooling.
                </p>
                <div className="mode-flow">
                  <span>Version history</span>
                  <span className="flow-arrow">→</span>
                  <span>Restore</span>
                  <span className="flow-arrow">→</span>
                  <span>Audit log</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="section cta">
          <div>
            <h2>See EGAV on your domain</h2>
            <p>
              Walk through your data model and how EGAV can generate APIs and UI with governance and isolation.
            </p>
          </div>
          <div className="cta-actions">
            <Link className="primary-button" to="/request-demo">
              Schedule your technical review
            </Link>
            <Link className="secondary-button" to="/contact-us">
              Contact us
            </Link>
          </div>
        </section>
      </main>

      <footer className="footer">
        <p>SynaptaGrid — Automation infrastructure for SaaS</p>
        <p className="footer-sub">Governed data. Reliable automation. Multi-tenant. White-label.</p>
        <p className="footer-links">
          <Link to="/contact-us">Contact us</Link>
          <Link to="/request-demo">Schedule your technical review</Link>
        </p>
      </footer>
    </div>
  );
}

function AutomationPage() {
  const automation = whatItIs.products.find((p) => p.name.toLowerCase().includes('automation'));
  const features = Array.isArray(automation?.features) ? (automation?.features ?? []) : [];

  const automationDiffTitles = new Set([
    'Any API, unlimited activities',
    'Rich workflow conditions',
    'Total control over automation',
    'DAG Workflow Execution',
    'Enterprise Reliability',
    'RBAC across the platform',
  ]);

  const automationDiffs = differentiators.filter((d) => automationDiffTitles.has(d.title));

  return (
    <div className="app">
      <TopNav />

      <header className="hero hero-compact">
        <div className="hero-content">
          <p className="eyebrow">Product</p>
          <h1>SynaptaGrid Automation</h1>
          <p className="hero-subtitle">
            Workflows for anything — full control. Automation is sold separately, and it naturally integrates with EGAV when you use EGAV.
            Manage your external systems and APIs, map your data (and/or EGAV entities) to activities,
            then chain steps in a visual workflow builder to process data, trigger emails, call AI, or integrate any external API-accessible service.
            Events can flow through API, Kafka, or SNS — and results can be written back to your systems (and optionally EGAV).
          </p>
          <div className="hero-actions">
            <Link className="primary-button" to="/request-demo">
              Schedule your technical review
            </Link>
            <Link className="secondary-button" to="/register">
              Evaluate
            </Link>
          </div>
        </div>
      </header>

      <main>
        <section className="section">
          <div className="section-header">
            <h2>What Automation is</h2>
            <p>
              Push events to SynaptaGrid Automation, execute a governed workflow, and write results back to your systems.
              Designed for product-grade reliability and operations — not one-off automations.
            </p>
          </div>
          <div className="product-card">
            <h3>{automation?.name ?? 'SynaptaGrid Automation'}</h3>
            <p className="product-tagline">{automation?.tagline ?? 'Workflows for anything — full control'}</p>
            <p>{automation?.description ?? 'Run state-aware workflows with operational control and auditability.'}</p>
            {features.length > 0 && (
              <ul>
                {features.map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section className="section alt">
          <div className="section-header">
            <h2>How Automation is organized</h2>
            <p>
              A clear separation of concerns: integrations and activities, entities and mappings, then a visual workflow builder that chains steps into durable execution.
            </p>
          </div>
          <div className="products-grid">
            {egavAutomationOrganization.map((part) => (
              <div className="product-card" key={part.title}>
                <h3>{part.title}</h3>
                <p className="product-tagline">{part.tagline}</p>
                <p>{part.description}</p>
                <ul>
                  {part.points.map((point) => (
                    <li key={point}>{point}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        <section className="section alt" id="workflow">
          <div className="section-header">
            <h2>Example workflow</h2>
            <p>Parallel activities, branching conditions, and human approvals in a single governed pipeline.</p>
          </div>
          <WorkflowVisualization />
        </section>

        <section className="section">
          <div className="section-header">
            <h2>What makes it different</h2>
            <p>Unlimited activities, rich conditions, and operational control — built for your product roadmap.</p>
          </div>
          <div className="differentiators-grid">
            {automationDiffs.map((diff) => (
              <div className="differentiator-card" key={diff.title}>
                <span className="diff-icon">{diff.icon}</span>
                <div className="diff-content">
                  <h3>{diff.title}</h3>
                  <p>{diff.description}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="section cta">
          <div>
            <h2>See Automation on your architecture</h2>
            <p>
              Walk through your event sources, APIs, and governance needs — and see how SynaptaGrid runs and operates
              workflows end-to-end.
            </p>
          </div>
          <div className="cta-actions">
            <Link className="primary-button" to="/request-demo">
              Schedule your technical review
            </Link>
            <Link className="secondary-button" to="/contact-us">
              Contact us
            </Link>
          </div>
        </section>
      </main>

      <footer className="footer">
        <p>SynaptaGrid — Automation infrastructure for SaaS</p>
        <p className="footer-sub">Governed data. Reliable automation. Multi-tenant. White-label.</p>
        <p className="footer-links">
          <Link to="/contact-us">Contact us</Link>
          <Link to="/request-demo">Schedule your technical review</Link>
        </p>
      </footer>
    </div>
  );
}

const GoogleIcon = () => (
  <span className="auth-social-icon" aria-hidden>
    <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
    </svg>
  </span>
);
const GitHubIcon = () => (
  <span className="auth-social-icon" aria-hidden>
    <svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
    </svg>
  </span>
);
const XIcon = () => (
  <span className="auth-social-icon" aria-hidden>
    <svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
    </svg>
  </span>
);
const MicrosoftIcon = () => (
  <span className="auth-social-icon" aria-hidden>
    <svg viewBox="0 0 23 23" xmlns="http://www.w3.org/2000/svg">
      <path fill="#f35325" d="M1 1h10v10H1z"/>
      <path fill="#81bc06" d="M12 1h10v10H12z"/>
      <path fill="#05a6f0" d="M1 12h10v10H1z"/>
      <path fill="#ffba08" d="M12 12h10v10H12z"/>
    </svg>
  </span>
);

function LoginPage() {
  const { config: bootstrapConfig } = useBootstrap();
  const callbackUrl = `${window.location.origin}/auth/callback`;
  const socialProviders = bootstrapConfig?.auth_provider?.social_providers ?? [];
  const hasSocial = socialProviders.length > 0;
  const [socialError, setSocialError] = useState<string | null>(null);

  const handleSocialRedirect = async (fn: () => Promise<void>) => {
    setSocialError(null);
    try {
      await fn();
    } catch (e) {
      setSocialError(e instanceof Error ? e.message : 'Sign-in failed. Try again.');
    }
  };

  return (
    <div className="app">
      <TopNav />
      <header className="hero hero-compact">
        <div className="hero-content">
          <p className="eyebrow">Welcome back</p>
          <h1>Sign in to SynaptaGrid</h1>
          <p className="hero-subtitle">
            Access your workspace and manage your automation.
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
            <p>Use your work credentials or a social account.</p>
          </div>
          <div className="form">
            {socialError && (
              <p className="form-error" role="alert">
                {socialError}
              </p>
            )}
            {hasSocial && (
              <div className="auth-social-row">
                {socialProviders.includes('google') && (
                  <button type="button" className="auth-social-btn" onClick={() => handleSocialRedirect(() => redirectToGoogle(callbackUrl))}>
                    <GoogleIcon /> Sign in with Google
                  </button>
                )}
                {socialProviders.includes('github') && (
                  <button type="button" className="auth-social-btn" onClick={() => handleSocialRedirect(() => redirectToGitHub(callbackUrl))}>
                    <GitHubIcon /> Sign in with GitHub
                  </button>
                )}
                {socialProviders.includes('twitter') && (
                  <button type="button" className="auth-social-btn" onClick={() => handleSocialRedirect(() => redirectToTwitter(callbackUrl))}>
                    <XIcon /> Sign in with X
                  </button>
                )}
                {socialProviders.includes('microsoft') && (
                  <button type="button" className="auth-social-btn" onClick={() => handleSocialRedirect(() => redirectToMicrosoft(callbackUrl))}>
                    <MicrosoftIcon /> Sign in with Microsoft
                  </button>
                )}
              </div>
            )}
            {!hasSocial && (
              <p className="form-note">Sign in is available via Google, GitHub, Microsoft, or X when enabled for your organization.</p>
            )}
            <p className="form-note" style={{ marginTop: '1rem' }}>
              Don't have an account? <Link to="/register">Start your free trial</Link>
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}

function RegisterPage() {
  const { config: bootstrapConfig } = useBootstrap();
  const callbackUrl = `${window.location.origin}/auth/callback`;
  const socialProviders = bootstrapConfig?.auth_provider?.social_providers ?? [];
  const [socialError, setSocialError] = useState<string | null>(null);

  const handleSocialRedirect = async (fn: () => Promise<void>) => {
    setSocialError(null);
    try {
      await fn();
    } catch (e) {
      setSocialError(e instanceof Error ? e.message : 'Sign-in failed. Try again.');
    }
  };

  return (
    <div className="app">
      <TopNav />
      <header className="hero hero-compact">
        <div className="hero-content">
          <p className="eyebrow">Evaluate the platform</p>
          <h1>Request access</h1>
          <p className="hero-subtitle">
            Create your workspace and explore the platform. No credit card required.
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
            <p>Evaluate the platform in minutes.</p>
          </div>
          <div className="form">
            <div className="trial-benefits">
              <h4>Your free trial includes:</h4>
              <ul>
                <li>Full platform access</li>
                <li>Dynamic data modeling</li>
                <li>Workflow builder</li>
                <li>All integrations</li>
                <li>Email support</li>
              </ul>
            </div>
            {socialError && (
              <p className="form-error" role="alert">
                {socialError}
              </p>
            )}
            {socialProviders.length > 0 && (
              <div className="auth-social-row">
                {socialProviders.includes('google') && (
                  <button type="button" className="auth-social-btn" onClick={() => handleSocialRedirect(() => redirectToGoogle(callbackUrl))}>
                    <GoogleIcon /> Sign in with Google
                  </button>
                )}
                {socialProviders.includes('github') && (
                  <button type="button" className="auth-social-btn" onClick={() => handleSocialRedirect(() => redirectToGitHub(callbackUrl))}>
                    <GitHubIcon /> Sign in with GitHub
                  </button>
                )}
                {socialProviders.includes('twitter') && (
                  <button type="button" className="auth-social-btn" onClick={() => handleSocialRedirect(() => redirectToTwitter(callbackUrl))}>
                    <XIcon /> Sign in with X
                  </button>
                )}
                {socialProviders.includes('microsoft') && (
                  <button type="button" className="auth-social-btn" onClick={() => handleSocialRedirect(() => redirectToMicrosoft(callbackUrl))}>
                    <MicrosoftIcon /> Sign in with Microsoft
                  </button>
                )}
              </div>
            )}
            {socialProviders.length === 0 && (
              <p className="form-note">Sign up is available via Google, GitHub, Microsoft, or X when enabled for your organization.</p>
            )}
            <p className="form-note" style={{ marginTop: '1rem' }}>
              Already have an account? <a href={`${getPortalBaseUrl().replace(/\/$/, '')}/login`}>Sign in</a>
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}

function AuthCallbackPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { config: bootstrapConfig } = useBootstrap();
  const [status, setStatus] = useState<'loading' | 'error' | 'ready'>('loading');
  const [message, setMessage] = useState('Completing sign-in...');
  const [accessHint, setAccessHint] = useState<BootstrapResponse['access_hint'] | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [portalUrl, setPortalUrl] = useState<string | null>(null);
  const hasExchangedRef = useRef(false);

  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const hashTokens = useMemo(() => parseFragmentTokens(location.hash), [location.hash]);
  const appBaseUrl = getAppBaseUrl();
  const defaultPortalUrl = getPortalBaseUrl();

  useEffect(() => {
    if (hasExchangedRef.current) return;

    // Error from AuthN or Keycloak (return_url?error=...)
    const error = searchParams.get('error');
    const errorDescription = searchParams.get('error_description');
    const actionStatus = searchParams.get('kc_action_status');
    if (error || actionStatus === 'error') {
      hasExchangedRef.current = true;
      setStatus('error');
      setMessage(errorDescription ? decodeURIComponent(errorDescription.replace(/\+/g, ' ')) : 'Authentication failed. Please try again.');
      return;
    }

    // Case A: Fragment tokens (AuthN central callback, including social)
    if (hashTokens) {
      hasExchangedRef.current = true;
      const authnBaseUrl = bootstrapConfig?.services?.authn_url || process.env.REACT_APP_AUTHN_BASE_URL || '';
      const tokens = hashTokens;
      try {
        setAccessTokenCookie(tokens.access_token, tokens.expires_in);
        if (tokens.refresh_token) {
          setRefreshTokenCookie(tokens.refresh_token, 86400 * 30);
        }
      } catch {
        /* ignore */
      }
      if (tokens.id_token && authnBaseUrl) {
        // Keycloak flow: bootstrap/from-id-token for access_hint
        fetch(`${authnBaseUrl}/v1/authn/bootstrap/from-id-token`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${tokens.access_token}`,
          },
          body: JSON.stringify({
            id_token: tokens.id_token,
          }),
        })
          .then(async (response) => {
            if (!response.ok) throw new Error('Bootstrap failed');
            const data = (await response.json()) as BootstrapResponse;
            setAccessHint(data.access_hint);
            setUserEmail(data.user.email);
            setStatus('ready');
            const u = data.user;
            const displayName = (u as { display_name?: string }).display_name ?? (u as { name?: string }).name ?? u.email?.split('@')[0] ?? 'User';
            try {
              sessionStorage.setItem(MARKETING_USER_KEY, JSON.stringify({ name: displayName, email: u.email }));
            } catch {
              /* ignore */
            }
            setMessage(data.access_hint?.action === 'personal_org_created' || data.access_hint?.action === 'ok' ? 'Success! You can go to the Portal when ready.' : 'Additional action required.');
          })
          .catch(() => {
            setStatus('error');
            setMessage('Unable to complete sign-in. Please try again.');
          });
      } else {
        // Social flow (no id_token): use /me for user display
        if (authnBaseUrl) {
          fetch(`${authnBaseUrl}/v1/authn/me`, {
            headers: { Authorization: `Bearer ${tokens.access_token}` },
          })
            .then(async (res) => {
              if (!res.ok) throw new Error('Me failed');
              const data = (await res.json()) as CurrentUserResponse;
              const email = data.user?.email ?? '';
              const displayName = data.user?.display_name ?? data.user?.name ?? email?.split('@')[0] ?? 'User';
              setUserEmail(email);
              setAccessHint({ action: 'ok', reason: null });
              setStatus('ready');
              try {
                sessionStorage.setItem(MARKETING_USER_KEY, JSON.stringify({ name: displayName, email }));
              } catch {
                /* ignore */
              }
              setMessage('Success! You can go to the Portal when ready.');
            })
            .catch(() => {
              setUserEmail(null);
              setAccessHint({ action: 'ok', reason: null });
              setStatus('ready');
              setMessage('Success! You can go to the Portal when ready.');
            });
        } else {
          setAccessHint({ action: 'ok', reason: null });
          setStatus('ready');
          setMessage('Success! You can go to the Portal when ready.');
        }
      }
      return;
    }

    // Case B: Query code + state (Keycloak direct)
    if (!bootstrapConfig) {
      setMessage('Loading configuration...');
      return;
    }
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    if (!code || !state) {
      setStatus('error');
      setMessage('Missing authentication data.');
      return;
    }

    hasExchangedRef.current = true;
    const authnBaseUrl = bootstrapConfig.services.authn_url;
    console.log('[Auth Callback] Using AuthN URL from bootstrap:', authnBaseUrl);

    exchangeCodeForTokens({ code, state })
      .then(async (tokens: TokenResponse) => {
        const response = await fetch(`${authnBaseUrl}/v1/authn/bootstrap/from-id-token`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${tokens.access_token}`,
          },
          body: JSON.stringify({
            id_token: tokens.id_token,
          }),
        });
        if (!response.ok) {
          throw new Error('Bootstrap failed');
        }
        const data = (await response.json()) as BootstrapResponse;
        setAccessHint(data.access_hint);
        setUserEmail(data.user.email);
        setStatus('ready');
        const u = data.user;
        const displayName = (u as { display_name?: string }).display_name ?? (u as { name?: string }).name ?? u.email?.split('@')[0] ?? 'User';
        try {
          sessionStorage.setItem(MARKETING_USER_KEY, JSON.stringify({ name: displayName, email: u.email }));
        } catch {
          /* ignore */
        }
        try {
          setAccessTokenCookie(tokens.access_token, tokens.expires_in);
          if (tokens.refresh_token) {
            setRefreshTokenCookie(tokens.refresh_token, tokens.refresh_expires_in ?? 1800);
          }
        } catch {
          /* ignore */
        }
        if (data.access_hint?.action === 'personal_org_created' || data.access_hint?.action === 'ok') {
          setMessage('Success! You can go to the Portal when ready.');
        } else {
          setMessage('Additional action required.');
        }
      })
      .catch(() => {
        setStatus('error');
        setMessage('Unable to complete sign-in. Please try again.');
      });
  }, [hashTokens, searchParams, bootstrapConfig]);

  // When we have an org (ok or personal_org_created), fetch that org's portal URL for "Go to Portal" link
  useEffect(() => {
    const guid = accessHint?.organization?.guid;
    if (!guid || (accessHint?.action !== 'ok' && accessHint?.action !== 'personal_org_created')) {
      return;
    }
    const cpBase = getControlPlaneBaseUrl();
    fetch(`${cpBase}/v1/users-accounts/public/organizations/${encodeURIComponent(guid)}/portal`, { credentials: 'omit' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { portal_url?: string } | null) => {
        if (data?.portal_url) setPortalUrl(data.portal_url);
      })
      .catch(() => {});
  }, [accessHint?.organization?.guid, accessHint?.action]);

  const portalLinkUrl = (portalUrl ?? defaultPortalUrl).replace(/\/$/, '');

  return (
    <div className="app">
      <TopNav />
      <header className="hero hero-compact">
        <div className="hero-content">
          <p className="eyebrow">Authentication</p>
          <h1>Finishing sign-in</h1>
          <p className="hero-subtitle">{message}</p>
        </div>
      </header>

      <main>
        <section className="section form-section">
          {status === 'loading' && <p>Validating credentials...</p>}
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
                  Try Again
                </button>
              </div>
            </div>
          )}
          {status === 'ready' && accessHint && (
            <div className="status-card">
              <h2>You're in!</h2>
              <p>
                Signed in as <strong>{userEmail}</strong>
              </p>
              {accessHint.action === 'contact_admin' ? (
                <>
                  <p>
                    Your organization is managed by an admin. Contact them for access.
                  </p>
                  {accessHint.organization && (
                    <p className="status-meta">
                      Organization: {accessHint.organization.name}
                    </p>
                  )}
                </>
              ) : (
                <>
                  <p>Your workspace is ready.</p>
                  <a className="primary-button" href={portalLinkUrl}>
                    Go to Portal
                  </a>
                </>
              )}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

function CaseStudiesPage() {
  return (
    <div className="app">
      <TopNav />
      <header className="hero hero-compact">
        <div className="hero-content">
          <p className="eyebrow">Target audience</p>
          <h1>Case studies</h1>
          <p className="hero-subtitle">
            How teams in compliance-heavy, integration-heavy, and enterprise contexts use SynaptaGrid.
          </p>
          <Link className="secondary-button" to="/">
            Back to overview
          </Link>
        </div>
      </header>
      <main>
        <section className="section">
          <div className="case-studies-grid">
            {caseStudies.map((study) => (
              <Link to={`/case-studies/${study.slug}`} className="case-study-card" key={study.slug}>
                <span className="case-study-sector">{study.sector}</span>
                <h3>{study.audience}</h3>
                <p>{study.summary}</p>
                <span className="case-study-link">Read more →</span>
              </Link>
            ))}
          </div>
        </section>
      </main>
      <footer className="footer">
        <p>SynaptaGrid — Automation infrastructure for SaaS</p>
        <p className="footer-sub">Governed data. Reliable automation. Multi-tenant. White-label.</p>
        <p className="footer-links">
          <Link to="/contact-us">Contact us</Link>
          <Link to="/request-demo">Schedule your technical review</Link>
        </p>
      </footer>
    </div>
  );
}

function CaseStudyDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const study = caseStudies.find((s) => s.slug === slug);
  if (!study) {
    return (
      <div className="app">
        <TopNav />
        <main>
          <section className="section">
            <div className="section-header">
              <h2>Case study not found</h2>
              <p>We couldn't find that case study.</p>
              <Link to="/case-studies" className="primary-button">Back to case studies</Link>
            </div>
          </section>
        </main>
      </div>
    );
  }
  return (
    <div className="app">
      <TopNav />
      <header className="hero hero-compact">
        <div className="hero-content">
          <p className="eyebrow">{study.sector}</p>
          <h1>{study.audience}</h1>
          <p className="hero-subtitle">
            How SynaptaGrid addressed this team's needs.
          </p>
          <Link className="secondary-button" to="/case-studies">
            ← All case studies
          </Link>
        </div>
      </header>
      <main>
        <section className="section">
          <div className="case-study-detail">
            <h2>Challenge</h2>
            <p>{study.challenge}</p>
            <h2>Solution</h2>
            <p>{study.solution}</p>
            <h2>Outcome</h2>
            <p>{study.outcome}</p>
            {study.quote && (
              <blockquote className="case-study-quote">
                "{study.quote}"
              </blockquote>
            )}
            <Link to="/request-demo" className="primary-button">Schedule your technical review</Link>
          </div>
        </section>
      </main>
      <footer className="footer">
        <p>SynaptaGrid — Automation infrastructure for SaaS</p>
        <p className="footer-sub">Governed data. Reliable automation. Multi-tenant. White-label.</p>
        <p className="footer-links">
          <Link to="/contact-us">Contact us</Link>
          <Link to="/request-demo">Schedule your technical review</Link>
        </p>
      </footer>
    </div>
  );
}

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [pathname]);
  return null;
}

function App() {
  useTokenRefresh();
  return (
    <BootstrapProvider>
      <BrowserRouter>
        <ScrollToTop />
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/egav" element={<EgavPage />} />
          <Route path="/automation" element={<AutomationPage />} />
          <Route path="/egav-automation" element={<AutomationPage />} />
          <Route path="/case-studies" element={<CaseStudiesPage />} />
          <Route path="/case-studies/:slug" element={<CaseStudyDetailPage />} />
          <Route path="/request-demo" element={<DemoRequestPage />} />
          <Route path="/contact-us" element={<ContactUsPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/auth/callback" element={<AuthCallbackPage />} />
        </Routes>
      </BrowserRouter>
    </BootstrapProvider>
  );
}

export default App;
