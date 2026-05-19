# ── STEP 1: RUN THE BACKEND API SERVER ───────────────────────────
# Open a brand new PowerShell window, copy/paste these commands, and press Enter:
$env:PORT="5000"
$env:DATABASE_URL="postgresql://neondb_owner:npg_c0bagr1KFMVp@ep-withered-leaf-apmjkwjz-pooler.c-7.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require"
$env:SESSION_SECRET="secure-chat-secret-key"
pnpm --filter @workspace/api-server run dev


# ── STEP 2: RUN THE FRONTEND VITE CLIENT ─────────────────────────
# Open a second PowerShell window, copy/paste this command, and press Enter:
pnpm --filter @workspace/chat run dev
