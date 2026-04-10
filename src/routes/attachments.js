import { isAdmin, corsHeaders } from '../utils/auth.js';

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' }
});

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const ALLOWED_TYPES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'application/pdf', 'application/msword', 'text/plain', 'text/csv',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
];

export async function handleAttachments(request, env, user, path) {
  const method = request.method;
  const url = new URL(request.url);

  // 1. 업로드 (POST)
  if (path === '/api/attachments/upload' && method === 'POST') {
    const post_id = url.searchParams.get('post_id');
    const comment_id = url.searchParams.get('comment_id');

    if (!post_id && !comment_id) return json({ error: '대상 ID가 필요합니다.' }, 400);

    let formData;
    try {
      formData = await request.formData();
    } catch {
      return json({ error: '파일 형식이 올바르지 않습니다.' }, 400);
    }

    const file = formData.get('file');
    if (!file || typeof file === 'string') return json({ error: '파일을 선택하세요.' }, 400);
    if (file.size > MAX_FILE_SIZE) return json({ error: '최대 5MB까지 가능합니다.' }, 400);

    const arrayBuffer = await file.arrayBuffer();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));

    try {
      const result = await env.DB.prepare(
        `INSERT INTO attachments (post_id, comment_id, uploader_id, filename, file_size, mime_type, file_data, stored_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        post_id ? parseInt(post_id) : null,
        comment_id ? parseInt(comment_id) : null,
        user.sub,
        file.name,
        file.size,
        file.type || 'application/octet-stream',
        base64,
        `files/${Date.now()}_${file.name}`
      ).run();

      return json({ message: '업로드 성공', id: result.meta.last_row_id }, 201);
    } catch (e) {
      return json({ error: 'DB 저장 실패: ' + e.message }, 500);
    }
  }

  // 2. 조회 및 다운로드 (GET)
  const match = path.match(/^\/api\/attachments\/(\d+)(?:\/download)?$/);
  if (match && method === 'GET') {
    const attId = parseInt(match[1]);
    const isDownload = path.endsWith('/download');

    // Partner 권한 체크를 위해 관계사 ID까지 한 번에 조회
    const att = await env.DB.prepare(
      `SELECT a.*, COALESCE(p.company_id, pc.company_id) as company_id
       FROM attachments a
       LEFT JOIN posts p ON a.post_id = p.id
       LEFT JOIN comments c ON a.comment_id = c.id
       LEFT JOIN posts pc ON c.post_id = pc.id
       WHERE a.id = ?`
    ).bind(attId).first();

    if (!att) return json({ error: '파일을 찾을 수 없습니다.' }, 404);

    // 권한 검증: 파트너는 자기 회사 게시글의 파일만 볼 수 있음
    if (user.role === 'partner' && att.company_id !== user.company_id) {
      return json({ error: '접근 권한이 없습니다.' }, 403);
    }

    try {
      const binary = atob(att.file_data);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

      const headers = { 
        'Content-Type': att.mime_type,
        'Cache-Control': 'private, max-age=3600'
      };

      if (isDownload) {
        const encodedName = encodeURIComponent(att.filename);
        headers['Content-Disposition'] = `attachment; filename*=UTF-8''${encodedName}`;
      }

      return new Response(bytes.buffer, { headers });
    } catch (e) {
      return json({ error: '파일 처리 오류' }, 500);
    }
  }

  // 3. 삭제 (DELETE)
  if (match && method === 'DELETE') {
    const attId = parseInt(match[1]);
    const att = await env.DB.prepare('SELECT uploader_id FROM attachments WHERE id = ?').bind(attId).first();
    
    if (!att) return json({ error: '파일이 없습니다.' }, 404);
    if (att.uploader_id !== user.sub && !isAdmin(user)) return json({ error: '권한 없음' }, 403);

    await env.DB.prepare('DELETE FROM attachments WHERE id = ?').bind(attId).run();
    return json({ message: '삭제 완료' });
  }

  return json({ error: '존재하지 않는 첨부파일 API입니다.' }, 404);
}
