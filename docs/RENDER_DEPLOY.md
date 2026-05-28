# Render deployment - MFDS Regulatory PWA V1

This is a Node/React/Vite + Express app for Render Web Service.

Render settings:
- Language: Node
- Root Directory: leave blank
- Build Command: bash render-build.sh
- Start Command: node server/src/index.js
- Health Check Path: /api/health

Environment variables:
- NODE_VERSION=20.11.1
- SUPABASE_URL=https://xxxxxxxxxxxxxxxxxxxx.supabase.co
- SUPABASE_SERVICE_KEY=Supabase service_role key
- AUTO_COLLECT_ON_LOAD=false
- ALLOW_LOCAL_POSTGRES=false

Do not add Python/Streamlit files such as app.py, requirements.txt, runtime.txt, pages/, or .streamlit/.
