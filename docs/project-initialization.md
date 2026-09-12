# Company organizations and VCP project initialization

## Workflow

The customer creates a GitHub **organization** for its company and installs the VCP GitHub App
provided by the VCP team. In the VCP portal, the customer submits the organization name under
**Create a project through VCP**. No GitHub passwords, personal tokens, or private keys are entered
in the portal.

A VCP operator verifies the organization's relationship to the company against customer onboarding
records and enters the verification reference. The backend independently checks the active GitHub
App installation, organization type, permissions, immutable organization ID, and installation ID.
An installation alone does not prove that an arbitrary VCP user represents its owner. The database
allows an organization to be assigned to only one VCP company. Company access and step-up
authentication protect all mutations; only a server-authorized operator can approve the binding.

After verification, the customer enters an application name and repository name in VCP. The backend
creates a **private** repository in the verified organization, commits the platform-owned template,
then registers the application. Existing repository connection remains available for imports such as
Verdikjede; it does not create repositories or install this template on existing code automatically.

## Template and supported application profile

The canonical files are in `templates/nextjs-postgresql/`:

- `AGENTS.md`: shared architecture, security, infrastructure, and escalation instructions.
- `CLAUDE.md`: imports the shared instructions with `@AGENTS.md`.
- `vcp.project.json`: Node.js 24 / TypeScript / Next.js App Router / React / PostgreSQL 17 profile.
- `README.md` and `.gitignore`: initialization guidance and exclusions.

New apps have no external service approval by default. VCP must approve and configure SMTP, AI,
storage, or other integrations for each project. Application-specific business rules belong in
separate files. The source ZIP's former Supabase/Netlify setup is not an approved new-app profile.

The initial repository is a policy starter, not executable application scaffolding. Database creation,
restricted credentials, authentication choices, migrations, build/runtime configuration and deployment
health checks are separate VCP tasks. The demo deployment pipeline remains bound to its configured
application; creating a repository does not automatically make it deployable or expose a public URL.

Unsupported changes must stop and direct the human to contact the VCP team. These Markdown files
are contributor instructions, not a technical sandbox or proof of compliance. Existing authorization,
isolated builds and scans remain in place. Automatic semantic profile assessment, protected policy
updates and organization rulesets are separate enforcement work; this feature does not claim to
prevent an organization owner from bypassing VCP on GitHub.

## Enable in an operator-managed environment

Repository creation is disabled by default. Configure PostgreSQL and the existing OIDC/step-up
policy, then provide:

```dotenv
GITHUB_PROJECT_CREATION_ENABLED=true
VCP_GITHUB_APP_ID=<platform GitHub App ID>
VCP_GITHUB_APP_PRIVATE_KEY_FILE=<absolute operator-managed PEM path>
```

The GitHub App requires repository **Administration: write**, **Contents: write**, and implicit
Metadata access. Configure installation/repository access and organization policy so the app may
create private repositories and write their initial default branch. The company authorizes its own
installation. Installation tokens are minted on the server and are never sent to browsers or stored
in setup records. PEM files may be PKCS#1 or PKCS#8. Do not use the customer application's GitHub
token or the demo dispatch token for this purpose.

Migration `008_company_project_setup` adds company-scoped setup state, a unique organization ID,
and a separate attributable setup event log. Startup uses the existing migration runner. The platform
Docker image includes the templates. For the existing deployment layout, copy the optional
`deploy/platform/compose.project-creation.yaml` overlay beside `compose.yaml`, supply the App ID
and absolute PEM path in the operator environment, and use both Compose files. Mount the key
read-only and make it readable by container UID 1000; do not copy it into the image or repository.

## Failure and recovery

Per-company PostgreSQL session locks reject concurrent mutation. Each external operation is
surrounded by durable checkpoints. GitHub checks use fixed HTTPS endpoints, reject redirects,
and have timeouts. Organization/installation identity is rechecked before every create or initialize.
An existing repository with the requested name is never adopted automatically.

An interrupted initial create remains `creating` and the portal directs the customer to VCP. An
operator must reconcile the GitHub audit trail, company, request and immutable repository identity
before repair. There is deliberately no automatic recreate, delete, or privileged repair endpoint.
Do not blindly reset the request or remove a remote repository; record any administrative repair.

After the repository ID is saved, `initializing` requests can resume using their original idempotency
key and saved template bytes. Initialization accepts only the new README-only history or an exact
match of the complete template on retry. It rejects unexpected files, links, changed identity and
modified policy. The final branch update is non-forced so concurrent application work cannot be
overwritten. Application registration is idempotent and occurs only after initialization succeeds.

## Verification and references

Unit tests cover tenant authorization, operator verification, request binding, disabled configuration,
ambiguous GitHub creation, template initialization and retry. Route contract tests require every new
endpoint to enforce identity and tenant authorization. The portal browser test covers the onboarding
flow with mocked APIs; it does not create a live GitHub repository.

The optional PostgreSQL integration test uses `TEST_DATABASE_URL` for persistence, exclusivity,
unique company ownership and rollback checks. Use a disposable database only. A live GitHub App
acceptance test is still required in the deployment environment before enabling this for customers.

Local implementation verification: the platform unit/contract suite, TypeScript checks, portal build
and mocked browser onboarding flow pass. An additional embedded PostgreSQL check exercised all
eight migrations, setup persistence, unique organization ownership, atomic audit rollback and saved
failure checkpoints. It did not validate multi-session locks; the live PostgreSQL tests remain opt-in.

Agent loading: [Codex AGENTS.md](https://developers.openai.com/codex/guides/agents-md/) and
[Claude instruction imports](https://code.claude.com/docs/en/memory).
GitHub API: [organization installation](https://docs.github.com/en/rest/apps/apps#get-an-organization-installation-for-the-authenticated-app),
[private repository creation](https://docs.github.com/en/rest/repos/repos#create-an-organization-repository),
and [Git trees](https://docs.github.com/en/rest/git/trees#create-a-tree).
