# OnlyOffice Configuration Changes - Remote Pod Sync Guide

## Background

OnlyOffice Document Server blocks HTTP requests to private IP addresses by default (SSRF protection). In our setup, `host.docker.internal` resolves to a private IP inside Docker/Kubernetes, causing **"Download failed"** errors when OnlyOffice tries to fetch documents from the OpenWork server.

## Changes Required

### 1. Allow Private IP Address Access

OnlyOffice needs two settings changed in its configuration:

```
allowPrivateIPAddress: true    (default: false)
allowMetaIPAddress: true       (default: false)
```

### 2. How to Apply

#### Option A: Environment Variables (Docker Compose / Pod env)

Add these environment variables to the OnlyOffice container:

```yaml
environment:
  - ALLOW_PRIVATE_IP_ADDRESS=true
  - ALLOW_META_IP_ADDRESS=true
```

The OnlyOffice entrypoint script (`/app/ds/run-document-server.sh`) reads these and writes them to `/etc/onlyoffice/documentserver/local.json` on startup.

**Important:** The container must be **restarted** after adding the env vars (not just reloaded).

#### Option B: Direct Config Edit (if env vars don't work in your pod setup)

Edit or create `/etc/onlyoffice/documentserver/local.json` inside the OnlyOffice container:

```json
{
  "services": {
    "CoAuthoring": {
      "request-filtering-agent": {
        "allowPrivateIPAddress": true,
        "allowMetaIPAddress": true
      }
    }
  }
}
```

Then restart the OnlyOffice services inside the container:

```bash
supervisorctl restart all
```

#### Option C: Kubernetes Pod Spec

If running as a Kubernetes deployment, add to the container spec:

```yaml
spec:
  containers:
    - name: onlyoffice
      image: onlyoffice/documentserver:latest
      env:
        - name: ALLOW_PRIVATE_IP_ADDRESS
          value: "true"
        - name: ALLOW_META_IP_ADDRESS
          value: "true"
        # existing env vars...
        - name: JWT_ENABLED
          value: "false"
```

### 3. Verification

After applying the changes, verify by checking the config inside the container:

```bash
# Check the local.json was updated
docker exec <container> cat /etc/onlyoffice/documentserver/local.json

# Expected output should include:
# "allowPrivateIPAddress": true
# "allowMetaIPAddress": true
```

You can also check the OnlyOffice logs for download errors:

```bash
docker logs <container> 2>&1 | grep -i "error.*download"
```

If the fix is working, you should **NOT** see errors like:
```
Error: DNS lookup 192.168.x.x(family:4, host:host.docker.internal) is not allowed. Because, It is private IP address.
```

### 4. What Each Setting Does

| Setting | Purpose |
|---------|---------|
| `ALLOW_PRIVATE_IP_ADDRESS` | Allows OnlyOffice to make HTTP requests to RFC 1918 private IPs (10.x.x.x, 172.16-31.x.x, 192.168.x.x) |
| `ALLOW_META_IP_ADDRESS` | Allows OnlyOffice to make HTTP requests to link-local (169.254.x.x) and loopback (127.x.x.x) addresses |

Both are needed because `host.docker.internal` typically resolves to a private IP, and in some Kubernetes setups the OpenWork server may be on a cluster-internal IP.

### 5. Security Note

These settings disable OnlyOffice's SSRF protection for private networks. This is acceptable for:
- Local development
- Internal/trusted network deployments
- Pod-to-pod communication within a Kubernetes cluster

If your OnlyOffice instance is exposed to the public internet, consider using a non-private hostname for the callback URL instead.
