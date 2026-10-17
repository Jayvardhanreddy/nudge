# Security Policy

## Reporting a vulnerability
Do not disclose vulnerabilities publicly or include real user data in a report. Use the repository owner's private contact channel and provide a concise description, affected endpoint, impact and safe reproduction steps. The operator must configure and monitor a dedicated security contact before public launch.

## Required controls
- Keep JWT, Meta, payment, email and database credentials in the hosting provider's secret store; never put them in HTML, browser JavaScript, public build output or Git.
- Rotate any credential suspected of exposure and remove leaked values from active configuration. Git history cleanup does not replace rotation.
- Keep authentication cookies HttpOnly, Secure in production, appropriately SameSite, short-lived where practical and revocable server-side.
- Enforce per-user ownership checks on every API route; never rely on hidden UI controls.
- Rate-limit login, password reset, support and expensive automation endpoints.
- Validate all input, bound payload sizes, avoid returning stack traces or secrets, and keep logs free of access tokens and unnecessary personal data.
- Restrict MongoDB network access and database roles; back up data and test restore procedures.
- Verify Meta webhook signatures and payment-provider signatures before processing events.
- Maintain a documented incident response process, including containment, investigation, required notifications and post-incident remediation.

## Release gate
Run dependency and secret scans, test unauthenticated access and two-account isolation, verify password reset and logout, check database access rules, and smoke-test production before release. A successful build alone is not a security audit.