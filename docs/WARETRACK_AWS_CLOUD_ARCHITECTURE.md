# WareTrack3D: Production AWS Cloud Architecture Blueprint (Zero-CloudFront)

---

## 1. Official Architecture Diagram (Without CloudFront)

This architecture reflects the **live, verified AWS deployment** in `ap-south-1` (Mumbai). All traffic routes directly to the Nginx reverse proxy on the EC2 Elastic IP, bypassing CloudFront edge distribution for maximum 3D rendering speed and real-time SSE stream stability.

```mermaid
flowchart TD
    %% Styling Classes
    classDef client fill:#3b82f6,stroke:#1d4ed8,stroke-width:2px,color:#fff;
    classDef compute fill:#f97316,stroke:#c2410c,stroke-width:2px,color:#fff;
    classDef database fill:#3b82f6,stroke:#1e40af,stroke-width:2px,color:#fff;
    classDef storage fill:#10b981,stroke:#047857,stroke-width:2px,color:#fff;
    classDef serverless fill:#8b5cf6,stroke:#6d28d9,stroke-width:2px,color:#fff;
    classDef messaging fill:#ec4899,stroke:#be185d,stroke-width:2px,color:#fff;
    classDef monitor fill:#eab308,stroke:#a16207,stroke-width:2px,color:#fff;
    classDef external fill:#64748b,stroke:#334155,stroke-width:2px,color:#fff;

    subgraph Tier0 ["🌐 Users & Logistics Field Tier"]
        Browser["🖥️ Web Browser / Three.js 3D Digital Twin<br>Warehouse Managers & Dispatch Admins"]:::client
        Scanner["📱 Barcode & Mobile Scanners<br>Ground Logistics & Forklift Drivers"]:::client
    end

    subgraph AWSCloud ["☁️ AWS Cloud Infrastructure (Region: ap-south-1 Mumbai)"]
        
        subgraph WebCompute ["Compute & Web Ingress Tier (Direct Access - No CloudFront)"]
            EIP["🌐 Elastic IP: 13.205.235.73<br>(Port 80 / HTTP & WebSockets)"]:::compute
            EC2["🖥️ Amazon EC2 Instance (t3.micro / Ubuntu 24.04)<br>• Nginx High-Performance Reverse Proxy<br>• Node.js Backend Server (PM2 Process Daemon)<br>• Three.js Dynamic Scene Sync Engine"]:::compute
            EIP --> EC2
        end

        subgraph Persistence ["Managed Persistence Tier"]
            RDS[("🗄️ Amazon RDS PostgreSQL (v16)<br>Endpoint: waretrack3d-db.cdegiemkurxk...:5432<br>• Master Inventory, SKUs & Pallet Locations<br>• Employee Auth & Enterprise RBAC<br>• Automated Daily Backups")]:::database
            S3["🪣 Amazon S3 Bucket<br>waretrack3d-storage-bucket<br>• Pallet Barcodes & Shipping Slips<br>• 3D GLTF Forklift & Warehouse Assets<br>• Dual Backup SQL Snapshots"]:::storage
        end

        subgraph EventDriven ["Serverless & Decoupled Messaging Tier"]
            SQS["📥 Amazon SQS Queue<br>waretrack3d-order-queue<br>• Asynchronous Order & Dispatch Buffer<br>• Spike Absorber (Zero Data Loss)"]:::messaging
            Lambda["⚡ AWS Lambda Function<br>waretrack3d-stock-monitor (Node.js 20.x)<br>• Automated SQS Queue Worker<br>• Low-Stock & Critical Health Evaluator"]:::serverless
            EventBridge["⏱️ Amazon EventBridge<br>Rule: waretrack3d-daily-stock-check<br>Schedule: rate(1 day)"]:::serverless
            SNS["📢 Amazon SNS Topic<br>Topic: waretrack3d-alerts<br>• Fan-out Broadcast Engine"]:::messaging
        end

        subgraph Observability ["Observability & Governance Tier"]
            CWLogs["📋 CloudWatch Logs<br>Log Group: /waretrack3d/backend<br>• API Request Latency Logs<br>• Real-time Exception & Stack Traces"]:::monitor
            CWDash["📊 CloudWatch Dashboard<br>WareTrack3D-Operations<br>• EC2 CPU & RDS DBConnections<br>• Lambda Invocations & Errors"]:::monitor
            IAM["🔐 AWS IAM Security<br>• waretrack-app User Policy<br>• waretrack3d-lambda-role"]:::monitor
        end

    end

    subgraph AlertReceivers ["🚨 Operations Notification"]
        Email["📧 Operations Team Email Inbox<br>Instant Security & Low-Stock Alerts"]:::external
    end

    %% Client Ingress (Direct to EC2 Elastic IP)
    Browser -->|"Direct HTTP/WebSocket Requests"| EIP
    Scanner -->|"REST API Barcode Ingestion"| EIP

    %% EC2 Core Workflows
    EC2 -->|"Live Write-through SQL Sync"| RDS
    EC2 -->|"Media Uploads & Static Assets"| S3
    EC2 -->|"Push Async Operational Logs"| CWLogs
    EC2 -->|"Enqueue Heavy Dispatch Jobs"| SQS
    EC2 -->|"Publish Urgent System Alerts"| SNS

    %% Serverless Queue Worker & Scheduled Triggers
    SQS -->|"Auto-Triggers Worker Batch"| Lambda
    EventBridge -->|"Daily Scheduled Health Check"| Lambda
    Lambda -->|"Publish Alert if Threshold Breached"| SNS
    SNS -->|"Send Email Notification"| Email

    %% Observability Streams
    EC2 -.->|"Stream CPU & RAM Metrics"| CWDash
    RDS -.->|"Stream DatabaseConnections"| CWDash
    Lambda -.->|"Stream Invocations & Errors"| CWDash
```

---

## 2. Key Architecture Principles (Why CloudFront Was Omitted)

1. **Direct Elastic IP + Nginx Ingress:**
   - Instead of routing through CloudFront CDN edge distributions, WareTrack3D utilizes a dedicated AWS Elastic IP (`13.205.235.73`) attached to EC2.
   - **Advantage:** Preserves low-latency Server-Sent Events (SSE) and persistent WebSockets for live 3D worker avatar positioning without CDN timeout interruptions or edge caching issues.
2. **Decoupled Asynchronous Processing (SQS $\rightarrow$ Lambda):**
   - High-throughput warehouse actions (such as dock door arrivals and barcode batch scans) are immediately acknowledged by EC2 and placed on **Amazon SQS**.
   - **AWS Lambda** automatically polls the queue, executes business logic without consuming EC2 CPU, and scales to zero when idle.
3. **Dual Resilience & Failover:**
   - Fast local cache guarantees the Three.js viewport maintains 60 FPS even under heavy load.
   - Master data safely commits to **Amazon RDS PostgreSQL** with automated point-in-time recovery.
4. **Autonomous Serverless Heartbeat (EventBridge $\rightarrow$ Lambda $\rightarrow$ SNS):**
   - Independent of the EC2 instance status, Amazon EventBridge triggers Lambda daily to inspect inventory thresholds and dispatch critical email alerts via Amazon SNS.

---

## 3. Active AWS Resource Inventory

| Service | Resource Name / ID | Configuration Details |
|---|---|---|
| **EC2** | `i-0f9e9ec58e65ea749` | Ubuntu 24.04 LTS, Elastic IP: `13.205.235.73`, Port 80 (Nginx) $\rightarrow$ Port 3000 (Node.js) |
| **RDS** | `waretrack3d-db` | PostgreSQL 16.x, `ap-south-1`, Storage: 20 GB gp3, Auto-minor upgrade enabled |
| **S3** | `waretrack3d-storage-bucket` | Standard storage tier, `ap-south-1`, Block Public Access configured with IAM access |
| **SQS** | `waretrack3d-order-queue` | Standard Queue, Default 30s visibility timeout, 4-day retention, Lambda trigger attached |
| **Lambda**| `waretrack3d-stock-monitor` | Node.js 20.x, x86_64, Role with `AWSLambdaSQSQueueExecutionRole` & `AmazonSNSFullAccess` |
| **EventBridge**| `waretrack3d-daily-stock-check` | Cron schedule: `rate(1 day)` targeting `waretrack3d-stock-monitor` |
| **SNS** | `waretrack3d-alerts` | Standard topic, email endpoint subscription active |
| **CloudWatch**| `/waretrack3d/backend` | Batched asynchronous JSON structured logging, Metrics dashboard for EC2/RDS/Lambda |

---

## 4. How to Present This Architecture in Viva / Interview

When explaining this architecture, walk the examiner through the **3-Tier Flow**:

1. **Tier 1 (Compute & Ingress):**
   > *"Users and ground barcode scanners connect directly to our EC2 instance via an Elastic IP running an Nginx reverse proxy. We intentionally avoided CloudFront to keep WebSocket/SSE streams direct and real-time for our Three.js 60 FPS 3D digital twin."*
2. **Tier 2 (Decoupled Processing):**
   > *"To prevent server bottlenecks during peak loading hours, our backend offloads dispatch tasks into Amazon SQS. AWS Lambda automatically triggers on incoming SQS messages, acting as a serverless queue worker."*
3. **Tier 3 (Persistence & Observability):**
   > *"Master data is committed to Amazon RDS PostgreSQL, static labels and backups are preserved on Amazon S3, and health alerts are published via Amazon SNS. Everything is monitored live in CloudWatch."*
