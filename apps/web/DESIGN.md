---
name: Papers
description: Paper credentials, editorial type, and precise workspace controls.
colors:
  ink: "#141518"
  paper: "#f3f0e8"
  card: "#fbfaf6"
  stamp: "#b32d16"
  navy: "#222e5a"
  gold: "#e0bd62"
  secondary: "#e9e5da"
  muted-foreground: "#5f5c56"
  input: "#a49e90"
  rule: "#d9d4c7"
  success: "#366044"
typography:
  display:
    fontFamily: 'Newsreader, Georgia, serif'
    fontSize: 'clamp(68px, 7vw, 88px)'
    fontWeight: 400
    lineHeight: 0.98
    letterSpacing: '-0.025em'
  headline:
    fontFamily: 'Newsreader, Georgia, serif'
    fontSize: 'clamp(32px, 3.5vw, 46px)'
    fontWeight: 400
    lineHeight: 1.1
    letterSpacing: '-0.025em'
  body:
    fontFamily: 'Schibsted Grotesk, Helvetica Neue, sans-serif'
    fontSize: '14px'
    fontWeight: 400
  label:
    fontFamily: 'IBM Plex Mono, monospace'
    fontSize: '10px'
    lineHeight: 1.3
    letterSpacing: '0.1em'
rounded:
  stamp: '2px'
  control: '4px'
  panel: '6px'
spacing:
  compact: '12px'
  small: '16px'
  panel: '20px'
  section: '24px'
components:
  button-primary:
    backgroundColor: '{colors.ink}'
    textColor: '{colors.card}'
    rounded: '{rounded.control}'
    height: '40px'
  button-outline:
    backgroundColor: '{colors.paper}'
    textColor: '{colors.ink}'
    rounded: '{rounded.control}'
    height: '40px'
  paper-panel:
    backgroundColor: '{colors.card}'
    textColor: '{colors.ink}'
    rounded: '{rounded.panel}'
  stamp:
    textColor: '{colors.stamp}'
    typography: '{typography.label}'
    rounded: '{rounded.stamp}'
    padding: '5px 8px'
---

# Design System: Papers

## Overview

**Creative North Star: "Paper Credentials"**

The supplied `Design.html` establishes the visual authority: warm paper, crisp ink rules, editorial serif headings, and red credential stamps. A navy passport with gold lettering supplies the signature interaction. The result should feel like a carefully typeset document with practical software controls.

The same vocabulary supports two surface modes: the landing page uses **Persuade**, with generous composition and an interactive passport; the dashboard uses **Operate**, with compact navigation, clear actions, data tables, and live resource counts. These modes change density and hierarchy, not the underlying palette.

**Key Characteristics:**

- Warm paper surfaces separated by thin ink rules.
- Editorial headings paired with compact, readable controls.
- Red stamps and navy credential details used with restraint.
- Product capabilities and operational states remain accurate.

## Colors

Warm neutrals carry the interface; red marks attention, navy anchors the passport and code, and gold belongs to the passport cover.

### Primary

- **Ink:** text, primary buttons, structural borders, and headings.
- **Stamp Red:** stamps, selected details, links, destructive semantics, and keyboard focus. Color alone must not communicate an action's status.

### Secondary

- **Passport Navy:** passport cover and code surfaces.
- **Passport Gold:** lettering and seal on the navy passport.

### Neutral

- **Paper:** page background.
- **Card:** inset panels and credential sheets.
- **Secondary:** quiet hover and supporting surfaces.
- **Muted Foreground:** explanatory text and metadata.
- **Input:** field borders.
- **Rule:** subordinate dividers.
- **Success:** available semantic success token; preserve explicit text for status.

**The Token Source Rule.** `src/app/tokens.css` is the implementation source of truth; change semantic tokens there before adding new literal colors. Compatibility aliases such as `--green` resolve to stamp red and must not be interpreted by their historical names.

## Typography

**Display Font:** Newsreader, with Georgia and serif fallbacks. **Body Font:** Schibsted Grotesk, with Helvetica Neue and sans-serif fallbacks. **Label/Mono Font:** IBM Plex Mono, with monospace fallback. Fonts are self-hosted through `src/app/fonts.css`, with `font-display: swap`.

The serif creates the editorial hierarchy; sans-serif supports decisions and reading; mono identifies metadata, code, and credential labels. Use the frontmatter hierarchy as the baseline. Landing section headings use `clamp(38px, 4vw, 54px)` with a tight line height (1.04); panel titles use sans-serif (15px, 600). Dashboard descriptions use a comfortable line height (1.6) and maximum measure (75ch). Metrics use serif numerals (46px) with tabular alignment. Uppercase mono labels require spacing, never whole paragraphs.

## Layout

The landing container reaches 1280px with desktop horizontal padding (56px). The dashboard has a fixed desktop sidebar (260px), a compact header (58px), and content capped at 1480px with padding (32px 40px). Common panel padding is 20px; repeated gaps use 12px, 16px, 20px, and 24px.

At 1100px and below, the sidebar narrows to 220px and complex dashboard layouts stack. At 760px and below, landing sections stack and dashboard navigation becomes a toggleable, in-flow full-width region; the final design-layer rules supersede the earlier drawer declarations. Preserve readable navigation labels and keyboard access. Tables retain a minimum width (520px on narrow screens) and scroll within their containing panel. Code blocks scroll horizontally. A 380px adjustment tightens the landing header and headline; at 1600px the hero gains height.

## Elevation & Depth

Operational panels are flat: card tone and one-pixel ink borders establish separation, with default card ring shadows suppressed. The passport is the deliberate dimensional exception: its cover uses `8px 24px 30px -14px #14151855`, the open spread uses `8px 24px 36px -24px #14151855`, and its inner fold uses `inset 14px 0 18px -16px #14151866`.

Passport opening uses a 650ms transform with `cubic-bezier(0.16, 1, 0.3, 1)`. Control color transitions use 150ms. Preserve the reduced-motion rule, which reduces animation and transition durations to 0.01ms and disables smooth scrolling.

## Shapes

Controls have modest corners (4px), paper panels use 6px, and stamps use 2px. Structural borders are thin and dark; secondary row rules are softer. Stamps rotate slightly (-2deg). Circular seals and avatars are purposeful exceptions. The passport's asymmetric cover corners support its book silhouette.

## Components

The primitive layer lives in `src/components/ui`: shadcn `base-nova` components built on Base UI where interaction requires it. Existing primitives include Button, Input, Card, Badge, Dialog, Separator, Skeleton, and Tabs. Reusable paper compositions live in `src/components/design-system/paper.tsx`; code examples live in `code-example.tsx`.

### Buttons and fields

Use `Button` variants `default`, `outline`, `secondary`, `ghost`, `destructive`, and `link`; use the existing size API. Primary buttons use ink and card text; outlines retain a thin ink border. The primitive's primary hover uses 80% primary opacity; legacy `.button` hover uses navy. Focus uses stamp red, with a visible outline (2px, 4px offset) and primitive focus rings. Fields preserve disabled and invalid states, associated labels, and visible error messages. The base Input is 32px high; resource search explicitly uses 40px and card fill.

Base UI defaults buttons to a non-submitting type. Always use `type="submit"` for form submission. Compose links with `render`, not `asChild`, and set `nativeButton={false}`.

```tsx
import Link from "next/link";
import { Button } from "@/components/ui/button";

<Button type="submit" disabled={pending}>Save changes</Button>
<Button variant="outline" render={<Link href="/docs" />} nativeButton={false}>
  Read documentation
</Button>
```

### Paper compositions

`PaperPanel` supplies the ruled title bar, optional action, and content padding. `Metric` supplies a mono label, serif value, description, and icon. `PageHeading` keeps title, description, and optional action consistent. `Stamp` supplies the outlined red credential treatment; use it for concise labels, not an invented verification claim.

```tsx
import { Mail } from "lucide-react";
import { PaperPanel, Metric, PageHeading, Stamp } from "@/components/design-system/paper";
import { cn } from "@/lib/utils";

<PageHeading title="Inboxes" description="Manage workspace inboxes." />
<PaperPanel title="Workspace resources" action={<Stamp>Workspace</Stamp>}
  className={cn("min-w-0", isLoading && "opacity-60")}>
  <Metric label="Inboxes" value={inboxes.length}
    description="Inboxes in this response" icon={<Mail aria-hidden="true" />} />
</PaperPanel>
```

`cn` combines conditional classes with `clsx` and resolves conflicting Tailwind utilities with `tailwind-merge`. It does not change CSS layer precedence. Use live API values and honest descriptions when a response is paginated.

### Code examples, navigation, and passport

`CodeExample` accepts a nonempty `samples` array of `{ label, code, installation? }` and optional `compact`. It supplies Base UI language tabs, horizontal code scrolling, clipboard feedback, and a manual-copy fallback. Pass verified SDK/API examples from the application rather than fabricating new methods.

```tsx
import { CodeExample } from "@/components/design-system/code-example";

<CodeExample samples={[{ label: "TypeScript", code: verifiedExample }]} compact />
```

Use the quickstart repository installation guidance. Do not assume an SDK package is published; the repository README and application documentation differ on package naming.

Navigation uses quiet sans-serif rows, a bordered card surface for the current page, and a small red active marker. Keep current-page semantics, skip navigation, and the mobile toggle accessible. The passport opens into a two-page spread: working language tabs and copyable code on the left, illustrative identity details on the right. Preserve both facing pages on mobile, with code scrolling within its page. The spread is at most 600px wide and 440px high (430px on mobile). The closed cover stays centered over the spread. It must not imply backend features absent from the product. The hero guilloche belongs to the full-width hero, not the passport column: oversize it beyond the top and right boundaries and crop only at the hero boundary, with a mobile fade that keeps body text clear. Decorative guilloche SVGs remain hidden from assistive technology.

### Extending the system

From the repository root, add a primitive with:

```sh
pnpm --filter @agentinfra/web exec shadcn add tooltip
```

`components.json` selects `base-nova`, Base UI-compatible components, CSS variables, and the `@/components/ui` / `@/lib/utils` aliases. Tailwind 4 uses CSS-first configuration: `@theme inline` in `tokens.css` exposes semantic colors, fonts, and radii; `postcss.config.mjs` uses `@tailwindcss/postcss`. No JavaScript Tailwind configuration is required.

`globals.css` declares cascade order `theme, base, components, utilities, design`. The final **design** layer intentionally overrides component defaults and utilities to match the supplied reference. Make system-wide edits in semantic tokens or `design-system.css`; do not scatter competing overrides across screens. Use utility classes for composition where the design layer does not own the property. Review any newly generated primitive for fit, focus states, and responsive behavior before reuse.

## Do's and Don'ts

### Do:

- **Do** reuse semantic tokens and paper compositions across landing and dashboard surfaces.
- **Do** preserve explicit labels, keyboard focus, reduced motion, and scrollable tables.
- **Do** show real resource data and preserve permissions, pending states, and error feedback.

### Don't:

- **Don't** add decorative shadows to flat operational panels.
- **Don't** use passport illustrations as evidence of unimplemented product capabilities.
- **Don't** use `asChild` with the Base UI Button or omit `type="submit"` from a submit action.
