import type { Metadata } from "next";
import Link from "next/link";
import { PublicPage } from "@/components/public-page";
export const metadata: Metadata = {
  title: "Pricing and usage — Papers",
  description:
    "Understand phone rental, communication usage, and the current status of Papers pricing.",
};
export default function PricingPage() {
  return (
    <PublicPage
      eyebrow="PRICING & USAGE"
      title="Understand the cost before you connect."
      description="Papers is in development. Public subscription plans and checkout are not available yet."
    >
      <div className="public-cards">
        <section>
          <h2>Phone numbers</h2>
          <p>
            Search results show the provider's upfront price, monthly rental,
            and currency. Ordering a number incurs provider charges. Review that
            quote before confirming a purchase.
          </p>
        </section>
        <section>
          <h2>Communication usage</h2>
          <p>
            The dashboard tracks email and SMS activity. SMS segment counts and
            provider-reported costs may arrive after delivery. Usage reporting
            is not an invoice or a final retail price.
          </p>
        </section>
        <section>
          <h2>Usage controls</h2>
          <p>
            Workspace and credential limits control daily sends and resource
            creation. Owners and admins can require human approval. Monetary
            spending budgets and subscription billing are still being built.
          </p>
        </section>
      </div>
      <section className="public-detail">
        <h2>Review your workspace activity.</h2>
        <p>
          Inspect current usage, resource limits, and approvals before
          delegating access to an agent. Existing provider charges still apply
          during development.
        </p>
        <Link className="text-link" href="/dashboard/usage">
          Open usage →
        </Link>
      </section>
    </PublicPage>
  );
}
