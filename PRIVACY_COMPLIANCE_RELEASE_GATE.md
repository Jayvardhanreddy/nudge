# Privacy, Legal and Security Release Gate

**Status: NOT CERTIFIED.** This checklist is an engineering release gate, not legal advice or a declaration that the application complies with every law. The operator must identify the countries and sectors served and obtain appropriate legal review.

## India: minimum review set

- Review the Digital Personal Data Protection Act, 2023, the DPDP Rules, 2025, the commencement notifications and the December 2025 corrigendum. The Rules use phased commencement: Rule 4 is scheduled one year after the Gazette publication of 13 November 2025; Rules 3, 5–16, 22 and 23 are scheduled eighteen months after publication. Confirm the current official status before release.
- Review the Information Technology Act, 2000, applicable IT Rules and any sector-specific requirements.
- Assess whether CERT-In Directions under section 70B apply to the operator. Where applicable, implement incident reporting, a designated point of contact, and secure log retention consistent with the Directions (including the stated 180-day log requirement and India-location requirement).
- If selling subscriptions or other services, review consumer-protection, e-commerce, pricing, refund, cancellation, advertising and tax requirements.
- Review intellectual-property and third-party licence obligations for all code, media, fonts, models, APIs and other assets.
- Re-check laws for every additional country in which the service is offered; India-only review is not enough for an international product.

Official references:
- DPDP Rules, 2025 (MeitY Gazette): https://www.meity.gov.in/static/uploads/2025/11/53450e6e5dc0bfa85ebd78686cadad39.pdf
- DPDP commencement notification (MeitY Gazette): https://www.meity.gov.in/static/uploads/2025/11/c56ceae6c383460ca69577428d36828b.pdf
- CERT-In Directions under section 70B: https://www.cert-in.org.in/Directions70B.jsp

## Required before production

- [ ] Publish the verified legal/operator identity, a working privacy contact, a monitored support channel and a grievance/escalation process.
- [ ] Maintain a data inventory: each field, purpose, lawful basis/consent where required, data location, recipient/provider, retention period and deletion method.
- [ ] Use a clear, feature-specific notice before collecting data; avoid bundled or misleading consent.
- [ ] Collect only what is needed. Do not collect children's, student, financial, health or other sensitive information without a documented necessity and applicable safeguards.
- [ ] Verify every provider's terms, retention, subprocessors, security settings and international transfers; disclose actual providers rather than intended ones.
- [ ] Keep API keys, database credentials, signing keys and provider tokens in hosting secrets. Never ship them to browser code or commit them. Scan Git history and rotate any exposed credential.
- [ ] Enforce server-side authentication, object-level authorisation, role/tenant isolation, input validation, safe output rendering, rate limits, secure cookies, CSRF protections where applicable and no-store headers for private responses.
- [ ] Restrict database network access and permissions; encrypt in transit; test backup restore and deletion/retention procedures.
- [ ] Implement privacy requests (access, correction, erasure, consent withdrawal where applicable, grievance) and ensure the actual data stores, logs, backups and providers are handled consistently with legal retention duties.
- [ ] Create an incident-response plan, preserve required logs securely, define escalation and test reporting deadlines.
- [ ] Run dependency audits, secret scans, automated tests, two-user isolation tests and real production-like smoke tests. Review failures; do not merge merely because a page exists.
- [ ] Verify that marketing claims, pricing, cancellation/refund terms and the privacy notice match the real product behavior.

## Evidence to retain

Record the reviewer, review date, data-flow diagram, provider list, retention schedule, test results, vulnerability remediation, backup-restore evidence, incident contact and approval for release. Reassess after material changes.

**Release decision:** Do not mark this project legally compliant or launch it with real personal data until the unchecked items are completed and the responsible operator has approved the deployment-specific notice and legal review.

## Nudge-specific checks
- Verify Meta app review, business verification, permissions, webhook verification, token handling, data deletion callbacks/requests and current Instagram Messaging API terms.
- Ensure automation respects platform messaging windows, opt-in, user controls, rate limits and anti-spam requirements.
- Publish accurate subscription prices, renewals, cancellation and refund terms; do not retain payment data beyond documented lawful needs.
- Verify that Instagram tokens are encrypted at rest and never logged or returned to the browser.
