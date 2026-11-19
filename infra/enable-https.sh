#!/bin/bash
# ---------------------------------------------------------------
# Enables HTTPS on the EC2 instance with a free Let's Encrypt
# certificate (used because the AWS Academy Learner Lab does not
# allow creating Amazon CloudFront distributions).
# ---------------------------------------------------------------
# How it works:
#   1. Builds a public domain name from the instance's public IP
#      using sslip.io (e.g. 3.85.10.20 -> 3-85-10-20.sslip.io),
#      so no domain needs to be bought.
#   2. Requests a certificate for that name from Let's Encrypt.
#   3. Configures Apache to serve the app on HTTPS (port 443) and
#      redirect every HTTP request (port 80) to HTTPS.
#   4. Marks the login cookie as "Secure" (only sent over HTTPS).
#
# Requirements:
#   - an Elastic IP associated with the instance (so the address
#     and therefore the domain do not change after a restart);
#   - Security Group with ports 80 and 443 open to the internet.
#
# Run on the instance:  sudo bash enable-https.sh
# ---------------------------------------------------------------
set -euo pipefail

APP_DIR=/opt/task-management-system

# --- 1. Public IP (from the EC2 metadata service, IMDSv2) and domain ---
TOKEN=$(curl -sS -X PUT "http://169.254.169.254/latest/api/token" \
  -H "X-aws-ec2-metadata-token-ttl-seconds: 300")
PUBLIC_IP=$(curl -sS -H "X-aws-ec2-metadata-token: $TOKEN" \
  http://169.254.169.254/latest/meta-data/public-ipv4)
DOMAIN="${PUBLIC_IP//./-}.sslip.io"
echo ">> Public IP: $PUBLIC_IP"
echo ">> Domain:    $DOMAIN"

# --- 2. Install mod_ssl and certbot (certbot in a Python virtualenv,
#        the method recommended by the certbot project for this OS) ---
dnf install -y mod_ssl python3 augeas-libs
if [ ! -x /opt/certbot/bin/certbot ]; then
  python3 -m venv /opt/certbot
  /opt/certbot/bin/pip install --quiet --upgrade pip
  /opt/certbot/bin/pip install --quiet certbot
fi

# --- 3. Request the certificate ---
# "standalone" mode: certbot answers the Let's Encrypt challenge on
# port 80 itself, so Apache is stopped for a few seconds.
/opt/certbot/bin/certbot certonly --standalone \
  --non-interactive --agree-tos --register-unsafely-without-email \
  --pre-hook "systemctl stop httpd" --post-hook "systemctl start httpd" \
  -d "$DOMAIN"

# --- 4. Apache configuration: HTTP -> HTTPS redirect + HTTPS proxy ---
cat > /etc/httpd/conf.d/task-management-system.conf <<EOF
# Hide the Apache version in responses and error pages.
ServerTokens Prod
ServerSignature Off

# Port 80: send every request to the HTTPS address.
<VirtualHost *:80>
    ServerName $DOMAIN
    Redirect permanent / https://$DOMAIN/
</VirtualHost>

# Port 443: HTTPS with the Let's Encrypt certificate, forwarding the
# requests to the Node.js app running on port 3000.
<VirtualHost *:443>
    ServerName $DOMAIN
    SSLEngine on
    SSLCertificateFile    /etc/letsencrypt/live/$DOMAIN/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/$DOMAIN/privkey.pem

    # Tell browsers to always use HTTPS for this site (1 year).
    Header always set Strict-Transport-Security "max-age=31536000"

    ProxyPreserveHost On
    RequestHeader set X-Forwarded-Proto "https"
    ProxyPass        / http://127.0.0.1:3000/
    ProxyPassReverse / http://127.0.0.1:3000/
</VirtualHost>
EOF

# --- 5. Login cookie only over HTTPS ---
sed -i 's|^COOKIE_SECURE=.*|COOKIE_SECURE=true|' "$APP_DIR/.env"

# --- 6. Apply ---
apachectl configtest
systemctl restart httpd
systemctl restart task-management-system

echo
echo ">> HTTPS enabled: https://$DOMAIN"
