output "table_arn" {
  description = "ARN of the DynamoDB registry table"
  value = aws_dynamodb_table.registry.arn
}