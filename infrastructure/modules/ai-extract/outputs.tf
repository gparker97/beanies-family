output "extract_url" {
  description = "Fully-qualified extraction endpoint — set as the VITE_AI_EXTRACT_URL GitHub repo VARIABLE"
  value       = "https://${var.api_domain_name}/ai-extract"
}
