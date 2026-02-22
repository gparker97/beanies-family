# ── Cognito User Pool ────────────────────────────────────────────────────────

resource "aws_cognito_user_pool" "main" {
  name = "${var.app_name}-${var.environment}"

  # Sign-in with email
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]

  # Username is case-insensitive
  username_configuration {
    case_sensitive = false
  }

  # Password policy
  password_policy {
    minimum_length                   = 8
    require_lowercase                = true
    require_numbers                  = true
    require_symbols                  = false
    require_uppercase                = true
    temporary_password_validity_days = 7
  }

  # Email verification — code-based (user enters 6-digit code in the app)
  verification_message_template {
    default_email_option = "CONFIRM_WITH_CODE"
    email_subject        = "beanies.family — Verify your email"
    email_message        = <<-HTML
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background-color:#F8F9FA;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#F8F9FA;padding:32px 16px;">
<tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
<tr><td style="background-color:#2C3E50;padding:28px 32px;text-align:center;">
<img src="https://beanies.family/brand/beanies_celebrating_line_transparent_600x600.png" alt="beanies" width="120" style="display:block;margin:0 auto 12px;" />
<span style="font-size:28px;font-weight:700;color:#ffffff;letter-spacing:-0.5px;">beanies</span><span style="font-size:28px;font-weight:700;color:#F15D22;letter-spacing:-0.5px;">.family</span>
</td></tr>
<tr><td style="padding:32px;">
<h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#2C3E50;">Welcome to the family!</h1>
<p style="margin:0 0 24px;font-size:15px;color:#5a6a7a;line-height:1.5;">You are one step away from getting started. Enter the code below to verify your email address.</p>
<div style="text-align:center;margin:0 0 24px;">
<span style="display:inline-block;font-size:32px;font-weight:700;letter-spacing:8px;color:#2C3E50;background-color:#F8F9FA;border-radius:12px;padding:16px 28px;">{####}</span>
</div>
<p style="margin:0;font-size:13px;color:#8899aa;line-height:1.5;text-align:center;">This code expires in 24 hours.</p>
</td></tr>
<tr><td style="padding:20px 32px;border-top:1px solid #f0f0f0;text-align:center;">
<p style="margin:0;font-size:12px;color:#aabbcc;font-style:italic;">every bean counts</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>
    HTML
  }

  # Schema attributes
  schema {
    name                = "email"
    attribute_data_type = "String"
    required            = true
    mutable             = true

    string_attribute_constraints {
      min_length = 1
      max_length = 256
    }
  }

  schema {
    name                = "name"
    attribute_data_type = "String"
    required            = true
    mutable             = true

    string_attribute_constraints {
      min_length = 1
      max_length = 256
    }
  }

  # Custom attributes for app integration
  schema {
    name                     = "familyId"
    attribute_data_type      = "String"
    developer_only_attribute = false
    required                 = false
    mutable                  = true

    string_attribute_constraints {
      min_length = 0
      max_length = 256
    }
  }

  schema {
    name                     = "familyRole"
    attribute_data_type      = "String"
    developer_only_attribute = false
    required                 = false
    mutable                  = true

    string_attribute_constraints {
      min_length = 0
      max_length = 256
    }
  }

  # Account recovery via email
  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  # Use Cognito default email (no SES needed for MVP)
  email_configuration {
    email_sending_account = "COGNITO_DEFAULT"
  }
}

# ── Cognito Domain (kept for potential hosted UI use) ──────────────────────

resource "aws_cognito_user_pool_domain" "main" {
  domain       = var.app_name
  user_pool_id = aws_cognito_user_pool.main.id
}

# ── App Client (SPA — no client secret) ─────────────────────────────────────

resource "aws_cognito_user_pool_client" "web" {
  name         = "${var.app_name}-web-${var.environment}"
  user_pool_id = aws_cognito_user_pool.main.id

  # SPA — no client secret
  generate_secret = false

  # Auth flows
  explicit_auth_flows = [
    "ALLOW_USER_SRP_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH",
    "ALLOW_USER_PASSWORD_AUTH",
    "ALLOW_CUSTOM_AUTH",
  ]

  # Token validity
  access_token_validity  = 1   # 1 hour
  id_token_validity      = 1   # 1 hour
  refresh_token_validity = 30  # 30 days

  token_validity_units {
    access_token  = "hours"
    id_token      = "hours"
    refresh_token = "days"
  }

  # Prevent user existence errors (security)
  prevent_user_existence_errors = "ENABLED"

  # Read/write attributes
  read_attributes  = ["email", "name", "email_verified", "custom:familyId", "custom:familyRole"]
  write_attributes = ["email", "name", "custom:familyId", "custom:familyRole"]
}
