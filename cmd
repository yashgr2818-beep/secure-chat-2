$env:DATABASE_URL="postgresql://neondb_owner:npg_Eb74RnfGkshN@ep-super-sun-aprktdn4-pooler.c-7.us-east-1.aws.neon.tech/neondb?sslmode=require"
pnpm --filter @workspace/db run push




$env:PORT="5000"
$env:DATABASE_URL="postgresql://neondb_owner:npg_Eb74RnfGkshN@ep-super-sun-aprktdn4-pooler.c-7.us-east-1.aws.neon.tech/neondb?sslmode=require"
$env:SESSION_SECRET="secure-chat-secret-key"
pnpm --filter @workspace/api-server run dev










$env:PORT="3000"
$env:BASE_PATH="/"

pnpm --filter @workspace/chat run dev
