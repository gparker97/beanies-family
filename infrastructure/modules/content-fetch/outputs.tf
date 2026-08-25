output "content_fetch_url" {
  description = "Fully-qualified content-fetch endpoint — set as the VITE_CONTENT_FETCH_URL GitHub repo VARIABLE"
  value       = "https://${var.api_domain_name}/content-fetch"
}
