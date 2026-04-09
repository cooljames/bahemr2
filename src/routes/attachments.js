import { json } from '../index.js';
import { isAdmin } from '../utils/auth.js';

const MAX_FILE_SIZE = 5 * 1024 * 1024; // D1 row 제한 고려 → 5MB
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

  // POST /api/attachments/upload?post_id=
  if (path === '/api/attachments/upload' && method === 'POST') {
    const url     = new URL(request.url);
    const post_id = url.searchParams.get('post_id');
    if (!post_id) return json({ error: 'post_id가 필요합니다.' }, 400);

    // 게시글 소유권 확인
    const post = await env.DB.prepare('SELECT * FROM posts WHERE id = ?').bind(post_id).first();
    if (!post) return json({ error: '게시글을 찾을 수 없습니다.' }, 404);
    if (post.author_id !== user.sub && !isAdmin(user)) return json({ error: '권한이 없습니다.' }, 403);

    const formData = await request.formData();
    const file     = formData.get('file');
    if (!file) return json({ error: '파일을 선택하세요.' }, 400);

    if (file.size > MAX_FILE_SIZE) return json({ error: '파일 크기는 5MB 이하여야 합니다.' }, 400);
    if (!ALLOWED_TYPES.includes(file.type)) return json({ error: '허용되지 않는 파일 형식입니다.' }, 400);

    // 첨부파일 수 제한 (게시글당 10개)
    const countRow = await env.DB.prepare(
      'SELECT COUNT(*) as cnt FROM attachments WHERE post_id = ?'
    ).bind(post_id).first();
    if (countRow.cnt >= 10) return json({ error: '첨부파일은 게시글당 최대 10개입니다.' }, 400);

    // 파일 바이너리 → Base64 변환 (D1 TEXT 컬럼에 저장)
    const buffer = await file.arrayBuffer();
    const bytes  = new Uint8Array(buffer);
    let binary   = '';
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    const base64 = btoa(binary);

    const ext       = file.name.split('.').pop();
    const storedKey = `posts/${post_id}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;

    // D1에 파일 본문(Base64)과 메타데이터 함께 저장
    const result = await env.DB.prepare(
      `INSERT INTO attachments (post_id, uploader_id, filename, stored_key, file_size, mime_type, file_data)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(post_id, user.sub, file.name, storedKey, file.size, file.type, base64).run();

    return json({
      message: '파일이 업로드되었습니다.',
      attachment: {
        id:        result.meta.last_row_id,
        filename:  file.name,
        file_size: file.size,
        mime_type: file.type
      }
    }, 201);
  }

  // GET /api/attachments/:id/download
  const matchDown = path.match(/^\/api\/attachments\/(\d+)\/download$/);
  if (matchDown && method === 'GET') {
    const attId = parseInt(matchDown[1]);
    const att   = await env.DB.prepare(
      `SELECT a.*, p.author_id, p.company_id
       FROM attachments a JOIN posts p ON p.id = a.post_id
       WHERE a.id = ?`
    ).bind(attId).first();

    if (!att) return json({ error: '파일을 찾을 수 없습니다.' }, 404);

    // partner는 자기 회사 게시글 파일만
    if (user.role === 'partner' && att.company_id !== user.company_id) {
      return json({ error: '접근 권한이 없습니다.' }, 403);
    }

    // Base64 → 바이너리 복원
    const binary = atob(att.file_data);
    const bytes  = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

    const encoded = encodeURIComponent(att.filename);
    return new Response(bytes.buffer, {
      headers: {
        'Content-Type':        att.mime_type,
        'Content-Disposition': `attachment; filename*=UTF-8''${encoded}`,
        'Content-Length':      String(att.file_size)
      }
    });
  }

  // DELETE /api/attachments/:id
  const matchDel = path.match(/^\/api\/attachments\/(\d+)$/);
  if (matchDel && method === 'DELETE') {
    const attId = parseInt(matchDel[1]);
    const att   = await env.DB.prepare(
      `SELECT a.*, p.author_id FROM attachments a JOIN posts p ON p.id = a.post_id WHERE a.id = ?`
    ).bind(attId).first();

    if (!att) return json({ error: '파일을 찾을 수 없습니다.' }, 404);
    if (att.uploader_id !== user.sub && !isAdmin(user)) return json({ error: '삭제 권한이 없습니다.' }, 403);

    // D1에서만 삭제 (R2 불필요)
    await env.DB.prepare('DELETE FROM attachments WHERE id = ?').bind(attId).run();

    return json({ message: '파일이 삭제되었습니다.' });
  }

  return json({ error: '존재하지 않는 첨부파일 API입니다.' }, 404);
}
