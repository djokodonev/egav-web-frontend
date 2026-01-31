import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BrowserRouter, Link, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import './App.css';
import {
  setAccessTokenCookie,
  getAccessTokenCookie,
} from './auth/cookie';
import {
  exchangeCodeForTokens,
  startAuthRedirect,
} from './auth/oidc';
import type { TokenResponse } from './auth/oidc';

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

function getAppBaseUrl(): string {
  const env = process.env.REACT_APP_APP_BASE_URL;
  if (env) return env;
  return `${window.location.protocol}//${window.location.hostname}:3001`;
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

async function fetchCurrentUser(): Promise<{ name: string; email?: string } | null> {
  const authnBaseUrl =
    process.env.REACT_APP_AUTHN_BASE_URL || 'https://local-app.synaptagrid.io:5005';
  const mePath = process.env.REACT_APP_AUTHN_ME_PATH || '/v1/authn/me';
  const token = getAccessTokenCookie();
  const headers: Record<string, string> = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  try {
    const res = await fetch(`${authnBaseUrl}${mePath}`, {
      method: 'GET',
      credentials: 'include',
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
    } catch {
      /* ignore */
    }
    return user;
  } catch {
    return getStoredUser();
  }
}

const heroStats = [
  { value: "700+", label: "Built-in activities", detail: "Google, OpenAI, and more" },
  { value: "Isolated", label: "Per-customer data", detail: "Full tenant separation" },
  { value: "99.9%", label: "Execution reliability", detail: "Temporal-backed" },
];

const problems = [
  {
    icon: "🔧",
    title: "You want to add automation to your product",
    description: "But building workflow engines, integrations, and a visual builder from scratch takes 12-18 months and a dedicated team.",
  },
  {
    icon: "🔄",
    title: "Your data model keeps changing",
    description: "New document types, new fields, new relationships. Every change means developer time, migrations, and deployments.",
  },
  {
    icon: "📈",
    title: "Consumer tools don't scale",
    description: "Zapier, Make, n8n work great until you need multi-tenancy, complex conditions, or state-aware decisions.",
  },
  {
    icon: "💰",
    title: "Enterprise tools cost enterprise money",
    description: "Workato and Tray.io are powerful but built for giant budgets. You need enterprise-grade capabilities that fit your scale.",
  },
];

const whatItIs = {
  headline: "Your data. Your automations. Your way.",
  products: [
    {
      name: "SynaptaGrid EGAV",
      tagline: "Dynamic data modeling",
      description: "Define a data model → get instant CRUD APIs → get instant frontend UI. JSON Schema & JSON UI compatible. Multiple model versions, full history, restore any record to any state.",
      features: [
        "JSON Schema & JSON UI",
        "Instant CRUD APIs + frontend",
        "Full version history & restore",
        "Complete audit log",
        "Horizontal scaling (PostgreSQL)",
      ],
    },
    {
      name: "SynaptaGrid Automation",
      tagline: "Intelligent workflow orchestration",
      description: "Connect your data and automate around it. Or just use automation standalone - bring your own data via APIs. Works both ways.",
      features: [
        "State-aware automation",
        "Complex condition logic",
        "700+ built-in activities",
        "Import any OpenAPI spec",
        "DAG workflow execution",
      ],
    },
  ],
};

const differentiators = [
  {
    title: "Self-Service Integrations",
    description: "Users import any API via OpenAPI spec. No waiting for pre-built connectors. Activities auto-sync when APIs update. Each tenant adds exactly what they need.",
    icon: "🔌",
  },
  {
    title: "State-Aware Automation",
    description: "Workflows query live entity data mid-execution. Check inventory before fulfilling. Verify user permissions. Look up related records. Consumer tools can't do this.",
    icon: "🔍",
  },
  {
    title: "Complete Data Isolation",
    description: "Each customer gets their own isolated environment. Separate databases, separate workflows, separate configurations. Your data never mixes.",
    icon: "🏢",
  },
  {
    title: "DAG Workflow Execution",
    description: "True parallel branches, conditional paths, wait-all gates. Run 10 steps simultaneously, not sequentially. Process batches with real parallelism.",
    icon: "⚡",
  },
  {
    title: "Enterprise Reliability",
    description: "Built on Temporal for durable execution. Workflows survive failures, retry intelligently, and maintain state. Complete audit trail for compliance.",
    icon: "🛡️",
  },
  {
    title: "Self-Hosted or On-Premise",
    description: "Choose where data lives: our managed multi-zone deployments or your own infrastructure. We do not deploy our code to your environment. Your data stays in your network.",
    icon: "🔒",
  },
  {
    title: "White-Label Ready",
    description: "Custom domains, branded UI, per-tenant theming. Launch automation as a feature of your product, not a redirect to another service.",
    icon: "🏷️",
  },
];

const useCases = [
  {
    icon: "🚀",
    title: "SaaS Platforms",
    scenario: "Add automation features to your product",
    description: "Give your customers the ability to automate workflows within your platform. White-label the entire experience.",
    outcome: "Ship in weeks, not quarters",
  },
  {
    icon: "📄",
    title: "Document Processing",
    scenario: "OCR, extraction, approval workflows",
    description: "Process documents with AI, route for approval, sync to external systems. All triggered by upload events.",
    outcome: "10,000+ documents daily",
  },
  {
    icon: "🔗",
    title: "Integration Hub",
    scenario: "Connect any system to any system",
    description: "REST, SOAP, GraphQL, databases. Configure connections once, use everywhere. No waiting for pre-built connectors.",
    outcome: "New integrations in hours",
  },
  {
    icon: "⚙️",
    title: "Operations Automation",
    scenario: "Business process orchestration",
    description: "Order fulfillment, inventory sync, customer onboarding. Complex multi-step processes with conditional logic.",
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
    synaptagrid: "OpenAPI auto-sync",
    zapier: "No",
    make: "No",
    n8n: "Manual code",
  },
  {
    feature: "Self-hosted or on-premise",
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
    icon: "🚀",
    who: "SaaS Founders",
    need: "Add automation to your product without building from scratch",
    message: "White-label ready. Multi-tenant. Ship automation features in weeks.",
  },
  {
    icon: "⚙️",
    who: "Platform Teams",
    need: "Replace fragile point-to-point integrations",
    message: "One platform for all automation. State-aware. Enterprise reliable.",
  },
  {
    icon: "🤝",
    who: "Integration Partners",
    need: "Build repeatable solutions for clients",
    message: "Configure once, deploy to many tenants. Full customization per client.",
  },
];

// DAG Workflow visualization
function WorkflowVisualization() {
  return (
    <div className="dag-workflow">
      <div className="dag-header">
        <span className="dag-title">Document Processing Pipeline</span>
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
            <span className="node-label">Human Task</span>
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

function LandingPage() {
  const [user, setUser] = useState<{ name: string; email?: string } | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

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

  return (
    <div className="app">
      <nav className="top-nav">
        <Link to="/" className="top-nav-brand">SynaptaGrid</Link>
        <div className="top-nav-right">
          {!authChecked ? (
            <span className="top-nav-link" aria-hidden="true">&nbsp;</span>
          ) : user ? (
            <div className="top-nav-user">
              <a className="top-nav-link" href={getAppBaseUrl()}>
                App
              </a>
              <span className="top-nav-user-name">{user.name}</span>
              <span className="top-nav-user-avatar" aria-hidden="true">
                {user.name.charAt(0).toUpperCase()}
              </span>
            </div>
          ) : (
            <>
              <Link to="/login" className="top-nav-link">Login</Link>
              <Link to="/register" className="top-nav-link top-nav-cta">Start Free</Link>
            </>
          )}
        </div>
      </nav>
      <header className="hero" id="top">
        <div className="hero-content">
          <p className="eyebrow">Automation infrastructure for SaaS</p>
          <h1>Build your own automation platform.<br/>Offer it to your customers.</h1>
          <p className="hero-subtitle">
            Dynamic data modeling + intelligent workflow automation. 
            Multi-tenant from day one. White-label ready. 
            Add automation to your product in weeks, not years.
          </p>
          <div className="hero-actions">
            <Link className="primary-button" to="/request-demo">
              Request Demo
            </Link>
            <a className="secondary-button" href="#how-it-works">
              How It Works
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
            <h2>The problem</h2>
            <p>
              Every growing platform hits these walls.
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
              Use both together or just what you need. Full flexibility.
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
              </div>
            ))}
          </div>
          
          {/* Usage Modes */}
          <div className="usage-modes">
            <div className="usage-mode">
              <div className="mode-icon">🔗</div>
              <div className="mode-content">
                <h4>Full Platform</h4>
                <p>Define a model, get instant APIs and UI. Then automate around your data. Workflows trigger on changes, update records, sync everywhere.</p>
                <div className="mode-flow">
                  <span>Define Model</span>
                  <span className="flow-arrow">→</span>
                  <span>Instant APIs + UI</span>
                  <span className="flow-arrow">→</span>
                  <span>Automate</span>
                </div>
              </div>
            </div>
            <div className="usage-mode">
              <div className="mode-icon">⚡</div>
              <div className="mode-content">
                <h4>Automation Only</h4>
                <p>Already have your data? Just use the automation engine. Connect via APIs, import OpenAPI specs, run workflows.</p>
                <div className="mode-flow">
                  <span>Your APIs</span>
                  <span className="flow-arrow">→</span>
                  <span>Import OpenAPI</span>
                  <span className="flow-arrow">→</span>
                  <span>Automate</span>
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
              Not just another automation tool. Infrastructure for building automation into your product.
            </p>
          </div>
          <div className="differentiators-grid">
            {differentiators.map((diff) => (
              <div className="differentiator-card" key={diff.title}>
                <span className="diff-icon">{diff.icon}</span>
                <h3>{diff.title}</h3>
                <p>{diff.description}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Comparison Table */}
        <section className="section alt">
          <div className="section-header">
            <h2>How it compares</h2>
            <p>
              We're not trying to replace your existing tools. We're for when you outgrow them.
            </p>
          </div>
          <div className="comparison-table-wrapper">
            <table className="comparison-table">
              <thead>
                <tr>
                  <th>Capability</th>
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
            <h2>Built for these scenarios</h2>
            <p>
              From SaaS automation to enterprise integration.
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
            <h2>See it in action</h2>
            <p>
              A real DAG workflow: parallel execution, conditional branches, human tasks.
              One rule handles what would require 8+ Zaps elsewhere.
            </p>
          </div>
          <WorkflowVisualization />
        </section>

        {/* Integrations */}
        <section className="section">
          <div className="section-header">
            <h2>700+ built-in activities</h2>
            <p>
              Full Google and OpenAI integrations included. Need more? Import any API via OpenAPI spec.
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
              SynaptaGrid is infrastructure, not a consumer tool.
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
        </section>

        {/* Tech Stack */}
        <section className="section">
          <div className="section-header">
            <h2>Built on proven technology</h2>
            <p>
              Enterprise-grade infrastructure you can trust.
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
        </section>

        {/* Final CTA */}
        <section className="section cta">
          <div>
            <h2>Ready to own your automation?</h2>
            <p>
              Stop paying per task. Stop waiting for pre-built connectors. 
              Build automation into your product with SynaptaGrid.
            </p>
          </div>
          <div className="cta-actions">
            <Link className="primary-button" to="/request-demo">
              Request Demo
            </Link>
            <Link className="secondary-button" to="/register">
              Start Free Trial
            </Link>
          </div>
        </section>
      </main>

      <footer className="footer">
        <p>SynaptaGrid — Automation infrastructure for SaaS</p>
        <p className="footer-sub">Dynamic data modeling. Intelligent workflows. Multi-tenant. White-label ready.</p>
      </footer>
    </div>
  );
}

function DemoRequestPage() {
  return (
    <div className="app">
      <header className="hero hero-compact">
        <div className="hero-content">
          <p className="eyebrow">Let's talk</p>
          <h1>See SynaptaGrid in action</h1>
          <p className="hero-subtitle">
            We'll walk through the platform, discuss your use case, 
            and show you how to add automation to your product.
          </p>
          <Link className="secondary-button" to="/">
            Back to overview
          </Link>
        </div>
      </header>

      <main>
        <section className="section form-section">
          <div className="section-header">
            <h2>Request your demo</h2>
            <p>Tell us what you're building. We'll show you how SynaptaGrid fits.</p>
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
              <input type="text" name="role" placeholder="e.g., CTO, VP Engineering, Product Lead" />
            </label>
            <label>
              What are you building?
              <select name="use_case">
                <option value="">Select your primary use case...</option>
                <option value="saas_automation">Add automation to my SaaS product</option>
                <option value="integration_platform">Build an integration platform</option>
                <option value="document_processing">Document processing workflows</option>
                <option value="operations">Internal operations automation</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label>
              Tell us more about your needs
              <textarea name="message" rows={5} placeholder="What problems are you trying to solve? What have you tried?" />
            </label>
            <button className="primary-button" type="submit">
              Request Demo
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
            <p>Use your work credentials.</p>
          </div>
          <div className="form">
            <button
              className="primary-button"
              type="button"
              onClick={() => startAuthRedirect('login')}
            >
              Continue to Sign In
            </button>
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
  return (
    <div className="app">
      <header className="hero hero-compact">
        <div className="hero-content">
          <p className="eyebrow">Get started</p>
          <h1>Start your free trial</h1>
          <p className="hero-subtitle">
            Create your workspace and start building. No credit card required.
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
            <p>Get started in under 2 minutes.</p>
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
            <button
              className="primary-button"
              type="button"
              onClick={() => startAuthRedirect('register')}
            >
              Create Account
            </button>
            <p className="form-note" style={{ marginTop: '1rem' }}>
              Already have an account? <Link to="/login">Sign in</Link>
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
  const [status, setStatus] = useState<'loading' | 'error' | 'ready'>('loading');
  const [message, setMessage] = useState('Completing sign-in...');
  const [accessHint, setAccessHint] = useState<BootstrapResponse['access_hint'] | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const hasExchangedRef = useRef(false);

  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const appBaseUrl = getAppBaseUrl();

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
      setMessage('Missing authentication data.');
      return;
    }

    hasExchangedRef.current = true;

    const authnBaseUrl =
      process.env.REACT_APP_AUTHN_BASE_URL || 'https://local-app.synaptagrid.io:5005';

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
            create_personal_org_if_gmail: true,
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
        } catch {
          /* ignore */
        }
        if (data.access_hint?.action === 'personal_org_created' || data.access_hint?.action === 'ok') {
          setMessage('Success! Redirecting...');
          setTimeout(() => {
            window.location.assign(appBaseUrl);
          }, 1500);
        } else {
          setMessage('Additional action required.');
        }
      })
      .catch(() => {
        setStatus('error');
        setMessage('Unable to complete sign-in. Please try again.');
      });
  }, [appBaseUrl, navigate, searchParams]);

  return (
    <div className="app">
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
                  <a className="primary-button" href={appBaseUrl}>
                    Go to Dashboard
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
