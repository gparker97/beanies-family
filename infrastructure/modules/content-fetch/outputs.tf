output "content_fetch_url" {
  description = "Fully-qualified content-fetch endpoint — set as the VITE_CONTENT_FETCH_URL GitHub repo VARIABLE"
  value       = "https://${var.api_domain_name}/content-fetch"
}

# Exported so `ai-extract` can alarm into the SAME topic (#83) rather than creating a second
# one. A second topic means a second email confirmation and a second Slack forwarder for the
# same set of eyes. The cost is a module ordering dependency: `ai_extract` now depends on
# `content_fetch` in the root module.
output "alerts_topic_arn" {
  description = "SNS topic for infrastructure alarms. Shared with other modules so alarms reach one place."
  value       = aws_sns_topic.alerts.arn
}
