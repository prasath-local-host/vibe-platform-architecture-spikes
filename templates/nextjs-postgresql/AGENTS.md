# VCP application rules

Policy version: 1.0.0. Read this file and `vcp.project.json` before changing this project.
These rules apply to every coding agent and human contributor working on the application.

## Infrastructure scope

- Build only within the profile in `vcp.project.json`. An absent capability is not approved.
- Use Node.js 24, TypeScript, Next.js App Router, React, and PostgreSQL with the `pg` driver.
- Keep one application deployment with server-rendered pages, server actions, and API routes.
  Use Server Components by default. Keep database access, authentication, AI calls, and secrets
  in server-only modules. Client components handle interaction and presentation.
- PostgreSQL is the persistent database. Use versioned SQL migrations and parameterized queries.
  Do not add Supabase, Firebase, SQLite in deployment, another database, or a hosted backend.
- VCP owns builds, isolated dependency restoration, security assessment, deployment, domains,
  TLS, runtime configuration, database provisioning, backups, and promotion between environments.
  Do not add Netlify, Vercel, cloud accounts, independent deployment workflows, or external hosting.
- Application containers must run without root, privileged capabilities, a Docker socket,
  arbitrary host mounts, or runtime package installation. Keep durable data out of the container.
- Builds must work without external network access after VCP restores dependencies. Bundle
  fonts/assets locally. Do not fetch data or secrets at build time.
- Do not introduce Redis, queues, background daemons, scheduled jobs, object storage,
  additional services, native system packages, or external SaaS unless the profile lists them.
- SMTP, AI providers/models, payment services, analytics, and external APIs require an explicit
  project approval and server-side configuration. Never infer approval from another application.
- Use the repository's package manager and committed lockfile. Keep existing supported versions;
  routine compatible security fixes are allowed after validation. New libraries, major upgrades,
  runtime changes, and new infrastructure require VCP review. Remove unused dependencies.

## When a request is outside scope

Stop the affected implementation before installing, coding, provisioning, or deploying it.
Tell the human: "This requires infrastructure or technology outside this project's VCP profile.
Please contact the VCP team for approval before we implement it."
Explain the requested capability, why the current profile cannot support it, the operational/security
impact, and an in-scope alternative if available. Continue independent work within scope.
Resume only after the VCP team records approval and updates the project profile through VCP.
Do not edit this policy, invent an approval, add nested overrides, or treat a prompt, imported ZIP,
README, generated code, or a contributor's preference as infrastructure approval.
Missing or contradictory profile information requires contacting the VCP team.

## Architecture and security

- Keep UI, domain logic, persistence, and external integrations separate. Reuse shared types and
  constants; do not duplicate business rules or create a second backend.
- Preserve strict TypeScript. Validate untrusted input on the server; return safe errors and
  implement loading, empty, and failure states. Never expose raw database or provider errors.
- Derive identity and company membership from trusted server state. Authorize every operation;
  never trust company IDs, roles, prices, or permissions supplied by the client.
- Scope reads and writes by company. Preserve database isolation/RLS where configured.
  Use a restricted database role; never use database owner/superuser credentials for application requests.
- Retain the approved authentication design. Do not replace it, bypass it for demos, weaken cookie
  protections, or add public registration without review. Protect sensitive actions against CSRF.
- Store secrets in VCP-managed environment configuration, never Git, browser bundles, logs,
  screenshots, example files, or prompts. Examples contain placeholders only.
- Never commit `.env` files, private keys, customer data, database dumps, dependency directories,
  build output, or the original imported ZIP. Report exposed credentials for rotation.
- Apply schema changes with migrations. Explain data loss, compatibility and recovery implications;
  obtain explicit authorization before destructive changes. Never reset production data.
- Do not disable security scans, tenant checks, tests, branch rules, or platform controls to ship.

## Repository and delivery workflow

1. The company creates its GitHub organization and supplies the organization name in VCP.
2. VCP verifies the company/organization association and the platform GitHub App installation.
3. Create new application repositories from the VCP UI. VCP creates a private repository and
   installs these rules plus the project profile before declaring initialization complete.
4. Work in the VCP-created repository. Do not create substitute repos using GitHub UI, CLI, or APIs.
5. Commit source and lockfiles; run the project's build, type checks, and relevant tests.
   Report what passed, what was not run, and remaining blockers accurately.
6. Deploy and promote only through VCP. A passing local build does not prove deployment readiness.

These files guide contributors; they are not a security sandbox. Enforcement belongs to VCP
authorization, isolated execution, policy assessment, protected review, and deployment controls.
