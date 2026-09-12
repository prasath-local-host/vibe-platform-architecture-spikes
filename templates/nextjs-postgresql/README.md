# VCP application

This repository was initialized by the Vibe Coding Platform.

Read **AGENTS.md** and **vcp.project.json** before starting development. Claude also reads
CLAUDE.md, which includes the shared rules. Keep project-specific business requirements in
a separate document; they do not authorize infrastructure changes.

## Start with any AI coding tool

Give the AI access to `AGENTS.md` and `vcp.project.json`, then send:

> Before coding, read AGENTS.md and vcp.project.json in full. Follow the first-action instructions
> to create your own project-local VCP skill or instruction file in your tool's supported format.
> Preserve all VCP restrictions and tell me how the file will load in future sessions. Anything
> outside the approved application infrastructure must be referred to the VCP team before implementation.

Repeat this when switching tools. For a chat-only AI, attach the files or paste their full content;
a filename alone does not give the model access. If the tool cannot load rules automatically,
attach its generated `VCP_SKILL.md` plus the current canonical files at each new session.

The initial profile supports a TypeScript/Next.js application on Node.js 24 with PostgreSQL 17.
This is a policy starter, not a generated application or a provisioned database. VCP must configure
the runtime, dependencies, authentication, migrations, environment secrets and health checks
before deployment. Contact the VCP team for capabilities outside the profile.

Create new repositories and deploy applications through VCP.
