import type { Metadata } from 'next';
import Link from 'next/link';
import { Check, ArrowRight, MessageSquare, ShieldCheck } from 'lucide-react';
import { PublicPage } from '@/components/public-page';
import { plans } from '@agentinfra/contracts';
import styles from './pricing.module.css';
export const metadata: Metadata = {
  title: 'Pricing — Papers',
  description:
    'Start free with 3 inboxes and 3,000 emails. Developer is $20/month; Scale is $200/month. Phone rentals and prepaid SMS are separate.',
};
export default function PricingPage() {
  return (
    <PublicPage
      eyebrow="SIMPLE PLANS. CONTROLLED SPEND."
      title="A home for every agent. A plan for every stage."
      description="Give your agents their own inboxes. Add phone numbers when you need them, and keep communication costs under control."
    >
      <div className={styles.plans}>
        {Object.entries(plans).map(([id, plan]) => (
          <section
            key={id}
            className={`${styles.card} ${id === 'developer' ? styles.featured : ''}`}
          >
            <div className={styles.cardTop}>
              <h2>{plan.name}</h2>
            </div>
            <p className={styles.subtitle}>
              {id === 'free'
                ? 'Explore the API. Connect your first agent.'
                : id === 'developer'
                  ? 'For developers putting agents to work.'
                  : 'For teams running agents at scale.'}
            </p>
            <div className={styles.price}>
              ${plan.monthlyCents / 100}
              <span>/ month</span>
            </div>
            <p className={styles.period}>
              {id === 'free'
                ? 'No credit card required'
                : 'Billed monthly · cancel before renewal'}
            </p>
            <Link
              className={`button ${id === 'developer' ? '' : 'secondary'} ${styles.cta}`}
              href={
                id === 'free' ? '/dashboard' : `/dashboard/billing?plan=${id}`
              }
            >
              {id === 'free' ? 'Start free' : `Subscribe`}
              <ArrowRight size={16} />
            </Link>
            <ul className={styles.features}>
              {[
                `${plan.inboxes} active inboxes`,
                `${plan.emails.toLocaleString('en-US')} emails / month`,
                `${plan.storageGB} GB attachment storage`,
                `${plan.seats} workspace ${plan.seats === 1 ? 'member' : 'members'}`,
                'API, SDKs, CLI & MCP',
                'Webhooks & agent permissions',
              ].map((feature) => (
                <li key={feature}>
                  <Check size={16} />
                  {feature}
                </li>
              ))}
              {plan.domains > 0 && (
                <li>
                  <Check size={16} />
                  <span>
                    {plan.domains} custom domains <small>Coming soon</small>
                  </span>
                </li>
              )}
            </ul>
          </section>
        ))}
      </div>
      <p className={styles.fine}>
        USD, before applicable taxes. Email allowances combine sent recipient
        emails and received inbox deliveries. Allowances reset monthly and do
        not roll over.
      </p>
      <section className={styles.phone}>
        <div>
          <span className={styles.kicker}>
            <MessageSquare size={17} /> PHONE & MESSAGING
          </span>
          <h2>
            A number of their own.
            <br />A budget you control.
          </h2>
          <p>
            Add standard US phone numbers to a paid plan for{' '}
            <strong>$3 per number / month</strong>. SMS is paid from a shared
            prepaid usage balance.
          </p>
          <Link href="/dashboard/billing" className="text-link">
            Manage your usage balance <ArrowRight size={15} />
          </Link>
        </div>
        <div className={styles.wallet}>
          <div className={styles.walletHead}>
            <ShieldCheck size={21} />
            <strong>Fund first. Send second.</strong>
          </div>
          <ol>
            <li>
              <strong>Add credit</strong>
              <span>
                Top up $10, $25, $50 or $100. Unused purchased credit carries
                forward.
              </span>
            </li>
            <li>
              <strong>Pay for what you use</strong>
              <span>
                Sent and received SMS are charged per segment, including carrier
                fees. Long messages use multiple segments.
              </span>
            </li>
            <li>
              <strong>Stay in control</strong>
              <span>
                Outgoing messages pause when available funds run out. Optional
                automatic top-ups have a monthly ceiling.
              </span>
            </li>
          </ol>
        </div>
      </section>
      <section className={styles.faq} aria-label="Pricing questions">
        <h2>A few things to know.</h2>
        <details>
          <summary>What happens when I use my email allowance?</summary>
          <p>
            Paid workspaces use prepaid credit for additional emails at $2 per
            1,000, billed per recipient email. Free workspaces must upgrade.
            Without enough credit, new outbound sends stop and new inbound
            messages above the allowance are not stored.
          </p>
        </details>
        <details>
          <summary>Does the phone rental include SMS?</summary>
          <p>
            No. The $3 monthly rental keeps a standard US number assigned to
            your workspace. Sent and received SMS use your prepaid balance. No
            upfront top-up is required. Your first paid phone rental includes
            $0.50 of usage credit, once per workspace. Registration charges and
            non-standard numbers require a separate quote.
          </p>
        </details>
        <details>
          <summary>Can incoming SMS exceed my balance?</summary>
          <p>
            Incoming traffic is controlled by the carrier and can incur costs
            before a callback reaches Papers. Papers covers incoming costs
            beyond available prepaid funds and pauses messaging when credit runs
            out.
          </p>
        </details>
        <details>
          <summary>Are custom domains available?</summary>
          <p>
            Custom domains are coming soon, with 10 included in Developer and
            150 in Scale when released. Today, your inboxes use the Papers email
            domain. Voice calls and MMS are not included.
          </p>
        </details>
        <details>
          <summary>How do cancellation and top-ups work?</summary>
          <p>
            Subscriptions renew monthly until canceled. Cancellation takes
            effect at the end of the paid period. Purchased usage credit carries
            forward and is separate from your subscription. Automatic top-ups
            are optional and add credit only after a successful payment.
          </p>
        </details>
      </section>
    </PublicPage>
  );
}
