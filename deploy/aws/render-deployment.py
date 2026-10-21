"""Writes the Lightsail deployment files (containers.json, endpoint.json) from env variables.

Run by .github/workflows/deploy-aws.yml. Both containers use the same image and share
localhost: the API listens on 127.0.0.1:4000 and only the web container is public.
"""

import json
import os
import sys
from urllib.parse import quote

env = os.environ
image = sys.argv[1]
out = sys.argv[2] if len(sys.argv) > 2 else "."

# The password may contain URL-special characters, so build the URL with encoding.
database_url = "postgres://{user}:{password}@{host}:5432/{name}".format(
    user=quote(env["DB_USER"], safe=""),
    password=quote(env["DB_PASSWORD"], safe=""),
    host=env["DB_ENDPOINT"],
    name=quote(env["DB_NAME"], safe=""),
)

common = {
    "NODE_ENV": "production",
    "DEPLOY_ENV": env.get("DEPLOY_ENV", "staging"),
    "DATABASE_URL": database_url,
    # Verify the database's TLS certificate against Amazon's bundle shipped in the image.
    "DATABASE_SSL_CA": "/etc/ssl/rds/global-bundle.pem",
    "AUTH_SECRET": env["AUTH_SECRET"],
    "OTP_SENDER": "console",
    "API_HOST": "127.0.0.1",
    "API_PORT": "4000",
    "API_URL": "http://127.0.0.1:4000",
}
if env.get("BOOTSTRAP_ADMIN_PHONES"):
    common["BOOTSTRAP_ADMIN_PHONES"] = env["BOOTSTRAP_ADMIN_PHONES"]

containers = {
    "api": {
        "image": image,
        "command": ["sh", "deploy/container/start-api.sh"],
        "environment": common,
    },
    "web": {
        "image": image,
        "command": ["sh", "deploy/container/start-web.sh"],
        "environment": {**common, "PORT": "3000"},
        "ports": {"3000": "HTTP"},
    },
}
endpoint = {
    "containerName": "web",
    "containerPort": 3000,
    "healthCheck": {
        "path": "/",
        "successCodes": "200-399",
        "intervalSeconds": 10,
        "timeoutSeconds": 5,
        "healthyThreshold": 2,
        "unhealthyThreshold": 5,
    },
}
with open(os.path.join(out, "containers.json"), "w") as f:
    json.dump(containers, f)
with open(os.path.join(out, "endpoint.json"), "w") as f:
    json.dump(endpoint, f)
print("Wrote containers.json and endpoint.json for", image)
