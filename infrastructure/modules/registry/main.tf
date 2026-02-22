resource "aws_dynamodb_table" "registry" {
  name = var.table_name
  billing_mode = "PAY_PER_REQUEST"
  hash_key = "familyId"

  attribute {
    name = "familyId"
    type = "S"
  }

  tags = {
    Name = "family-registry"
  }
}