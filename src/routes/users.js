import { json } from '../index.js';
import { isAdmin } from '../utils/auth.js';

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = [
  'image/jpeg','image/png','image/gif','image/webp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain','text/csv'
];

export async function handleAttachments(request, env, user, path) {
  const method = request.method;
  const url    = new URL(request.url);
  const userId = user.id || user.sub; // JWT payload 일관성 확보

  // ── 1. POST /api/attachments/upload?post_id= 또는 ?comment_id= ────────
  if (path === '/api/attachments/upload' && method === 'POST') {
    const post_id    = url.searchParams.get('post_id');
    const comment_id = url.searchParams.get('comment_id');

    if (!post_id && !comment_id) {
      return json({ error: 'post_id 또는 comment_id가 필요합니다.' }, 400);
    }

    // [보안] 소유권 검증 (게시글)
    if (post_id) {
      const post = await env.DB.prepare('SELECT author_id FROM posts WHERE id = ?').bind(post_id).first();
      if (!post) return json({ error: '게시글을 찾을 수 없습니다.' }, 404);
      if (post.author_id !== userId && !isAdmin(user)) {
        return json({ error: '게시글 작성자 또는 관리자만 파일을 첨부할 수 있습니다.' }, 403);
      }
    }

    // [보안] 소유권 검증 (댓글)
    if (comment_id) {
      const comment = await env.DB.prepare('SELECT author_id FROM comments WHERE id = ?').bind(comment_id).first();
      if (!comment) return json({ error: '댓글을 찾을 수 없습니다.' }, 404);
      if (comment.author_id !== userId && !isAdmin(user)) {
        return json({ error: '댓글 작성자 또는 관리자만 파일을 첨부할 수 있습니다.' }, 403);
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

    // [보안] 파일 크기 및 형식 검증
    if (file.size > MAX_FILE_SIZE) {
      return json({ error: '파일 크기는 5MB 이하여야 합니다.' }, 400);
    }

    const mimeType = file.type || 'application/octet-stream';
    if (!ALLOWED_TYPES.includes(mimeType)) {
      return json({ error: `허용되지 않는 파일 형식입니다. (${mimeType})` }, 400);
    }

    // 첨부파일 수 제한 (게시글당 10개) - 댓글 첨부파일은 제외하여 계산
    if (post_id) {
      const countRow = await env.DB.prepare(
        'SELECT COUNT(*) as cnt FROM attachments WHERE post_id = ? AND comment_id IS NULL'
      ).bind(post_id).first();
      if (countRow.cnt >= 10) {
        return json({ error: '첨부파일은 게시글당 최대 10개입니다.' }, 400);
      }
    }

    // 파일 바이너리 → Base64 변환 (청크 처리)
    let base64;
    try {
      const buffer = await file.arrayBuffer();
      const bytes  = new Uint8Array(buffer);
      let binary   = '';
      const chunkSize = 8192; // 스택 오버플로우 방지
      for (let i = 0; i < bytes.byteLength; i += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
      }
      base64 = btoa(binary);
    } catch (e) {
      return json({ error: '파일 처리 중 서버 오류가 발생했습니다.' }, 500);
    }

    const ext = (file.name.split('.').pop() || 'bin').toLowerCase();
    const storedKey = `uploads/${post_id ? 'posts' : 'comments'}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;

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
        message: '파일이 성공적으로 업로드되었습니다.',
        attachment: {
          id:        result.meta.last_row_id,
          filename:  file.name,
          file_size: file.size,
          mime_type: mimeType
        }
      }, 201);
    } catch (e) {
      console.error('[Attachment Upload Error]', e);
      return json({ error: '데이터베이스 저장 중 오류가 발생했습니다.' }, 500);
    }
  }

  // ── 공통 함수: 첨부파일 조회 및 권한 검증용 쿼리 ──
  // 게시글 첨부파일과 댓글 첨부파일의 원본 권한(company_id, author_id)을 모두 추적
  async function getAttachmentWithAuth(attId) {
    return await env.DB.prepare(`
      SELECT a.*, 
             COALESCE(p.author_id, c.author_id) as item_author_id,
             COALESCE(p.company_id, cp.company_id) as item_company_id
      FROM attachments a
      LEFT JOIN posts p ON a.post_id = p.id
      LEFT JOIN comments c ON a.comment_id = c.id
      LEFT JOIN posts cp ON c.post_id = cp.id
      WHERE a.id = ?
    `).bind(attId).first();
  }

  // ── 2. GET /api/attachments/:id — 인라인 표시 (이미지 등) ───────────
  const matchGet = path.match(/^\/api\/attachments\/(\d+)$/);
  if (matchGet && method === 'GET') {
    const attId = parseInt(matchGet[1]);
    const att = await getAttachmentWithAuth(attId);

    if (!att) return json({ error: '파일을 찾을 수 없습니다.' }, 404);

    // [보안] 파트너(관계사)는 자사 데이터만 열람 가능
    if (user.role === 'partner' && att.item_company_id !== user.company_id) {
      return json({ error: '해당 파일에 접근할 권한이 없습니다.' }, 403);
    }

    try {
      const binary = atob(att.file_data);
      const bytes  = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

      return new Response(bytes.buffer, {
        headers: {
          'Content-Type':  att.mime_type,
          'Cache-Control': 'private, max-age=3600',
          'X-Content-Type-Options': 'nosniff'
        }
      });
    } catch (e) {
      return json({ error: '파일 렌더링 중 오류가 발생했습니다.' }, 500);
    }
  }

  // ── 3. GET /api/attachments/:id/download — 파일 다운로드 ────────────
  const matchDown = path.match(/^\/api\/attachments\/(\d+)\/download$/);
  if (matchDown && method === 'GET') {
    const attId = parseInt(matchDown[1]);
    const att = await getAttachmentWithAuth(attId);

    if (!att) return json({ error: '파일을 찾을 수 없습니다.' }, 404);

    if (user.role === 'partner' && att.item_company_id !== user.company_id) {
      return json({ error: '해당 파일을 다운로드할 권한이 없습니다.' }, 403);
    }

    try {
      const binary = atob(att.file_data);
      const bytes  = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

      const encoded = encodeURIComponent(att.filename).replace(/['()]/g, escape).replace(/\*/g, '%2A');
      return new Response(bytes.buffer, {
        headers: {
          'Content-Type': att.mime_type,
          'Content-Disposition': `attachment; filename*=UTF-8''${encoded}`,
          'Content-Length': String(att.file_size),
          'X-Content-Type-Options': 'nosniff'
        }
      });
    } catch (e) {
      return json({ error: '파일 다운로드 처리 중 오류가 발생했습니다.' }, 500);
    }
  }

  // ── 4. DELETE /api/attachments/:id ───────────────────────────────────
  const matchDel = path.match(/^\/api\/attachments\/(\d+)$/);
  if (matchDel && method === 'DELETE') {
    const attId = parseInt(matchDel[1]);
    const att = await getAttachmentWithAuth(attId);

    if (!att) return json({ error: '파일을 찾을 수 없습니다.' }, 404);
    
    // [보안] 파일을 업로드한 본인이거나 시스템 관리자만 삭제 가능
    if (att.uploader_id !== userId && !isAdmin(user)) {
      return json({ error: '파일을 삭제할 권한이 없습니다.' }, 403);
    }

    await env.DB.prepare('DELETE FROM attachments WHERE id = ?').bind(attId).run();
    return json({ message: '파일이 영구적으로 삭제되었습니다.' });
  }

  return json({ error: '존재하지 않는 첨부파일 API 엔드포인트입니다.' }, 404);
}
