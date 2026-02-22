terraform {
  backend "s3" {
    bucket         = "beanies-family-terraform-state"
    key            = "prod/terraform.tfstate"
    region         = "ap-southeast-1"
    dynamodb_table = "beanies-family-terraform-lock"
    encrypt        = true
  }
}
