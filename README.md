# Task Management System

Cloud-native web application to organize tasks and track their progress.
Case study of **Trending Information Technologies** (Unisinos, 2026/2), Grau B.

**Group:** Francieli Wesolowski, Jenifer Dantas, Thais Einsfeld da Rocha

## Features

- User registration and login (each user sees only their own tasks)
- Create, edit, complete and delete tasks, with title, description and due date
- Filters: All / Pending / Completed
- Dashboard: percentage completed, total, pending, completed and overdue tasks
- File attachments per task (stored in Amazon S3)
- Structured logs and custom metrics in Amazon CloudWatch

## Architecture

```
 User browser
     │ HTTPS :443  (https://<elastic-ip>.sslip.io, Let's Encrypt certificate)
     ▼
 Amazon EC2 (public subnet, Elastic IP)
   Apache (HTTPS :443, HTTP :80 redirects) ─► Node.js / Express app (:3000)
     │                 │                    │
     │ MySQL :3306     │ HTTPS (IAM role)   │ logs + metrics
     ▼                 ▼                    ▼
 Amazon RDS        Amazon S3           Amazon CloudWatch
 (private subnet)  (private bucket)    (Logs, Metrics, Alarms)
```

| Service | Role in the application |
|---|---|
| **Amazon EC2** | Runs the web application (Node.js + Express) behind Apache. |
| **Amazon RDS (MySQL)** | Stores users, tasks and attachment metadata. Not publicly accessible. |
| **Amazon S3** | Stores attached files in a private, encrypted bucket. Downloads use pre-signed URLs valid for 5 minutes. |
| **Amazon CloudWatch** | Receives application and Apache logs, memory/disk metrics, custom metrics (`TasksCreated`, `TasksCompleted`, `AttachmentsUploaded`, `ServerErrors`) and alarms. |
| **Elastic IP** | Fixed public address for the EC2 instance, so the HTTPS domain and certificate stay valid after restarts. |
| **IAM (LabRole)** | Lets the EC2 instance use S3 and CloudWatch without access keys in the code. |

## Project structure

```
├── src/
│   ├── server.js            # Entry point: Express setup, routes, error handling
│   ├── config.js            # Reads the environment variables
│   ├── db.js                # MySQL connection pool + automatic schema creation
│   ├── logger.js            # JSON logs (console + file read by CloudWatch agent)
│   ├── middleware/auth.js   # JWT cookie login check
│   ├── routes/auth.js       # Register, login, logout, current user
│   ├── routes/tasks.js      # Tasks CRUD, dashboard stats, attachments
│   └── services/
│       ├── storage.js       # Amazon S3 (or local disk when testing)
│       └── metrics.js       # Custom metrics to Amazon CloudWatch
├── public/                  # Frontend (HTML, CSS, JavaScript)
├── sql/schema.sql           # Database tables
├── infra/
│   ├── user-data.sh         # EC2 bootstrap script (installs and starts everything)
│   └── cloudwatch-agent.json# CloudWatch agent configuration
├── Dockerfile
└── docker-compose.yml       # Local run: app + MySQL
```

## Running locally (no AWS account needed)

Requirement: [Docker Desktop](https://www.docker.com/products/docker-desktop/).

```bash
docker compose up --build
```

Open http://localhost:3000 and create an account.
Locally, MySQL runs in a container in place of RDS, and attachments are saved to disk in place of S3.

To stop: `docker compose down` (add `-v` to also erase the local database).

### Without Docker

Requirements: Node.js 20+ and a MySQL 8 server.

```bash
cp .env.example .env     # then edit the DB_* values
npm install
npm start
```

## Deploying on AWS (AWS Academy Learner Lab)

Use region **us-east-1**. Do the steps in this order.

### 1. Security Groups (VPC > Security Groups)

| Name | Inbound rules |
|---|---|
| `tms-web-sg` | HTTP 80 and HTTPS 443 from `0.0.0.0/0`. SSH 22 **only from your IP** (`My IP`), or no SSH at all if you use Session Manager. |
| `tms-db-sg` | MySQL/Aurora 3306 **only from `tms-web-sg`**. |

### 2. Amazon RDS

- Engine: MySQL 8, template **Free tier**, instance `db.t3.micro`.
- DB instance identifier: `tms-db`. Master username: `admin`, with a strong password.
- Connectivity: **Public access = No**, security group `tms-db-sg`.
- Additional configuration: initial database name `taskdb`.
- After it is created, copy the **endpoint**. The tables are created automatically when the app starts.

### 3. Amazon S3

- Create a bucket, for example `tms-attachments-<group-name>`.
- Keep **Block all public access** turned on and default encryption (SSE-S3) enabled.

### 4. Amazon EC2

1. Push this repository to GitHub.
2. Launch an instance: **Amazon Linux 2023**, `t2.micro` or `t3.micro`, key pair `vockey`, security group `tms-web-sg`.
3. In **Advanced details**:
   - IAM instance profile: **LabInstanceProfile**.
   - User data: paste `infra/user-data.sh` after editing the values at its top (repository URL, RDS endpoint and password, bucket name).
4. After a few minutes, open `http://<EC2 public IP>`. Installation logs are in `/var/log/cloud-init-output.log`.

### 5. HTTPS (Elastic IP + Let's Encrypt)

The AWS Academy Learner Lab does not allow creating Amazon CloudFront distributions
(`cloudfront:CreateDistribution` is denied), so HTTPS is served directly by Apache
with a free [Let's Encrypt](https://letsencrypt.org/) certificate.

1. **EC2 > Elastic IPs > Allocate**, then **Associate** it with the instance.
   The public IP no longer changes when the lab restarts.
2. In `tms-web-sg`, add an inbound rule **HTTPS 443** from `0.0.0.0/0`.
3. Connect to the instance and run:

   ```bash
   curl -fsSL https://raw.githubusercontent.com/ThaisRochaEinsfeld/task-management-system/main/infra/enable-https.sh -o enable-https.sh
   sudo bash enable-https.sh
   ```

   The script creates the domain `<ip-with-dashes>.sslip.io` (for example
   `3-228-214-70.sslip.io`), requests the certificate, configures Apache
   (HTTP → HTTPS redirect) and sets `COOKIE_SECURE=true`.

### 6. Amazon CloudWatch

The logs appear in **CloudWatch > Log groups**:

- `/task-management-system/app`
- `/task-management-system/httpd-access`
- `/task-management-system/httpd-error`

The custom metrics appear under **Metrics > TaskManagementSystem**.

Create an alarm for high CPU on the instance. You can do this in the console, or with this command (AWS CLI or CloudShell):

```bash
aws cloudwatch put-metric-alarm \
  --alarm-name tms-high-cpu \
  --namespace AWS/EC2 --metric-name CPUUtilization \
  --dimensions Name=InstanceId,Value=<INSTANCE_ID> \
  --statistic Average --period 300 --evaluation-periods 2 \
  --threshold 80 --comparison-operator GreaterThanThreshold
```

Useful query in **Logs Insights** (log group `/task-management-system/app`):

```
fields time, level, message, path, status
| filter level = "error" or status >= 500
| sort time desc
```

> **Learner Lab note:** the lab session stops after a few hours and the EC2 instance stops with it. Start the lab again before the presentation. With the Elastic IP the address stays the same. For a quick local demo, use docker compose.

## Security measures (Grau A → Grau B)

These measures answer the risks we identified in the *Misconfiguration & Inadequate Change Control* assignment (T2).

| Risk seen in Grau A | What we did in Grau B |
|---|---|
| SSH 22 open to `0.0.0.0/0` | SSH allowed only from the group's IP (or Session Manager) |
| Plain HTTP | HTTPS with a Let's Encrypt certificate, HTTP redirected to HTTPS, `Secure` cookie |
| Database exposure | RDS in a private subnet that accepts only the web security group |
| Credentials in code | IAM role (LabInstanceProfile) for S3/CloudWatch. `.env` has mode 600 and is never committed |
| Passwords | bcrypt hashes, login rate limit (20 attempts / 15 min), generic error messages |
| Access to other users' data | Every SQL query filters by `user_id`. Parameterized queries prevent SQL injection |
| Public files | Private S3 bucket with encryption at rest and temporary pre-signed download URLs |
| XSS / unsafe headers | `helmet` security headers (CSP), and the frontend uses `textContent` only |
| No visibility / unreviewed changes | CloudWatch logs, metrics and alarms. Infrastructure is described in versioned files (`user-data.sh`, `cloudwatch-agent.json`) |

## API reference

All task routes require login (cookie `token`).

| Method | Route | Description |
|---|---|---|
| POST | `/api/auth/register` | `{ name, email, password }` |
| POST | `/api/auth/login` | `{ email, password }` |
| POST | `/api/auth/logout` | Ends the session |
| GET | `/api/auth/me` | Logged-in user |
| GET | `/api/tasks?status=all\|pending\|completed` | List tasks |
| GET | `/api/tasks/stats` | Dashboard numbers |
| POST | `/api/tasks` | `{ title, description, dueDate }` |
| PUT | `/api/tasks/:id` | Update fields and/or `{ completed }` |
| DELETE | `/api/tasks/:id` | Delete task and its files |
| POST | `/api/tasks/:id/attachments` | Upload (`multipart/form-data`, field `file`, max 5 MB) |
| GET | `/api/tasks/:id/attachments/:attachmentId` | Download |
| DELETE | `/api/tasks/:id/attachments/:attachmentId` | Remove file |
| GET | `/health` | Health check (also tests the database) |
