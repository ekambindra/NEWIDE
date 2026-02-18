variable "aws_region" {
  type        = string
  description = "AWS region for production deployment."
  default     = "us-east-1"
}

variable "container_image" {
  type        = string
  description = "ECR image URI for control-plane service."
}

variable "db_password" {
  type        = string
  description = "Postgres password for production metadata DB."
  sensitive   = true
}

variable "acm_certificate_arn" {
  type        = string
  description = "ACM certificate ARN for CloudFront."
}
