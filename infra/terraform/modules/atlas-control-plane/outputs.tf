output "vpc_id" {
  value       = aws_vpc.this.id
  description = "Provisioned VPC ID."
}

output "public_subnet_ids" {
  value       = [for subnet in aws_subnet.public : subnet.id]
  description = "Public subnet IDs used by ALB/ECS."
}

output "ecs_cluster_name" {
  value       = aws_ecs_cluster.this.name
  description = "ECS cluster name."
}

output "ecs_service_name" {
  value       = aws_ecs_service.control_plane.name
  description = "Control-plane ECS service name."
}

output "rds_endpoint" {
  value       = aws_db_instance.control_plane.address
  description = "RDS endpoint for control-plane metadata database."
}

output "artifact_bucket" {
  value       = aws_s3_bucket.artifacts.bucket
  description = "S3 bucket for release and checkpoint artifacts."
}

output "alb_dns_name" {
  value       = aws_lb.control_plane.dns_name
  description = "ALB DNS name."
}

output "cloudfront_domain" {
  value       = aws_cloudfront_distribution.control_plane.domain_name
  description = "CloudFront distribution domain."
}
