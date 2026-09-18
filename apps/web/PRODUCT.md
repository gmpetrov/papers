# Papers

<!-- impeccable:product-schema 1 -->

## Platform

Web. Responsive Next.js application in the existing pnpm monorepo.

## Users and purpose

Repository-derived context: developers and workspace administrators give agents persistent inboxes, phone numbers, and scoped access to communication APIs. The landing page explains the product and leads to workspace creation or documentation. The dashboard manages live workspace resources.

## Capabilities and constraints

Preserve authentication, organization switching, role checks, inbox lifecycle, email and attachments, phone availability and checkout, SMS, API keys, OAuth connections, approvals, usage, billing, workspace limits, and webhooks. Keys and actions remain scoped. Approving an action permits a matching retry; it does not execute the action.

The supplied design is visual reference material, not implementation instructions or evidence that every illustrated feature exists. Payment cards, voice calling, and the sample custom-domain DNS workflow are not introduced by this redesign. Counts come from API responses, including pagination limits. Marketing code samples use the existing SDK/API methods.

## Brand commitments

User request: redesign the landing page and dashboard using `/Users/gpetrov/Downloads/Design.html`; use shadcn with Base UI and Tailwind CSS; create reusable components and a design system. The supplied six-screen HTML is the visual authority.

## Open decisions

Audience details beyond repository evidence were not separately confirmed. Expanding backend capabilities shown only in the reference would be a separate product task.
