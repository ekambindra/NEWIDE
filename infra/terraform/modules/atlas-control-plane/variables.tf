variable "name" {
  type        = string
  description = "Prefix for all AWS resources."
}

variable "environment" {
  type        = string
  description = "Environment name (staging or prod)."
}

variable "aws_region" {
  type        = string
  description = "AWS region for all resources."
}

variable "vpc_cidr" {
  type        = string
  description = "CIDR range for VPC."
}

variable "public_subnet_cidrs" {
  type        = list(string)
  description = "Two public subnet CIDRs."
}

variable "container_image" {
  type        = string
  description = "Control-plane container image URI."
}

variable "control_plane_port" {
  type        = number
  description = "Container port for control-plane service."
  default     = 4000
}

variable "desired_count" {
  type        = number
  description = "Desired ECS task count."
  default     = 2
}

variable "db_allocated_storage" {
  type        = number
  description = "RDS allocated storage (GiB)."
  default     = 40
}

variable "db_instance_class" {
  type        = string
  description = "RDS instance class."
  default     = "db.t4g.micro"
}

variable "db_name" {
  type        = string
  description = "Control-plane database name."
  default     = "atlas_control_plane"
}

variable "db_username" {
  type        = string
  description = "Database admin user."
  default     = "atlas_admin"
}

variable "db_password" {
  type        = string
  description = "Database admin password."
  sensitive   = true
}

variable "acm_certificate_arn" {
  type        = string
  description = "ACM certificate ARN for CloudFront viewer certificate."
}

variable "tags" {
  type        = map(string)
  description = "Extra tags for resources."
  default     = {}
}
