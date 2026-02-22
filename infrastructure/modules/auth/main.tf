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

  # Email verification — link-based (no code input in the app)
  verification_message_template {
    default_email_option  = "CONFIRM_WITH_LINK"
    email_subject         = "beanies.family — Verify your email"
    email_message_by_link = "Welcome to beanies.family! Click {##here##} to verify your email address."
    email_subject_by_link = "beanies.family — Verify your email"
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
  read_attributes  = ["email", "name", "email_verified"]
  write_attributes = ["email", "name"]
}
