import type { Metadata } from "next";
import { LegalPage } from "@/components/legal";

export const metadata: Metadata = { title: "Privacy Policy (draft)" };

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" updated="[date]">
      <p>
        This policy explains what personal data [Company legal name] (&quot;we&quot;) collects through Linkable, why, and your choices. Contact: [privacy contact email]. [Add data
        protection officer / EU representative details if required.]
      </p>

      <h2>1. What we collect</h2>
      <ul>
        <li><strong>Account data:</strong> name, email address, password (stored only as a one-way hash), two-factor settings, and Google profile details if you sign in with Google.</li>
        <li><strong>Workspace and marketplace data:</strong> workspaces, team members and roles, websites you list, verification records, link requests, proposals, deals, messages, reviews, disputes and credit history.</li>
        <li><strong>Website data:</strong> public information about listed sites and pages, including metrics from SEO providers, IP addresses of sites, and the results of our link checks.</li>
        <li><strong>Content you submit:</strong> guest posts and any text you send to our AI tools.</li>
        <li><strong>Google Search Console data:</strong> if you connect Search Console for a site, we keep read-only access (an encrypted token) until you disconnect. We use it to confirm that pages carrying links are indexed by Google, and to read search clicks, impressions and average position for pages that received links. Besides the token, we store the Google account email, the matching Search Console property names, and those numbers and indexing results, not your other Search Console data.</li>
        <li><strong>Security and usage data:</strong> IP address and timestamps of sign-in, sign-up and password-reset attempts (kept for rate limiting and fraud prevention), and audit logs of important account actions.</li>
      </ul>

      <h2>2. Why we use it (legal bases)</h2>
      <ul>
        <li>To provide the Service you signed up for (contract): accounts, matching, deals, link verification, notifications.</li>
        <li>To keep the Service secure and prevent abuse (legitimate interests): rate limiting, spam and footprint checks, audit logs.</li>
        <li>To send service emails and, if you keep them on, digests and monthly reports. You can change email settings in your account.</li>
        <li>To meet legal obligations.</li>
      </ul>

      <h2>3. Who we share it with</h2>
      <p>
        Other users see the information needed to trade with you (your workspace name, listed sites and their metrics, deal details, messages and reviews). We use processors who
        handle data on our behalf: [hosting - Vercel], [database - Neon], [email - Resend], [AI - Anthropic, for AI suggestions and drafts], [SEO metrics - Ahrefs], [Google, for
        sign-in and Search Console]. We do not sell personal data.
      </p>

      <h2>4. International transfers</h2>
      <p>[Describe where data is stored and the safeguards used for transfers, e.g. Standard Contractual Clauses.]</p>

      <h2>5. Retention</h2>
      <p>
        We keep account and deal records while your account is open and for [period] afterwards for dispute resolution and legal reasons. Sign-in attempt records are deleted after
        about a day. [Adjust to your retention schedule.]
      </p>

      <h2>6. Your rights</h2>
      <p>
        Depending on where you live you may have rights to access, correct, delete or export your data, object to or restrict processing, and complain to a data protection
        authority. Contact us at [privacy contact email]. Workspace data can be exported as CSV from the Credits page.
      </p>

      <h2>7. Cookies</h2>
      <p>We use only essential cookies: a session cookie to keep you signed in and a cookie remembering your current workspace. [Update if analytics are added.]</p>

      <h2>8. Security</h2>
      <p>Passwords are hashed, two-factor secrets are encrypted, sign-in attempts are rate limited, and access is restricted by role. No system is perfectly secure.</p>

      <h2>9. Changes</h2>
      <p>We will post changes here and notify you of material ones.</p>
    </LegalPage>
  );
}
