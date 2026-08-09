#!/usr/bin/env bash
# =============================================================================
# Provision all Cloudflare resources for THIS fork of the blog starter.
#
#   pnpm provision [name]
#
# [name] is the resource prefix (default: blog-flow). Each fork picks a unique
# name, e.g. `pnpm provision beauty-daily`.
#
# Idempotent-ish: safe to re-run; existing resources are reused.
# Requires: wrangler auth (`npx wrangler login` or CLOUDFLARE_API_TOKEN env)
# and the Workers Paid plan (Browser Rendering + Workflows).
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."

NAME="${1:-blog-flow}"
DB_NAME="${NAME}-db"
BUCKET_NAME="${NAME}-media"
INDEX_NAME="${NAME}-topics"
WORKFLOW_NAME="${NAME}-research"
SITE_WORKER="${NAME}-site"
PIPELINE_WORKER="${NAME}-pipeline"

W="npx wrangler"

echo "==> Checking wrangler auth"
$W whoami >/dev/null || { echo "Not authenticated. Run: npx wrangler login"; exit 1; }

echo "==> D1 database: $DB_NAME"
if ! $W d1 info "$DB_NAME" >/dev/null 2>&1; then
  $W d1 create "$DB_NAME"
fi
DB_ID=$($W d1 info "$DB_NAME" --json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log(j.uuid||j.id||j.database_id)})")
[ -n "$DB_ID" ] || { echo "Could not resolve D1 database id"; exit 1; }
echo "    id: $DB_ID"

echo "==> R2 bucket: $BUCKET_NAME"
$W r2 bucket create "$BUCKET_NAME" 2>/dev/null || echo "    (exists)"

echo "==> Vectorize index: $INDEX_NAME (768 dims, cosine — matches bge-base-en-v1.5)"
$W vectorize create "$INDEX_NAME" --dimensions=768 --metric=cosine 2>/dev/null || echo "    (exists)"

echo "==> Writing resource names/ids into wrangler configs"
for CFG in apps/site/wrangler.jsonc apps/pipeline/wrangler.jsonc; do
  node - "$CFG" "$NAME" "$DB_NAME" "$DB_ID" "$BUCKET_NAME" "$INDEX_NAME" "$WORKFLOW_NAME" <<'EOF'
const fs = require("fs");
const [,, cfg, name, dbName, dbId, bucket, index, workflow] = process.argv;
let s = fs.readFileSync(cfg, "utf8");
s = s
  .replace(/replace-db-name/g, dbName)
  .replace(/REPLACE_DB_ID/g, dbId)
  .replace(/replace-r2-bucket/g, bucket)
  .replace(/replace-vectorize-index/g, index)
  .replace(/replace-workflow-name/g, workflow)
  .replace(/"name": "blog-flow-(site|pipeline)"/, (m, kind) => `"name": "${name}-${kind}"`);
fs.writeFileSync(cfg, s);
console.log("    updated", cfg);
EOF
done

echo "==> Applying D1 migrations (remote)"
$W d1 migrations apply BLOG_DB --remote --config apps/pipeline/wrangler.jsonc

echo "==> Secrets"
echo "    ADMIN_TOKEN protects the /admin review UI."
if [ -t 0 ]; then
  $W secret put ADMIN_TOKEN --config apps/pipeline/wrangler.jsonc
  read -r -p "    Set BRAVE_API_KEY for web-search discovery? [y/N] " yn
  if [ "${yn:-n}" = "y" ]; then
    $W secret put BRAVE_API_KEY --config apps/pipeline/wrangler.jsonc
  fi
else
  echo "    (non-interactive shell: set secrets manually, see SETUP.md)"
fi

echo "==> Deploying"
pnpm --filter site deploy
pnpm --filter pipeline deploy

echo ""
echo "=============================================================="
echo " Done. Next steps:"
echo "  1. Open https://${PIPELINE_WORKER}.<your-subdomain>.workers.dev/admin"
echo "     and connect with your ADMIN_TOKEN."
echo "  2. Click 'Run pipeline now' to produce your first draft."
echo "  3. Update siteUrl in blog.config.ts to the site worker URL"
echo "     (or your custom domain) and redeploy: pnpm deploy"
echo "  4. Submit /sitemap.xml in Google Search Console."
echo "=============================================================="
