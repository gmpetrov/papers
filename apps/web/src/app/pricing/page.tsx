import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { ArrowRight, Check } from 'lucide-react';
import { PublicPage } from '@/components/public-page';
import { Stamp } from '@/components/design-system/paper';
import { plans, topupAmounts, type PlanId } from '@agentinfra/contracts';
import styles from './pricing.module.css';

export const metadata: Metadata = {
  title: 'Pricing — Papers',
  description:
    'Every Papers plan on one sheet. Free with 3 inboxes and 3,000 emails, Developer at $20/month, Scale at $200/month. Numbers are $3/month and SMS is prepaid.',
};

const planIds: PlanId[] = ['free', 'developer', 'scale'];
const featured: PlanId = 'developer';

const planCopy: Record<PlanId, { line: string; cta: string; href: string }> = {
  free: {
    line: 'For your first agent.',
    cta: 'Start free, no card',
    href: '/dashboard',
  },
  developer: {
    line: 'For agents emailing real people.',
    cta: 'Get Developer',
    href: '/dashboard/billing?plan=developer',
  },
  scale: {
    line: 'For agents in production.',
    cta: 'Get Scale',
    href: '/dashboard/billing?plan=scale',
  },
};

type Cell = { value: ReactNode; muted?: boolean; prose?: boolean };
type Plan = (typeof plans)[PlanId];

const none: Cell = {
  value: (
    <>
      <span aria-hidden="true">— — —</span>
      <span className="sr-only">Not included</span>
    </>
  ),
  muted: true,
};
const included: Cell = {
  value: (
    <>
      <Check size={18} aria-hidden="true" className={styles.check} />
      <span className="sr-only">Included</span>
    </>
  ),
};

const planRows: { label: string; cell: (plan: Plan) => Cell }[] = [
  { label: 'Active inboxes', cell: (p) => ({ value: p.inboxes }) },
  {
    label: 'Emails / month',
    cell: (p) => ({ value: p.emails.toLocaleString('en-US') }),
  },
  {
    label: 'Attachment storage',
    cell: (p) => ({ value: `${p.storageGB} GB` }),
  },
  { label: 'Workspace members', cell: (p) => ({ value: p.seats }) },
  {
    label: 'Phone numbers, max',
    cell: (p) => (p.numbers > 0 ? { value: p.numbers } : none),
  },
  {
    label: 'Custom domains',
    cell: (p) =>
      p.domains > 0 ? { value: `${p.domains} · not yet`, muted: true } : none,
  },
  {
    label: 'Email past the allowance',
    cell: (p) =>
      p.monthlyCents === 0
        ? { value: 'Upgrade required', prose: true }
        : {
            value: (
              <>
                From credit, <span className={styles.mono}>$2 / 1,000</span>
              </>
            ),
            prose: true,
          },
  },
  { label: 'API, SDKs, CLI and MCP', cell: () => included },
  { label: 'Webhooks, scoped keys', cell: () => included },
];

const topups = topupAmounts.map((cents) => `$${cents / 100}`).join(' · ');

const usageRows: { label: string; rate: string; note: string }[] = [
  {
    label: 'Standard US number',
    rate: '$3 / month each',
    note: "Rental only, within the plan's cap. Registration charges and non-standard numbers are quoted separately.",
  },
  {
    label: 'SMS, sent or received',
    rate: 'Per segment',
    note: 'Carrier fees included. A long message uses several segments. Paid from prepaid credit.',
  },
  {
    label: 'Prepaid top-up',
    rate: topups,
    note: 'Carries forward. Automatic top-ups are optional and carry a monthly ceiling you set.',
  },
  {
    label: 'At a zero balance',
    rate: 'Sending pauses',
    note: 'Papers absorbs inbound costs beyond your funds. Nothing is billed to you after the fact.',
  },
];

function cellClass(cell: Cell) {
  return `${cell.muted ? styles.muted : ''} ${cell.prose ? styles.prose : ''}`;
}

function PlanHead({ id }: { id: PlanId }) {
  const plan = plans[id];
  const copy = planCopy[id];
  const isFeatured = id === featured;
  return (
    <>
      {isFeatured && <Stamp className={styles.stamp}>Most popular</Stamp>}
      <span className={styles.planName}>{plan.name}</span>
      <span className={styles.planLine}>{copy.line}</span>
      <span className={styles.price}>
        ${plan.monthlyCents / 100}
        <span>/ month</span>
      </span>
      <Link
        href={copy.href}
        className={`button ${isFeatured ? '' : 'secondary'} ${styles.cta}`}
      >
        {copy.cta}
      </Link>
    </>
  );
}

export default function PricingPage() {
  return (
    <PublicPage>
      <header className={styles.header}>
        <div>
          {/* <div className="eyebrow">
            <span className={styles.dot} aria-hidden="true" />
            SCHEDULE OF FEES · REV. 2026
          </div> */}
          <h1>
            Predictable pricing
            <br />
            <em>scalable plans.</em>
          </h1>
        </div>
        <p>Designed for every stage of your journey.</p>
      </header>

      <section className={styles.sheet} aria-label="Plans and fees">
        <div className={styles.scroll}>
          <table className={styles.plans}>
            <caption className={styles.part}>Part one</caption>
            <thead>
              <tr>
                <th scope="col" className={styles.corner}>
                  <span className={styles.label}>Line item</span>
                </th>
                {planIds.map((id) => {
                  return (
                    <th
                      key={id}
                      scope="col"
                      className={id === featured ? styles.featured : undefined}
                    >
                      <PlanHead id={id} />
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {planRows.map((row) => (
                <tr key={row.label}>
                  <th scope="row">
                    <span className={styles.label}>{row.label}</span>
                  </th>
                  {planIds.map((id) => {
                    const cell = row.cell(plans[id]);
                    return (
                      <td
                        key={id}
                        className={`${id === featured ? styles.featured : ''} ${cellClass(cell)}`}
                      >
                        {cell.value}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className={styles.stacked}>
          <h2 className={styles.part}>Part one</h2>
          {planIds.map((id) => (
            <section
              key={id}
              aria-label={plans[id].name}
              className={`${styles.stackedPlan} ${id === featured ? styles.featured : ''}`}
            >
              <PlanHead id={id} />
              <dl>
                {planRows.map((row) => {
                  const cell = row.cell(plans[id]);
                  return (
                    <div key={row.label}>
                      <dt className={styles.label}>{row.label}</dt>
                      <dd className={cellClass(cell)}>{cell.value}</dd>
                    </div>
                  );
                })}
              </dl>
            </section>
          ))}
        </div>

        <table className={styles.usage}>
          <caption className={styles.part}>Part two</caption>
          <tbody>
            {usageRows.map((row) => (
              <tr key={row.label}>
                <th scope="row">
                  <span className={styles.label}>{row.label}</span>
                </th>
                <td className={styles.rate}>{row.rate}</td>
                <td className={styles.note}>{row.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className={styles.closing}>
        <p>
          USD, before applicable taxes. An email allowance counts sent recipient
          emails and received inbox deliveries together; it resets monthly and
          does not roll over. Plans renew monthly until cancelled, and
          cancellation takes effect at the end of the paid period. Your first
          paid number rental includes $0.50 of usage credit, once per workspace.
          Voice and MMS are not included. Above {plans.scale.inboxes} inboxes or{' '}
          {plans.scale.numbers} numbers,{' '}
          <Link href="/support" className="text-link">
            talk to us
          </Link>
          .
        </p>
        <Link href="/dashboard" className={`button ${styles.start}`}>
          Start free with {plans.free.inboxes} inboxes <ArrowRight size={16} />
        </Link>
      </div>
    </PublicPage>
  );
}
