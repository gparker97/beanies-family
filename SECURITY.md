# Security Policy

## Overview

beanies.family is a local-first, encrypted family finance and planning app. It handles sensitive financial data and takes security seriously. All family data is encrypted client-side before storage or sync — server-side systems never see plaintext financial data.

This document outlines our security architecture, practices, how to report vulnerabilities, and our security response process.

## Supported Versions

We provide security updates for the following versions:

| Version | Supported          |
| ------- | ------------------ |
| 0.x.x   | :white_check_mark: |

## Security Architecture

### 1. Encryption

All family data is encrypted using the Web Crypto API with industry-standard algorithms. No plaintext financial data is ever stored on disk, in the browser, or transmitted to any server.

#### Family Key Model

The encryption system uses a three-tier key hierarchy:

- **Family key** (AES-GCM-256): A random 256-bit symmetric key generated per family. Encrypts the entire Automerge CRDT binary payload.
- **Per-member wrapping** (AES-KW-256): Each family member's password derives a 256-bit AES-KW wrapping key via PBKDF2 (100,000 iterations, SHA-256, 16-byte random salt). This wrapping key encrypts (wraps) the family key for that member.
- **Alternative wrapping paths**: Passkey PRF output (via HKDF-SHA-256) and invite tokens (via PBKDF2) can also wrap the family key for their respective flows.

#### V4 Beanpod File Format

The `.beanpod` file (V4) stores:

- `encryptedPayload`: AES-GCM-256 ciphertext with prepended 12-byte IV (random per save)
- `wrappedKeys`: Per-member AES-KW-wrapped family keys (each with unique PBKDF2 salt)
- `passkeyWrappedKeys`: PRF-derived AES-KW-wrapped family keys (each with HKDF salt)
- `inviteKeys`: Time-limited invite token-wrapped family keys (24-hour expiry)
- `familyId`, `familyName`, `keyId` (rotation identifier)

#### Storage Encryption

- **IndexedDB cache**: Automerge binary is encrypted with the family key (AES-GCM-256) before being stored in the per-family IndexedDB cache. Cache is deleted on sign-out from untrusted devices.
- **`.beanpod` file**: The durable copy — always encrypted with the family key.
- **Google Drive**: The same encrypted `.beanpod` file is synced; Google never sees plaintext data.

### 2. Authentication & Sessions

Authentication is fully client-side (no server-side user accounts):

- **Password authentication**: PBKDF2-SHA-256 with 100,000 iterations and 16-byte random salt. Constant-time hash comparison prevents timing attacks. Passwords never leave the device.
- **Passkey/WebAuthn biometrics**: Full WebAuthn support for Face ID, Touch ID, Windows Hello, and fingerprint. Supports PRF extension for direct family key unwrapping, cross-device credential sync (iCloud Keychain, Google Password Manager), and credential removal signaling (WebAuthn Signal API).
- **Session storage**: Active session stored in localStorage (`memberId`, `email`, `familyId`, `role`). Cleared on sign-out. No JWT tokens, no cookies, no server-side sessions.
- **Trusted device cache**: Optional per-device family key caching in a global IndexedDB registry for cross-browser session persistence.

### 3. Google Drive Sync (OAuth 2.0 + PKCE)

Google Drive sync uses a secure OAuth flow:

- **PKCE**: Authorization Code flow with Proof Key for Code Exchange (32-byte crypto-random verifier)
- **Server-side secret**: OAuth token exchange proxied through an AWS Lambda — client secret never exposed to the browser
- **Scoped access**: `drive.file` scope (app-created files only) + `userinfo.email`
- **Redirect URI whitelist**: Only `https://beanies.family/oauth/callback` and localhost dev URLs
- **Token management**: Refresh tokens stored in per-family IndexedDB. Auto-refresh 5 minutes before expiry. Best-effort revocation on disconnect.
- **Zero-knowledge**: Google Drive stores the encrypted `.beanpod` file — Google never has access to the family key or plaintext data.

### 4. Dependency Security

- **Automated scanning**: Daily vulnerability scans via GitHub Actions (`security.yml`)
- **Dependabot**: Weekly automatic security updates for npm and GitHub Actions dependencies (grouped by dev/prod)
- **NPM audit**: Runs on every security scan (`npm audit --audit-level=moderate`)
- **Dependency review**: PR-level review via `actions/dependency-review-action@v4` (fails on moderate severity, denies GPL-3.0/AGPL-3.0 licenses)

### 5. Code Security

- **SAST**: ESLint security plugins (`eslint-plugin-security`, `@microsoft/eslint-plugin-sdl`) with strict rules for unsafe regex, eval, child process, CSRF, buffer, and timing attacks
- **CodeQL**: GitHub Advanced Security scanning with `security-extended` and `security-and-quality` query suites
- **Secrets detection**: `eslint-plugin-no-secrets` (tolerance 4.2 in CI, 4.5 in dev) prevents hardcoded secrets
- **Git hooks**: Pre-commit linting (via Husky + lint-staged) and pre-push unit tests

### 6. Network & Infrastructure Security

- **HTTPS only**: CloudFront enforces TLS 1.2+ (`TLSv1.2_2021` minimum) with redirect-to-HTTPS
- **CORS**: API Gateway CORS configuration restricts origins, methods, and headers per environment
- **S3 bucket**: Fully private — all public access blocked, CloudFront OAC with SigV4 signing
- **Lambda functions**: Inline code (no external dependencies), minimal IAM permissions, environment variable secrets
- **API authentication**: Registry API protected by `x-api-key` header validation
- **Security headers** (via HTML meta tags): `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: geolocation=(), microphone=(), camera=()`

### 7. Input Validation

- **Client-side validation**: All user inputs validated before processing
- **Type safety**: TypeScript prevents type-related vulnerabilities
- **Sanitization**: Vue.js automatically escapes HTML content in templates
- **UUID validation**: Registry Lambda validates all ID parameters against UUID regex
- **No SQL database**: Local-first Automerge CRDT architecture eliminates SQL injection

## Security Testing

### Automated Tests

- **Unit tests**: Security-critical functions tested (encryption round-trips, key wrapping, passkey flows)
- **E2E tests**: Full user flows tested via Playwright (Chromium + Firefox)
- **Security scanning**: Runs on every push to main and on PRs (`security.yml`)
- **Deploy gate**: Production deploys require both Main Branch CI and Security Scanning workflows to pass

### Manual Testing

- **Code reviews**: All changes reviewed for security implications
- **Penetration testing**: Recommended before major releases
- **Security audits**: Periodic third-party security assessments (planned)

## Reporting a Vulnerability

If you discover a security vulnerability, please follow these steps:

### 1. **DO NOT** create a public GitHub issue

Security vulnerabilities should not be publicly disclosed until patched.

### 2. Report privately

Contact the site owner via the contact page on the website.

Include the following information:

- Description of the vulnerability
- Steps to reproduce the issue
- Potential impact (data exposure, privilege escalation, etc.)
- Suggested fix (if any)
- Your contact information for follow-up

### 3. Response timeline

- **24 hours**: Initial acknowledgment of your report
- **7 days**: Preliminary assessment and severity classification
- **30 days**: Fix developed, tested, and deployed (for critical issues)
- **90 days**: Public disclosure after patch is released

### 4. Recognition

We appreciate responsible disclosure. Security researchers who report valid vulnerabilities will be:

- Credited in our security acknowledgments (if desired)
- Listed in CHANGELOG for the security fix
- Eligible for bug bounty rewards (if program is established)

## Security Best Practices for Users

### For Developers

1. **Keep dependencies updated**: Run `npm audit` regularly
2. **Review security alerts**: Check GitHub security advisories
3. **Use strong encryption keys**: Generate secure random passwords
4. **Never commit secrets**: Use environment variables for sensitive data
5. **Enable 2FA**: On GitHub and cloud provider accounts
6. **Code review**: Review all pull requests for security issues
7. **Run security linting**: `npm run security:check` before pushing

### For End Users

1. **Use a strong password**: Choose a unique, memorable passphrase for your family pod
2. **Enable biometric auth**: Register a passkey (Face ID/Touch ID/fingerprint) for faster, phishing-resistant sign-in
3. **Keep your app updated**: Refresh the page periodically to get the latest version
4. **Secure your device**: Use device password/PIN and enable disk encryption
5. **Back up your data**: Keep a local `.beanpod` file copy as a backup alongside Google Drive sync
6. **Report suspicious activity**: Contact us if you notice anything unusual

## Known Security Considerations

### Local-First Architecture

- **Pros**: Data encrypted on-device; server-side systems never see plaintext; works offline
- **Cons**: Device compromise = potential data compromise (encrypted data + key in memory)
- **Mitigation**: AES-GCM-256 encryption, strong passwords, passkey biometrics, IndexedDB cache cleared on sign-out from untrusted devices

### Browser Storage

- **Pros**: IndexedDB is origin-isolated and all stored data is AES-GCM-256 encrypted
- **Cons**: Browser extensions with broad permissions can potentially access encrypted blobs; family key is in memory during active session
- **Mitigation**: Review installed extensions, keep browser updated, sign out when not in use

### Google Drive Sync

- **Pros**: Access data from anywhere, automatic cloud backup, cross-device sync
- **Cons**: Increased attack surface via OAuth flow, dependency on Google infrastructure
- **Mitigation**: Client-side encryption (Google never sees plaintext), PKCE OAuth flow, scoped `drive.file` access, server-side client secret, token revocation on disconnect

## Security Checklist for Deployment

Before deploying to production, ensure:

- [x] All dependencies are up to date (`npm audit` passes)
- [x] Security scanning passes in CI/CD (CodeQL + SAST + secrets detection)
- [x] No secrets committed to repository (`eslint-plugin-no-secrets` enforced)
- [x] HTTPS enabled with TLS 1.2+ (CloudFront enforced)
- [x] CORS configured for API endpoints (API Gateway level)
- [x] API endpoints protected by API key
- [x] Error messages don't leak sensitive information
- [x] Logging doesn't capture sensitive data (passwords, encryption keys)
- [x] S3 bucket fully private (OAC + block all public access)
- [x] Deploy gate requires CI + Security workflows to pass
- [ ] Content Security Policy headers enabled
- [ ] HSTS and X-Frame-Options headers at CDN level
- [ ] Subresource Integrity for third-party resources
- [ ] Rate limiting on API endpoints
- [ ] AWS WAF rules on CloudFront

## Security Resources

### Tools We Use

- **npm audit**: Dependency vulnerability scanning
- **eslint-plugin-security**: OWASP-aligned static code analysis
- **@microsoft/eslint-plugin-sdl**: Microsoft SDL security rules
- **eslint-plugin-no-secrets**: Hardcoded secrets detection
- **GitHub CodeQL**: Advanced security scanning (security-extended + security-and-quality)
- **Dependabot**: Automated dependency updates with license compliance
- **Husky + lint-staged**: Pre-commit security linting and pre-push tests

### References

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Web Crypto API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API)
- [WebAuthn Specification](https://www.w3.org/TR/webauthn-3/)
- [Content Security Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP)
- [NIST Cybersecurity Framework](https://www.nist.gov/cyberframework)
- [CWE Top 25](https://cwe.mitre.org/top25/archive/2024/2024_cwe_top25.html)

## Compliance

This application is designed with the following compliance considerations:

- **GDPR**: User data can be exported and deleted; all data encrypted; no server-side plaintext storage
- **CCPA**: California Consumer Privacy Act compliance
- **SOC 2**: Security controls aligned with SOC 2 principles (future)
- **PCI DSS**: Not applicable (no credit card processing)

## Security Roadmap

### Planned Security Enhancements

- [ ] Enable Content Security Policy headers (draft policy exists, needs testing)
- [ ] Add HSTS and X-Frame-Options via CloudFront response headers policy
- [ ] Enable Subresource Integrity for third-party resources (Google Fonts)
- [ ] Implement rate limiting on API Gateway / Lambda endpoints
- [ ] Add AWS WAF rules on CloudFront distribution
- [ ] Implement `/.well-known/security.txt` (RFC 9116)
- [ ] Migrate Lambda secrets to AWS Secrets Manager
- [ ] Enable DynamoDB encryption at rest
- [ ] Set up bug bounty program
- [ ] Conduct third-party security audit
- [ ] Implement automated DAST scanning
- [ ] Add session inactivity timeout

## Contact

For security inquiries, contact:

- **Security Team**: Contact me via the contact form on the website
- **General Issues**: https://github.com/gparker97/beanies-family/issues
- **Private Reports**: Use GitHub Security Advisories

---

Last Updated: 2026-03-10

We are committed to maintaining the security and privacy of your financial data. Thank you for using beanies.family responsibly.
