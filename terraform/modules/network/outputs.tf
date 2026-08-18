output "vpc_id" {
  description = "ID of the VPC."
  value       = aws_vpc.this.id
}

output "vpc_cidr" {
  description = "CIDR block of the VPC. Needed by peers and by provider allow-lists."
  value       = aws_vpc.this.cidr_block
}

output "availability_zones" {
  description = "AZs this network spans, in the order the subnet lists use."
  value       = local.azs
}

output "public_subnet_ids" {
  description = "Public subnets — load balancers and NAT gateways only."
  value       = aws_subnet.public[*].id
}

output "private_subnet_ids" {
  description = "Private subnets — ECS tasks."
  value       = aws_subnet.private[*].id
}

output "data_subnet_ids" {
  description = "Data subnets — RDS and ElastiCache. No route to the internet."
  value       = aws_subnet.data[*].id
}

output "alb_security_group_id" {
  description = "Security group for public load balancers."
  value       = aws_security_group.alb.id
}

output "app_security_group_id" {
  description = "Security group for ECS tasks. Attach to every service."
  value       = aws_security_group.app.id
}

output "database_security_group_id" {
  description = "Security group for RDS. Ingress from the app tier and the bastion only."
  value       = aws_security_group.database.id
}

output "cache_security_group_id" {
  description = "Security group for ElastiCache."
  value       = aws_security_group.cache.id
}

output "bastion_security_group_id" {
  description = "Security group for the SSM bastion used by migrations and restores."
  value       = aws_security_group.bastion.id
}

output "nat_gateway_public_ips" {
  description = "Egress IPs. Give these to any third-party provider that allow-lists by source IP (payment gateway, SMS provider)."
  value       = aws_eip.nat[*].public_ip
}

output "s3_vpc_endpoint_id" {
  description = "Gateway endpoint keeping S3 traffic off the NAT gateway."
  value       = aws_vpc_endpoint.s3.id
}
