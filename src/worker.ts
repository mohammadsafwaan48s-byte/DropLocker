/**
 * DropLocker - Cloudflare Worker Backend
 * Serverless REST API with Cloudflare KV & D1 Database (Card-Free $0 Tier)
 */

export interface Env {
  KV: KVNamespace;
  DB: D1Database;
  ASSETS: Fetcher;
  PASSKEY?: string;
}

interface FileRecord {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  pinned: number;
  uploadedAt: string;
  downloadUrl?: string;
}

// Helpers
function jsonResponse(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Passkey',
      ...headers,
    },
  });
}

function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ error: message, status }, status);
}

// Constant-time string comparison to prevent timing attacks
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

// Check authentication via Authorization header, X-Passkey header, query param, or cookie
function isAuthenticated(request: Request, env: Env): boolean {
  const passkey = env.PASSKEY;
  if (!passkey || passkey.trim() === '') {
    return true;
  }

  const authHeader = request.headers.get('Authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7).trim();
    if (timingSafeEqual(token, passkey)) return true;
  }

  const customHeader = request.headers.get('X-Passkey');
  if (customHeader && timingSafeEqual(customHeader.trim(), passkey)) {
    return true;
  }

  const url = new URL(request.url);
  const queryKey = url.searchParams.get('key');
  if (queryKey && timingSafeEqual(queryKey.trim(), passkey)) {
    return true;
  }

  const cookieHeader = request.headers.get('Cookie');
  if (cookieHeader) {
    const cookies = Object.fromEntries(
      cookieHeader.split(';').map((c) => {
        const [k, ...v] = c.trim().split('=');
        return [k, v.join('=')];
      })
    );
    if (cookies.passkey && timingSafeEqual(decodeURIComponent(cookies.passkey), passkey)) {
      return true;
    }
  }

  return false;
}

function sanitizeFilename(name: string): string {
  return name.replace(/["\r\n\\]/g, '_').trim() || 'unnamed-file';
}

function isFormDataFile(entry: unknown): entry is File {
  return (
    typeof entry === 'object' &&
    entry !== null &&
    'name' in entry &&
    'stream' in entry &&
    typeof (entry as any).stream === 'function'
  );
}

function guessMimeType(filename: string, defaultType = 'application/octet-stream'): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  const map: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    pdf: 'application/pdf',
    txt: 'text/plain',
    md: 'text/markdown',
    json: 'application/json',
    csv: 'text/csv',
    zip: 'application/zip',
    rar: 'application/x-rar-compressed',
    '7z': 'application/x-7z-compressed',
    tar: 'application/x-tar',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    webm: 'video/webm',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  };
  return (ext && map[ext]) || defaultType;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Passkey',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    if (path === '/api/health' && request.method === 'GET') {
      return jsonResponse({
        status: 'ok',
        service: 'DropLocker',
        timestamp: new Date().toISOString(),
        authRequired: Boolean(env.PASSKEY && env.PASSKEY.trim() !== ''),
      });
    }

    if (path === '/api/auth-check' && request.method === 'GET') {
      if (isAuthenticated(request, env)) {
        return jsonResponse({ authenticated: true });
      }
      return errorResponse('Invalid passkey', 401);
    }

    // Android Web Share Target
    if (path === '/share' && request.method === 'POST') {
      if (!isAuthenticated(request, env)) {
        return Response.redirect(`${url.origin}/?error=unauthorized`, 303);
      }

      try {
        const formData = await request.formData();
        const uploadedFiles: File[] = [];

        const entries = formData.getAll('file');
        for (const entry of entries) {
          if (isFormDataFile(entry) && entry.size > 0) {
            uploadedFiles.push(entry);
          }
        }

        if (uploadedFiles.length === 0) {
          const title = (formData.get('title') as string) || '';
          const text = (formData.get('text') as string) || '';
          const shareUrl = (formData.get('url') as string) || '';
          const combined = [title, text, shareUrl].filter(Boolean).join('\n\n');

          if (combined.trim().length > 0) {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
            const textFile = new File([combined], `Shared-Note-${timestamp}.txt`, {
              type: 'text/plain;charset=utf-8',
            });
            uploadedFiles.push(textFile);
          }
        }

        for (const file of uploadedFiles) {
          const id = crypto.randomUUID();
          const filename = file.name || `shared-${Date.now()}`;
          const mimeType = file.type || guessMimeType(filename);
          const size = file.size;

          const buffer = await file.arrayBuffer();
          await env.KV.put(id, buffer);

          await env.DB.prepare(
            'INSERT INTO files (id, filename, mime_type, size, pinned, uploaded_at) VALUES (?, ?, ?, ?, 0, datetime("now"))'
          )
            .bind(id, filename, mimeType, size)
            .run();
        }

        return Response.redirect(`${url.origin}/?shared=1`, 303);
      } catch (err: any) {
        return Response.redirect(`${url.origin}/?error=${encodeURIComponent(err.message || 'Share failed')}`, 303);
      }
    }

    if (path.startsWith('/api/')) {
      if (!isAuthenticated(request, env)) {
        return errorResponse('Unauthorized: Valid passkey required', 401);
      }

      // 1. Upload File: POST /api/upload
      if (path === '/api/upload' && request.method === 'POST') {
        try {
          const formData = await request.formData();
          const fileEntries = formData.getAll('file');
          const results: FileRecord[] = [];

          if (!fileEntries || fileEntries.length === 0) {
            return errorResponse('No file provided in form data', 400);
          }

          for (const entry of fileEntries) {
            if (!isFormDataFile(entry)) continue;
            if (entry.size === 0) continue;

            const id = crypto.randomUUID();
            const filename = entry.name || `file-${Date.now()}`;
            const mimeType = entry.type || guessMimeType(filename);
            const size = entry.size;

            const buffer = await entry.arrayBuffer();
            await env.KV.put(id, buffer);

            await env.DB.prepare(
              'INSERT INTO files (id, filename, mime_type, size, pinned, uploaded_at) VALUES (?, ?, ?, ?, 0, datetime("now"))'
            )
              .bind(id, filename, mimeType, size)
              .run();

            results.push({
              id,
              filename,
              mimeType,
              size,
              pinned: 0,
              uploadedAt: new Date().toISOString(),
              downloadUrl: `/api/download/${id}`,
            });
          }

          return jsonResponse({
            success: true,
            count: results.length,
            files: results,
          });
        } catch (err: any) {
          return errorResponse(err.message || 'Upload processing failed', 500);
        }
      }

      // 2. List Files: GET /api/files
      if (path === '/api/files' && request.method === 'GET') {
        try {
          const { results } = await env.DB.prepare(
            `SELECT id, filename, mime_type AS mimeType, size, pinned, uploaded_at AS uploadedAt
             FROM files
             ORDER BY uploaded_at DESC
             LIMIT 50`
          ).all<FileRecord>();

          const files = (results || []).map((file) => ({
            ...file,
            pinned: Boolean(file.pinned),
            downloadUrl: `/api/download/${file.id}`,
          }));

          return jsonResponse({ files });
        } catch (err: any) {
          return errorResponse(err.message || 'Failed to list files', 500);
        }
      }

      // 3. Download / Stream: GET /api/download/:id
      const downloadMatch = path.match(/^\/api\/download\/([a-zA-Z0-9-]+)$/);
      if (downloadMatch && request.method === 'GET') {
        const id = downloadMatch[1];
        try {
          const meta = await env.DB.prepare(
            'SELECT filename, mime_type AS mimeType, size FROM files WHERE id = ?'
          )
            .bind(id)
            .first<{ filename: string; mimeType: string; size: number }>();

          const buffer = await env.KV.get(id, 'arrayBuffer');
          if (!buffer) {
            return errorResponse('File not found', 404);
          }

          const filename = meta?.filename || 'file';
          const mimeType = meta?.mimeType || 'application/octet-stream';
          const safeName = sanitizeFilename(filename);

          const isDownloadForce = url.searchParams.get('download') === '1';
          const isInlineViewable =
            !isDownloadForce &&
            (mimeType.startsWith('image/') ||
              mimeType.startsWith('video/') ||
              mimeType.startsWith('audio/') ||
              mimeType === 'application/pdf' ||
              mimeType.startsWith('text/'));

          const dispositionType = isInlineViewable ? 'inline' : 'attachment';
          const encodedName = encodeURIComponent(filename).replace(/['()]/g, escape).replace(/\*/g, '%2A');
          const contentDisposition = `${dispositionType}; filename="${safeName}"; filename*=UTF-8''${encodedName}`;

          const headers = new Headers();
          headers.set('Content-Type', mimeType);
          headers.set('Content-Disposition', contentDisposition);
          headers.set('Content-Length', buffer.byteLength.toString());
          headers.set('Cache-Control', 'private, max-age=3600');
          headers.set('Access-Control-Allow-Origin', '*');

          return new Response(buffer, { headers });
        } catch (err: any) {
          return errorResponse(err.message || 'Download error', 500);
        }
      }

      // 4. Delete File: DELETE /api/files/:id
      const deleteMatch = path.match(/^\/api\/files\/([a-zA-Z0-9-]+)$/);
      if (deleteMatch && request.method === 'DELETE') {
        const id = deleteMatch[1];
        try {
          await env.KV.delete(id);
          await env.DB.prepare('DELETE FROM files WHERE id = ?').bind(id).run();
          return jsonResponse({ success: true, id });
        } catch (err: any) {
          return errorResponse(err.message || 'Failed to delete file', 500);
        }
      }

      // 5. Toggle Pin: PATCH /api/files/:id/pin
      const pinMatch = path.match(/^\/api\/files\/([a-zA-Z0-9-]+)\/pin$/);
      if (pinMatch && request.method === 'PATCH') {
        const id = pinMatch[1];
        try {
          const body = (await request.json().catch(() => ({}))) as { pinned?: boolean };
          let newPinned: number;

          if (typeof body.pinned === 'boolean') {
            newPinned = body.pinned ? 1 : 0;
          } else {
            const current = await env.DB.prepare('SELECT pinned FROM files WHERE id = ?')
              .bind(id)
              .first<{ pinned: number }>();
            newPinned = current?.pinned ? 0 : 1;
          }

          await env.DB.prepare('UPDATE files SET pinned = ? WHERE id = ?')
            .bind(newPinned, id)
            .run();

          return jsonResponse({ success: true, id, pinned: Boolean(newPinned) });
        } catch (err: any) {
          return errorResponse(err.message || 'Failed to toggle pin', 500);
        }
      }

      return errorResponse('API route not found', 404);
    }

    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response('DropLocker worker ready.', { status: 200 });
  },

  // Hourly Cron Trigger for Auto-Cleanup (>48 hours, unpinned)
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    try {
      const { results } = await env.DB.prepare(
        `SELECT id, filename FROM files
         WHERE pinned = 0 AND uploaded_at < datetime('now', '-48 hours')`
      ).all<{ id: string; filename: string }>();

      if (!results || results.length === 0) return;

      const ids = results.map((r) => r.id);
      await Promise.all(ids.map((id) => env.KV.delete(id)));

      await env.DB.prepare(
        `DELETE FROM files WHERE pinned = 0 AND uploaded_at < datetime('now', '-48 hours')`
      ).run();
    } catch (err) {
      console.error('[DropLocker Cron] Retention error:', err);
    }
  },
};
