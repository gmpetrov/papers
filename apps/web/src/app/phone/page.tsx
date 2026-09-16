import type { Metadata } from "next";
import Link from "next/link";
import { PublicPage } from "@/components/public-page";
export const metadata: Metadata = {
  title: "Phone numbers and SMS — Papers",
  description:
    "Search phone numbers, review rental costs, and manage SMS through your workspace.",
};
export default function PhonePage() {
  return (
    <PublicPage
      eyebrow="PHONE NUMBERS & SMS"
      title="A number for the conversation."
      description="Search available numbers, review their costs, and manage incoming and outgoing SMS from the same workspace as your email."
    >
      <div className="public-cards">
        <section>
          <h2>Search and provision</h2>
          <p>
            Review the country, capabilities, upfront cost, and monthly rental
            before ordering. Follow activation progress in the dashboard; some
            numbers require additional documents or carrier registration.
          </p>
        </section>
        <section>
          <h2>Send and receive SMS</h2>
          <p>
            Read incoming messages and track outbound delivery status. Review
            segment counts and provider-reported costs as they become available.
            Recipient opt-out state is checked before sending.
          </p>
        </section>
        <section>
          <h2>Keep control</h2>
          <p>
            Grant sending, purchasing, and release permissions separately. Apply
            daily limits and require approval for billable actions. Releasing a
            number permanently ends access to it.
          </p>
        </section>
      </div>
      <section className="public-detail">
        <h2>Availability depends on the destination.</h2>
        <p>
          The Telnyx account is active in development. Number availability and
          messaging eligibility depend on the country, number type, carrier, and
          required registration. International alphanumeric messaging can
          display a sender name instead of your number.
        </p>
        <p>
          Voice is outside the first release. OTP and short-code reception are
          not guaranteed.
        </p>
        <Link className="text-link" href="/docs">
          Read the phone API guide →
        </Link>
      </section>
    </PublicPage>
  );
}
