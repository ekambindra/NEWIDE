terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.40"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

module "atlas_control_plane" {
  source = "../../modules/atlas-control-plane"

  name                 = "atlas-meridian"
  environment          = "staging"
  aws_region           = var.aws_region
  vpc_cidr             = "10.42.0.0/16"
  public_subnet_cidrs  = ["10.42.1.0/24", "10.42.2.0/24"]
  container_image      = var.container_image
  control_plane_port   = 4000
  desired_count        = 2
  db_allocated_storage = 40
  db_instance_class    = "db.t4g.micro"
  db_name              = "atlas_control_plane"
  db_username          = "atlas_admin"
  db_password          = var.db_password
  acm_certificate_arn  = var.acm_certificate_arn
  tags = {
    CostCenter = "engineering"
    Tier       = "staging"
  }
}
