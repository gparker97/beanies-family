# Security Implementation Guide

## Overview

This guide documents the security measures implemented in the GP Family Finance Planner application and provides guidance for developers on maintaining security standards.

## Security Scanning Infrastructure

### 1. Automated Security Scans

#### NPM Audit

Scans all dependencies for known vulnerabilities in the npm registry.

```bash
# Run dependency vulnerability scan
npm run security:audit

# Fix vulnerabilities automatically (use with caution)
npm run security:audit:fix
```

**When it runs:**

- On demand (`npm run security:audit`)
- Pull requests (via GitHub Actions)
- Daily scheduled scans (2 AM UTC)

#### Security Linting (SAST)

Static Application Security Testing using ESLint plugins.

```bash
# Run security-focused code analysis
npm run security:lint

# Run comprehensive security check
npm run security:full
```

**Detects:**

- Potential injection vulnerabilities
- Hardcoded secrets and API keys
- Insecure coding patterns
- Use of unsafe functions
- XSS vulnerabilities

#### GitHub CodeQL

Advanced semantic code analysis for security vulnerabilities.

**Detects:**

- SQL injection
- Cross-site scripting (XSS)
- Path traversal
- Command injection
- Authentication bypasses
- And 100+ other security issues

**Runs on:** Every push and pull request to main/develop branches

### 2. Security Plugins

#### eslint-plugin-security

Identifies potential security hotspots in JavaScript/TypeScript code.

**Key Rules:**

- `detect-object-injection`: Prevents prototype pollution
- `detect-non-literal-regexp`: Prevents ReDoS attacks
- `detect-unsafe-regex`: Identifies regex performance issues
- `detect-eval-with-expression`: Prevents code injection
- `detect-possible-timing-attacks`: Identifies timing vulnerabilities

#### eslint-plugin-no-secrets

Prevents committing sensitive data like API keys, tokens, and passwords.

**Configuration:**

```javascript
'no-secrets/no-secrets': ['error', {
  tolerance: 4.2, // Entropy threshold for detection
  additionalDelimiters: [',', ';', ':', '=']
}]
```

#### @microsoft/eslint-plugin-sdl

Microsoft Security Development Lifecycle best practices.

**Key Rules:**

- `no-inner-html`: Prevents XSS via innerHTML
- `no-insecure-url`: Enforces HTTPS
- `no-postmessage-star-origin`: Prevents postMessage vulnerabilities

### 3. Dependabot Configuration

Automated dependency updates and security patches.

**Schedule:** Weekly on Mondays at 9 AM EST

**Features:**

- Automatic security updates
- Grouped minor/patch updates
- Separate PRs for major versions
- GitHub Actions version updates

## Security Headers

### Implemented Headers (index.html)

```html
<!-- Prevents MIME type sniffing -->
<meta http-equiv="X-Content-Type-Options" content="nosniff" />

<!-- Controls referrer information -->
<meta name="referrer" content="strict-origin-when-cross-origin" />

<!-- Restricts browser features -->
<meta http-equiv="Permissions-Policy" content="geolocation=(), microphone=(), camera=()" />
```

### Content Security Policy (CSP)

**Status:** Ready to enable (commented out)

When enabled, CSP prevents:

- Inline script execution (XSS prevention)
- Loading resources from untrusted domains
- Clickjacking attacks
- Protocol downgrade attacks

**To enable:**
Uncomment the CSP meta tag in `index.html` and customize for your CDN sources.

### Server-Side Headers (Future)

For production deployment, configure these HTTP headers:

```
# Security Headers (CloudFront/Nginx/Apache)
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: geolocation=(), microphone=(), camera=()
Content-Security-Policy: default-src 'self'; script-src 'self'; ...
```

## Encryption Best Practices

### Client-Side Encryption

All sensitive data must be encrypted before storage using the Web Crypto API.

**Implementation:**

```typescript
import { encryptData, decryptData } from '@/services/crypto/encryption';

// Encrypt before storing
const encrypted = await encryptData(sensitiveData, encryptionKey);
await saveToIndexedDB(encrypted);

// Decrypt when retrieving
const encrypted = await loadFromIndexedDB();
const decrypted = await decryptData(encrypted, encryptionKey);
```

**Key Requirements:**

- Use AES-GCM-256 algorithm
- Generate unique IV (initialization vector) for each encryption
- Use PBKDF2 for key derivation (100,000+ iterations)
- Never log encryption keys or plaintext data
- Clear sensitive data from memory after use

### Key Management

**Master Password:**

- Minimum 16 characters recommended
- Never transmitted to server
- Used to derive encryption keys
- Store encrypted in sessionStorage (temporary) or localStorage (persistent)

**Encryption Keys:**

- Derived from master password using PBKDF2
- Unique salt per user (store with encrypted data)
- Rotate keys periodically (advanced)

## Input Validation

### Client-Side Validation

All user inputs must be validated before processing:

```typescript
// Example: Validate currency amount
function validateAmount(amount: number): boolean {
  if (typeof amount !== 'number') return false;
  if (!Number.isFinite(amount)) return false;
  if (amount < 0) return false;
  if (amount > 999999999.99) return false; // Reasonable limit
  return true;
}
```

### TypeScript Type Safety

Leverage TypeScript to prevent type-related vulnerabilities:

```typescript
// Use strict types
interface Transaction {
  id: string;
  amount: number; // Not 'any' or 'unknown'
  category: TransactionCategory; // Use enums/unions
}

// Validate at runtime
function isValidTransaction(data: unknown): data is Transaction {
  // Runtime type checking
}
```

### Vue.js Auto-Escaping

Vue automatically escapes HTML content to prevent XSS:

```vue
<!-- Safe: Auto-escaped -->
<div>{{ userInput }}</div>

<!-- Unsafe: Avoid v-html with user input -->
<div v-html="userInput"></div>
<!-- ❌ DON'T DO THIS -->

<!-- If v-html is necessary, sanitize first -->
<div v-html="sanitize(userInput)"></div>
```

## Authentication — Passkey / Biometric (ADR-015)

### Architecture

The app uses WebAuthn passkeys for biometric login. Passkey registrations are stored in a device-level registry IndexedDB (not the per-family database) so they survive sign-out.

**Two paths:**

- **PRF path** (Chrome, Edge): Derives encryption key from biometric via HKDF — true passwordless
- **Cached password path** (Firefox, fallback): Passkey authenticates the member; encryption password is cached locally

### Cross-Device Passkey Sync

Modern platform authenticators (iCloud Keychain, Google Password Manager, Windows Hello) sync passkeys across devices. When a user registers on Device A and Device B, either credential may be presented on either device.

**How it works:**

1. Browser returns a synced credential whose ID isn't in the local registry
2. The `userHandle` identifies the member (set during registration as `TextEncoder.encode(memberId)`)
3. If a cached encryption password exists for the family, the synced credential is auto-registered locally
4. If no cached password exists, user is prompted to enter their password once

**Trust model:**

- Platform authenticator verifies the user biometrically before returning an assertion
- `userHandle` confirms the credential belongs to a known family member
- Cached password is already present on trusted devices
- No server-side signature verification (challenge is client-generated for local-first architecture)

**Limitation:** First sign-in on a new device always requires a password. Synced passkeys only work after the password has been cached at least once (trusted device model).

### Session Management

**Requirements:**

- Session stored in `sessionStorage` (cleared on tab close)
- Re-authentication required after sign-out
- IndexedDB cache deleted on sign-out (unless trusted device)

## Secrets Management

### Never Commit Secrets

**Prohibited:**

- API keys
- Passwords
- Private keys
- Access tokens
- Encryption keys
- AWS credentials

**Detection:**
The `no-secrets` plugin will catch most hardcoded secrets.

### Environment Variables

Use environment variables for configuration:

```typescript
// ✅ Good
const apiKey = import.meta.env.VITE_API_KEY;

// ❌ Bad
const apiKey = 'sk-1234567890abcdef'; // Hardcoded
```

### .env Files

**Structure:**

```
# .env.local (not committed)
VITE_API_KEY=your-api-key-here
VITE_AWS_REGION=us-east-1

# .env.example (committed)
VITE_API_KEY=
VITE_AWS_REGION=
```

## Security Testing

### Unit Tests

Test security-critical functions:

```typescript
describe('encryption', () => {
  it('should encrypt and decrypt data correctly', async () => {
    const data = { sensitive: 'information' };
    const key = await generateKey('password');
    const encrypted = await encryptData(data, key);
    const decrypted = await decryptData(encrypted, key);
    expect(decrypted).toEqual(data);
  });

  it('should use unique IV for each encryption', async () => {
    const data = { test: 'data' };
    const key = await generateKey('password');
    const encrypted1 = await encryptData(data, key);
    const encrypted2 = await encryptData(data, key);
    expect(encrypted1.iv).not.toEqual(encrypted2.iv);
  });
});
```

### E2E Security Tests

Test authentication flows, authorization, and data protection:

```typescript
test('should require authentication for sensitive pages', async ({ page }) => {
  await page.goto('/accounts');
  await expect(page).toHaveURL('/login'); // Redirected
});

test('should mask sensitive data in privacy mode', async ({ page }) => {
  await page.goto('/accounts');
  await page.click('[data-testid="privacy-toggle"]');
  const balance = await page.textContent('[data-testid="account-balance"]');
  expect(balance).toBe('***'); // Masked
});
```

## Security Checklist

### Development

- [ ] No secrets in code or version control
- [ ] All user inputs validated
- [ ] Sensitive data encrypted before storage
- [ ] HTTPS enforced (production)
- [ ] Security linting passes
- [ ] NPM audit shows no high/critical vulnerabilities
- [ ] TypeScript strict mode enabled
- [ ] CSP headers configured
- [ ] Error messages don't leak sensitive info

### Code Review

- [ ] Authentication/authorization properly implemented
- [ ] Input validation on all forms
- [ ] No SQL injection vulnerabilities (N/A - no SQL)
- [ ] No XSS vulnerabilities (check v-html usage)
- [ ] Encryption keys properly managed
- [ ] Logging doesn't capture sensitive data
- [ ] Third-party dependencies reviewed

### Deployment

- [ ] All security scans pass in CI/CD
- [ ] HTTPS enabled with valid certificate
- [ ] Security headers configured
- [ ] CSP policy active
- [ ] Rate limiting enabled (API endpoints)
- [ ] Monitoring and alerting configured
- [ ] Incident response plan documented
- [ ] Backup and recovery tested

## Common Vulnerabilities & Prevention

### Cross-Site Scripting (XSS)

**Risk:** Attacker injects malicious scripts into the application.

**Prevention:**

- Vue.js auto-escapes all template content
- Avoid `v-html` with user input
- Configure Content Security Policy
- Sanitize any user-generated HTML

### Prototype Pollution

**Risk:** Attacker modifies Object.prototype to inject malicious properties.

**Prevention:**

- Use `Object.create(null)` for dictionaries
- Validate object keys before access
- Avoid `obj[userInput]` pattern without validation
- Use TypeScript for type safety

### Timing Attacks

**Risk:** Attacker infers secrets by measuring response times.

**Prevention:**

- Use constant-time comparison for secrets
- Implement rate limiting
- Add random delays to responses
- Use crypto.timingSafeEqual() for comparisons

### Dependency Vulnerabilities

**Risk:** Third-party packages contain security flaws.

**Prevention:**

- Run `npm audit` regularly
- Enable Dependabot for automatic updates
- Review dependency licenses
- Minimize number of dependencies
- Pin dependency versions

## Incident Response

### If a Vulnerability is Discovered

1. **Assess Impact:**
   - What data is exposed?
   - How many users affected?
   - Can it be exploited remotely?

2. **Immediate Actions:**
   - Document the vulnerability
   - Notify the security team
   - Begin developing a fix

3. **Remediation:**
   - Create a fix in a private branch
   - Test thoroughly
   - Deploy to production ASAP
   - Notify affected users if needed

4. **Post-Incident:**
   - Write incident report
   - Update security documentation
   - Add tests to prevent recurrence
   - Review similar code for same issue

## Resources

### Tools

- [npm audit](https://docs.npmjs.com/cli/v8/commands/npm-audit) - Dependency scanning
- [ESLint Security Plugin](https://github.com/nodesecurity/eslint-plugin-security)
- [GitHub CodeQL](https://codeql.github.com/)
- [OWASP ZAP](https://www.zaproxy.org/) - Penetration testing

### References

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Web Crypto API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API)
- [CSP Reference](https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP)
- [Vue Security](https://vuejs.org/guide/best-practices/security.html)
- [TypeScript Security](https://www.typescriptlang.org/docs/handbook/security.html)

---

Last Updated: 2026-02-13

**Remember:** Security is an ongoing process, not a one-time task. Stay vigilant!
