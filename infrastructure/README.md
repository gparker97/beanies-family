# beanies.family Infrastructure

Terraform configuration for deploying beanies.family to AWS — both the static-site frontend and the supporting Lambdas (OAuth proxy + family registry).

## Self-hosting reference

Self-hosters following Path B of [docs/SELF_HOSTING.md](../docs/SELF_HOSTING.md) deploy their own copies of the Lambdas in this directory. Step-by-step deploy guides:

- **[lambda/oauth/README.md](./lambda/oauth/README.md)** — OAuth proxy Lambda (required for Drive sign-in on self-host). Holds your Google `client_secret` server-side and proxies token exchange + refresh to Google.
- **[lambda/oauth/SPEC.md](./lambda/oauth/SPEC.md)** — Runtime-agnostic API contract. Implement on Cloudflare Workers, Vercel Edge, or any Node host instead of AWS if you prefer.
- **[lambda/registry/README.md](./lambda/registry/README.md)** — Optional registry Lambda + DynamoDB. Smooths the magic-link join flow; skip it and joiners use Drive Picker manually.

The cloud build (`app.beanies.family`) uses these same Lambdas via the Terraform setup below.

## Architecture

- **S3** — Static site hosting (private, CloudFront OAC)
- **CloudFront** — CDN with HTTPS, gzip/brotli, SPA routing
- **ACM** — SSL certificate for beanies.family (us-east-1)
- **Route53** — DNS records (A/AAAA alias to CloudFront)

## Prerequisites

- AWS CLI configured with appropriate permissions
- Terraform >= 1.5
- Domain registered in Route53

## Setup

```bash
cd infrastructure

# Initialize Terraform (downloads providers, connects to state backend)
terraform init

# Review planned changes
terraform plan -var-file=environments/prod.tfvars

# Apply changes
terraform apply -var-file=environments/prod.tfvars
```

## State Management

Terraform state is stored in S3 with DynamoDB locking:

- **Bucket:** `beanies-family-terraform-state`
- **Lock table:** `beanies-family-terraform-lock`
- **Region:** ap-southeast-1

## Outputs

After applying, key outputs:

- `s3_bucket_name` — Upload built frontend here
- `cloudfront_distribution_id` — For cache invalidation

## Deploying Frontend

```bash
# Build the frontend
npm run build

# Upload to S3
aws s3 sync dist/ s3://$(terraform output -raw s3_bucket_name) --delete

# Invalidate CloudFront cache
aws cloudfront create-invalidation \
  --distribution-id $(terraform output -raw cloudfront_distribution_id) \
  --paths "/*"
```
