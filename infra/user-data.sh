#!/bin/bash
# ---------------------------------------------------------------
# EC2 user-data script (Amazon Linux 2023)
# ---------------------------------------------------------------
# Paste this script in "Advanced details > User data" when launching
# the EC2 instance. On first boot it:
#   1. installs Node.js, Git, Apache (httpd) and the CloudWatch agent;
#   2. downloads the application code from the Git repository;
#   3. writes the .env file with the RDS and S3 settings;
#   4. runs the app as a systemd service (restarts automatically);
#   5. configures Apache as a reverse proxy: port 80 -> app on 3000;
#   6. starts the CloudWatch agent (logs + memory/disk metrics).
#
# The instance must use the IAM instance profile "LabInstanceProfile"
# so the app can access S3 and CloudWatch without access keys.
#
# Logs of this script: /var/log/cloud-init-output.log
# ---------------------------------------------------------------
set -euxo pipefail

# ====== EDIT THESE VALUES BEFORE LAUNCHING ======================
REPO_URL="https://github.com/ThaisRochaEinsfeld/task-management-system.git"
DB_HOST="your-rds-endpoint.xxxxxxxx.us-east-1.rds.amazonaws.com"
DB_USER="admin"
DB_PASSWORD="CHANGE-ME"
DB_NAME="taskdb"
S3_BUCKET="task-management-system-attachments-CHANGE-ME"
AWS_REGION="us-east-1"
COOKIE_SECURE="false"  # enable-https.sh switches it to true after HTTPS is set up
# ================================================================

APP_DIR=/opt/task-management-system

# 1. Packages
dnf install -y nodejs20 nodejs20-npm git httpd amazon-cloudwatch-agent
# Find the Node.js 20 binaries (they may be installed as node-20 / npm-20).
NODE_BIN=$(command -v node || command -v node-20)
NPM_BIN=$(command -v npm || command -v npm-20)

# 2. Application code
git clone "$REPO_URL" "$APP_DIR"
cd "$APP_DIR"
"$NPM_BIN" ci --omit=dev

# 3. Configuration (.env readable only by the app user)
JWT_SECRET=$(openssl rand -hex 32)
cat > "$APP_DIR/.env" <<EOF
PORT=3000
JWT_SECRET=$JWT_SECRET
COOKIE_SECURE=$COOKIE_SECURE
DB_HOST=$DB_HOST
DB_PORT=3306
DB_USER=$DB_USER
DB_PASSWORD=$DB_PASSWORD
DB_NAME=$DB_NAME
AWS_REGION=$AWS_REGION
S3_BUCKET=$S3_BUCKET
CLOUDWATCH_METRICS=true
CLOUDWATCH_NAMESPACE=TaskManagementSystem
LOG_FILE=$APP_DIR/logs/app.log
EOF

useradd --system --home "$APP_DIR" taskapp || true
mkdir -p "$APP_DIR/logs"
chown -R taskapp:taskapp "$APP_DIR"
chmod 600 "$APP_DIR/.env"

# 4. systemd service: starts on boot and restarts if it crashes
cat > /etc/systemd/system/task-management-system.service <<EOF
[Unit]
Description=Task Management System (Node.js)
After=network-online.target
Wants=network-online.target

[Service]
User=taskapp
WorkingDirectory=$APP_DIR
ExecStart=$NODE_BIN src/server.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now task-management-system

# 5. Apache as reverse proxy (same Apache used in the Grau A demo)
cat > /etc/httpd/conf.d/task-management-system.conf <<'EOF'
# Forward every request on port 80 to the Node.js app on port 3000.
ProxyPreserveHost On
ProxyPass        / http://127.0.0.1:3000/
ProxyPassReverse / http://127.0.0.1:3000/
# Hide the Apache version in responses and error pages.
ServerTokens Prod
ServerSignature Off
EOF
systemctl enable --now httpd

# 6. CloudWatch agent with the configuration stored in the repository
/opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
  -a fetch-config -m ec2 -s \
  -c "file:$APP_DIR/infra/cloudwatch-agent.json"
