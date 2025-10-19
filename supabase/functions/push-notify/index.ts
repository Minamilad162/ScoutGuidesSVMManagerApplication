/// <reference lib="dom" />


// CORS headers
const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-webhook-secret, content-type",
  "access-control-allow-methods": "POST, OPTIONS"
} as const;
