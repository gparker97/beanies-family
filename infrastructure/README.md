# beanies.family Infrastructure

Terraform configuration for deploying beanies.family to AWS.

## Architecture

- **S3** — Static site hosting (private, CloudFront OAC)
- **CloudFront** — CDN with HTTPS, gzip/brotli, SPA routing
- **ACM** — SSL certificate for beanies.family (us-east-1)
- **Route53** — DNS records (A/AAAA alias to CloudFront)
- **Cognito** — User authentication (email/password)

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
- `cognito_user_pool_id` — For frontend auth config
- `cognito_client_id` — For frontend auth config

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
