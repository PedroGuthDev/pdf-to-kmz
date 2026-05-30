# Quick Task 260530-day: API DXF + Vercel Blob

## Goal

Hospedar regiões DXF na nuvem (Vercel Blob) com API serverless, mantendo cache IndexedDB local como fallback.

## Tasks

1. **API + Blob store** — `lib/dxf-cloud-store.js`, `api/dxf/regions.js` (GET/POST/DELETE)
2. **Cliente híbrido** — `dxf-cloud-client.js`, `region-library-hybrid.js`, sync no upload
3. **UI + deploy** — status nuvem, chave API opcional, `vercel.json`, `.env.example`

## Deploy

1. Vercel → Storage → Blob (liga ao projeto)
2. Opcional: `DXF_API_SECRET` para proteger uploads
3. `vercel deploy` — `BLOB_READ_WRITE_TOKEN` injetado automaticamente
