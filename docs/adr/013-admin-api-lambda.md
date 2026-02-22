# ADR-013: Admin API with Lambda + API Gateway

**Status:** Superseded by [ADR-014](014-file-based-auth.md)
**Date:** 2026-02-22

## Context

Certain operations require Cognito admin privileges that are unavailable from the browser SDK. Specifically, deleting another user's Cognito entry requires `AdminDeleteUser`, which needs IAM credentials. The browser can only delete the currently authenticated user (self-deletion), not other family members.

When a family owner removes a member from the UI, the member's Cognito account should also be deleted to keep identity state clean.

## Decision

Add a minimal API layer using **AWS API Gateway (HTTP API)** and **Lambda (Node.js 20)** for admin operations that require server-side AWS SDK access.

### Architecture

- **API Gateway HTTP API** with a JWT authorizer pointing at the Cognito User Pool
- **Lambda function** with IAM permissions for `cognito-idp:AdminDeleteUser` and `cognito-idp:AdminGetUser`
- The Lambda validates that the caller (from JWT claims) is an `owner` of the same family as the target user before performing the deletion
- Client calls the API via `src/services/api/adminApi.ts`, passing the Cognito ID token as a Bearer token

### Security

- JWT authorizer ensures only authenticated Cognito users can call the API
- Lambda checks `custom:familyRole === 'owner'` before allowing deletion
- Lambda checks `custom:familyId` matches between caller and target (cross-family deletion blocked)
- If the target user doesn't exist in Cognito, the operation succeeds silently (idempotent)
- CORS restricted to `https://beanies.family` and `http://localhost:5173`

### Infrastructure

- Terraform module: `infrastructure/modules/api/`
- Lambda source: `infrastructure/modules/api/lambda/delete-user.mjs`
- Environment variable: `VITE_API_ENDPOINT` provides the API URL to the frontend

## Consequences

### Positive

- Owners can fully remove family members (both local data and Cognito identity)
- Minimal infrastructure footprint (single Lambda, no always-on servers)
- JWT authorizer reuses existing Cognito pool (no additional auth system)
- Extensible — future admin operations can be added as new Lambda routes

### Negative

- First server-side component — adds operational complexity (Lambda logs, API Gateway monitoring)
- Requires `terraform apply` to deploy (not purely client-side anymore)
- Lambda cold starts may add ~1s latency on first invocation
