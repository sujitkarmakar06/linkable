import type { Metadata } from "next";
import { LegalPage } from "@/components/legal";

export const metadata: Metadata = { title: "Terms of Service (draft)" };

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service" updated="[date]">
      <p>
        These terms govern your use of Linkable (the &quot;Service&quot;), operated by [Company legal name], [registered address] (&quot;we&quot;, &quot;us&quot;). By creating an account you
        agree to them on behalf of yourself and the workspace you use.
      </p>

      <h2>1. What Linkable does</h2>
      <p>
        Linkable is a marketplace where website owners arrange contextual links between their sites. Value is exchanged in platform credits, and links are arranged so that two
        sites do not simply link to each other (&quot;ABC&quot; or three-way exchanges). We provide matching, tracking and verification tools; we do not publish content on your
        websites.
      </p>

      <h2>2. Search engine risk - please read</h2>
      <p>
        Search engines, including Google, treat links exchanged for value as a possible violation of their spam policies (&quot;link schemes&quot;). Using Linkable may lead a search
        engine to ignore those links or take manual or algorithmic action against your site, including lower rankings or removal from results. You use the Service at your own risk
        and you are solely responsible for complying with search engine guidelines. We make no promise about rankings, traffic or any SEO result. Consider using rel=&quot;sponsored&quot;
        or &quot;nofollow&quot; where appropriate.
      </p>

      <h2>3. Accounts and workspaces</h2>
      <ul>
        <li>You must be at least 18 and able to enter a contract. Give accurate information and keep your credentials secure; turning on two-factor authentication is recommended.</li>
        <li>Workspace owners are responsible for the people they invite and for everything done in the workspace.</li>
        <li>You may only list websites you own or are authorised to manage, and you must prove ownership through our verification process.</li>
      </ul>

      <h2>4. Credits</h2>
      <ul>
        <li>Credits are a usage unit inside Linkable. They have no cash value, cannot be bought back, transferred outside the platform or exchanged for money, and expire if your account is closed.</li>
        <li>Credits for a link are held in escrow and released to the site that placed it in stages over the guarantee period, starting once Google has indexed the page carrying the link, as reported by the host&apos;s Google Search Console. If the page is not indexed within 30 days of the link being verified, the escrowed credits are returned to the receiver. We may reverse, refund or adjust credits to correct errors, resolve disputes or respond to abuse.</li>
        <li>Penalties for removing a link early may result in a negative balance, which blocks spending until it is earned back.</li>
      </ul>

      <h2>5. Link placements and the guarantee</h2>
      <ul>
        <li>When you agree to place a link you must place it as agreed (page, anchor text, dofollow or nofollow) by the due date and keep it live, indexable and unchanged for the guarantee period ([12] months).</li>
        <li>Our crawler checks placed links regularly. If a link fails checks and is not restored within the grace period ([7] days) it is treated as removed: unreleased credits are refunded to the other party, a penalty applies and your reputation score drops. Repeated removals can lead to suspension.</li>
        <li>Either party may open a dispute. Our decision on a dispute is final within the Service.</li>
      </ul>

      <h2>6. Content rules</h2>
      <ul>
        <li>No sites or content about gambling, adult content, pharmaceuticals, CBD, cryptocurrency trading, payday loans or any other niche we list as banned, and nothing illegal, deceptive, hateful, infringing or malicious (including malware and phishing).</li>
        <li>Guest posts must be original, accurate and not misleading. You are responsible for any content you submit, including content drafted with our AI tools.</li>
        <li>AI suggestions and drafts are generated automatically and may be wrong. Review and edit them, and verify every fact, before use.</li>
      </ul>

      <h2>7. Prohibited use</h2>
      <p>
        Do not use networks of sites under common control to game the system, create multiple accounts to obtain credits, interfere with the Service or its security, scrape it,
        or use it to harass other users. We may suspend or close accounts and reverse credits for any of these.
      </p>

      <h2>8. Fees</h2>
      <p>The Service is currently free. If we introduce paid plans we will tell you in advance, and paid features will have their own terms.</p>

      <h2>9. Third-party services</h2>
      <p>
        We rely on third parties (for example hosting, email delivery, SEO metrics providers, Google sign-in and Search Console, and AI model providers). Metrics such as Domain
        Rating come from third parties and may be inaccurate.
      </p>

      <h2>10. Termination</h2>
      <p>You can close your account at any time. We may suspend or end access if you breach these terms or if required by law. Ongoing deals may be cancelled and credits adjusted on termination.</p>

      <h2>11. Disclaimers and liability</h2>
      <p>
        The Service is provided &quot;as is&quot;. To the extent permitted by law we disclaim all warranties and are not liable for indirect or consequential losses, lost profits,
        lost rankings or traffic, or search engine penalties. Our total liability is limited to [amount]. Nothing limits liability that cannot be limited by law.
      </p>

      <h2>12. Changes and governing law</h2>
      <p>
        We may update these terms and will notify you of material changes. These terms are governed by the laws of [jurisdiction], and disputes go to the courts of [venue].
        Contact: [legal contact email].
      </p>
    </LegalPage>
  );
}
