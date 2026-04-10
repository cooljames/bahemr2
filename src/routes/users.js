import { json } from '../index.js';
import { isAdmin, isSuperAdmin } from '../utils/auth.js';

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain', 'text/csv'
];

export async function handleAttachments(request, env, user, path) {
  const method = request.method;
  const url = new URL(request.url);
  const userId = user.id || user.sub; // JWT payload에 따라 id 또는 sub 사용

  // ── 1. POST /api/attachments/upload (업로드) ──
  if (path === '/api/attachments/upload' && method === 'POST') {
    const post_id = url.searchParams.get('post_id');
    const comment_id = url.searchParams.get('comment_id');

    if (!post_id && !comment_id) {
      return json({ error: 'post_id 또는 comment_id가 필요합니다.' }, 400);
    }

    // [보안] 권한 검증: 게시글/댓글 소유자이거나 관리자여야 함
    if (post_id) {
      const post = await env.DB.prepare('SELECT author_id FROM posts WHERE id = ?').bind(post_id).first();
      if (!post) return json({ error: '대상 게시글을 찾을 수 없습니다.' }, 404);
      if (post.author_id !== userId && !isAdmin(user)) {
        return json({ error: '본인의 게시글에만 파일을 첨부할 수 있습니다.' }, 403);
      }
    } else if (comment_id) {
      const comment = await env.DB.prepare('SELECT author_id FROM comments WHERE id = ?').bind(comment_id).first();
      if (!comment) return json({ error: '대상 댓글을 찾을 수 없습니다.' }, 404);
      if (comment.author_id !== userId && !isAdmin(user)) {
        return json({ error: '본인의 댓글에만 파일을 첨부할 수 있습니다.' }, 403);
      }
    }

    let formData;
    try {
      formData = await request.formData();
    } catch (e) {
      return json({ error: '파일 데이터를 읽을 수 없습니다.' }, 400);
    }

    const file = formData.get('file');
    if (!file) return json({ error: '파일을 선택하세요.' }, 400);

    // [보안] 파일 검증
    if (file.size > MAX_FILE_SIZE) {
      return json({ error: '파일 크기는 5MB를 초과할 수 없습니다.' }, 400);
    }
    const mimeType = file.type || 'application/octet-stream';
    if (!ALLOWED_TYPES.includes(mimeType)) {
      return json({ error: `허용되지 않는 형식입니다: ${mimeType}` }, 400);
    }

    // [제한] 게시글당 파일 개수 제한 (댓글 제외 순수 게시글 첨부파일만)
    if (post_id) {
      const countRow = await env.DB.prepare(
        'SELECT COUNT(*) as cnt FROM attachments WHERE post_id = ? AND comment_id IS NULL'
      ).bind(post_id).first();
      if (countRow.cnt >= 10) return json({ error: '한 게시글에 파일은 10개까지만 업로드 가능합니다.' }, 400);
    }

    // 파일 바이너리 -> Base64 변환
    let base64;
    try {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = '';
      const chunkSize = 8192;
      for (let i = 0; i < bytes.byteLength; i += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
      }
      base64 = btoa(binary);
    } catch (e) {
      return json({ error: '파일 변환 중 오류가 발생했습니다.' }, 500);
    }

    const ext = (file.name.split('.').pop() || 'bin').toLowerCase();
    const storedKey = `uploads/${post_id ? 'posts' : 'comments'}/${Date.now()}_${Math.random().toString(36).slice(2, 7)}.${ext}`;

    try {
      const result = await env.DB.prepare(
        `INSERT INTO attachments (post_id, comment_id, uploader_id, filename, stored_key, file_size, mime_type, file_data)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        post_id ? parseInt(post_id) : null,
        comment_id ? parseInt(comment_id) : null,
        userId,
        file.name,
        storedKey,
        file.size,
        mimeType,
        base64
      ).run();

      return json({
        message: '파일 업로드 완료',
        attachment: { id: result.meta.last_row_id, filename: file.name }
      }, 201);
    } catch (e) {
      return json({ error: 'DB 저장 실패' }, 500);
    }
  }

  // ── ID 추출을 위한 정규식 매칭 ──
  const matchId = path.match(/^\/api\/attachments\/(\d+)(?:\/download)?$/);
  if (matchId) {
    const attId = parseInt(matchId[1]);
    const isDownload = path.endsWith('/download');

    // [공통] 첨부물 정보 및 권한 조회를 위한 쿼리
    const att = await env.DB.prepare(`
      SELECT a.*, 
             COALESCE(p.author_id, c.author_id) as item_author_id,
             COALESCE(p.company_id, cp.company_id) as item_company_id
      FROM attachments a
      LEFT JOIN posts p ON a.post_id = p.id
      LEFT JOIN comments c ON a.comment_id = c.id
      LEFT JOIN posts cp ON c.post_id = cp.id
      WHERE a.id = ?
    `).bind(attId).first();

    if (!att) return json({ error: '파일을 찾을 수 없습니다.' }, 404);

    // ── 2 & 3. GET /api/attachments/:id (조회/다운로드) ──
    if (method === 'GET') {
      // [보안] 관계사(partner) 격리 확인
      if (user.role === 'partner' && att.item_company_id !== user.company_id) {
        return json({ error: '권한이 없습니다.' }, 403);
      }

      try {
        const binary = atob(att.file_data);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

        const headers = {
          'Content-Type': att.mime_type,
          'Cache-Control': 'private, max-age=3600',
          'X-Content-Type-Options': 'nosniff'
        };

        if (isDownload) {
          const encodedName = encodeURIComponent(att.filename).replace(/['()]/g, escape).replace(/\*/g, '%2A');
          headers['Content-Disposition'] = `attachment; filename*=UTF-8''${encodedName}`;
          headers['Content-Length'] = String(att.file_size);
        }

        return new Response(bytes.buffer, { headers });
      } catch (e) {
        return json({ error: '파일 처리 오류' }, 500);
      }
    }

    // ── 4. DELETE /api/attachments/:id (삭제) ──
    if (method === 'DELETE') {
      // [보안] 업로더 본인 또는 관리자만 삭제 가능
      if (att.uploader_id !== userId && !isAdmin(user)) {
        return json({ error: '삭제 권한이 없습니다.' }, 403);
      }

      await env.DB.prepare('DELETE FROM attachments WHERE id = ?').bind(attId).run();
      return json({ message: '파일이 삭제되었습니다.' });
    }
  }

  return json({ error: 'Not Found' }, 404);
}
