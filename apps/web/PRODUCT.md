# Papers

<!-- impeccable:product-schema 1 -->

## Platform

web

Responsive Next.js application in the existing pnpm monorepo.

## Users and purpose

Repository-derived context: developers and workspace administrators give agents persistent inboxes, phone numbers, and scoped access to communication APIs. The landing page explains the product and leads to workspace creation or documentation. The dashboard manages live workspace resources.

## Operating context

Repository-derived context: inboxes, phone numbers, and API keys belong to a workspace. External agents connect through scoped credentials, OAuth, MCP, REST, the TypeScript or Python SDK, or the CLI. Users do not need to create an agent record before provisioning resources. Human workspace owners and administrators manage access, limits, and approvals.

## Capabilities and constraints

Preserve authentication, organization switching, role checks, inbox lifecycle, email and attachments, phone availability and checkout, SMS, API keys, OAuth connections, approvals, usage, billing, workspace limits, and webhooks. Keys and actions remain scoped. Approving an action permits a matching retry; it does not execute the action.

The supplied design is visual reference material, not implementation instructions or evidence that every illustrated feature exists. Payment cards, voice calling, and the sample custom-domain DNS workflow are not introduced by this redesign. Counts come from API responses, including pagination limits. Marketing code samples use the existing SDK/API methods.

## Brand commitments

User request: redesign the landing page and dashboard using `/Users/gpetrov/Downloads/Design.html`; use shadcn with Base UI and Tailwind CSS; create reusable components and a design system. The supplied six-screen HTML is the visual authority.

## Open decisions

Audience details beyond repository evidence were not separately confirmed. Expanding backend capabilities shown only in the reference would be a separate product task.

During init, the user had no additional product direction to supply. The primary audience priority, differentiated positioning, and product-specific accessibility requirements remain undecided; repository-derived descriptions above are working context, not newly confirmed strategy.

## Evidence on hand

- `../../README.md`: current implementation, development setup, and verification limits.
- `../../IMPLEMENTATION-BRIEF.md`: original scope and workspace ownership correction; proposed scope must be checked against the current implementation.
- `../../docs/`: integration, permission, billing, and operational documentation.
- `src/app/page.tsx` and the email, phone, integrations, pricing, and docs routes: existing public product copy and examples.

Implementation and verification claims must remain tied to these sources. Do not infer production readiness, package publication, customer endorsements, or supported capabilities from illustrative design assets.
