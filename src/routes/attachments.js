import { json } from '../index.js';
import { isAdmin } from '../utils/auth.js';

const MAX_FILE_SIZE  = 5 * 1024 * 1024; // 5MB
const MAX_PROFILE_SIZE = 800 * 1024;    // 프로필 이미지 800KB (D1 row 한계 고려)
const ALLOWED_TYPES = [
  'image/jpeg','image/png','image/gif','image/webp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain','text/csv'
];

// comment_id 컬럼 존재 여부 캐시 (워커 인스턴스 내)
let _hasCommentIdCol = null;

async function hasCommentIdColumn(env) {
  if (_hasCommentIdCol !== null) return _hasCommentIdCol;
  try {
    const info = await env.DB.prepare("PRAGMA table_info(attachments)").all();
    _hasCommentIdCol = (info.results || []).some(col => col.name === 'comment_id');
  } catch {
    _hasCommentIdCol = false;
  }
  return _hasCommentIdCol;
}

export async function handleAttachments(request, env, user, path) {
  const method = request.method;
  const url    = new URL(request.url);

  // ── POST /api/attachments/upload ─────────────────────────────────
  if (path === '/api/attachments/upload' && method === 'POST') {
    const post_id    = url.searchParams.get('post_id')    || null;
    const comment_id = url.searchParams.get('comment_id') || null;

    if (!post_id && !comment_id) {
      return json({ error: 'post_id 또는 comment_id가 필요합니다.' }, 400);
    }

    // 소유권 확인
    if (post_id) {
      const post = await env.DB.prepare('SELECT * FROM posts WHERE id = ?').bind(post_id).first();
      if (!post) return json({ error: '게시글을 찾을 수 없습니다.' }, 404);
      if (post.author_id !== user.sub && !isAdmin(user)) {
        return json({ error: '권한이 없습니다.' }, 403);
      }
    }

    if (comment_id) {
      const comment = await env.DB.prepare('SELECT * FROM comments WHERE id = ?').bind(comment_id).first();
      if (!comment) return json({ error: '댓글을 찾을 수 없습니다.' }, 404);
      if (comment.author_id !== user.sub && !isAdmin(user)) {
        return json({ error: '권한이 없습니다.' }, 403);
      }
    }

    let formData;
    try {
      formData = await request.formData();
    } catch (e) {
      return json({ error: '파일 데이터를 읽을 수 없습니다: ' + e.message }, 400);
    }

    const file = formData.get('file');
    if (!file) return json({ error: '파일을 선택하세요.' }, 400);

    if (file.size > MAX_FILE_SIZE) {
      return json({ error: '파일 크기는 5MB 이하여야 합니다.' }, 400);
    }

    const mimeType = file.type || 'application/octet-stream';
    if (!ALLOWED_TYPES.includes(mimeType)) {
      return json({ error: `허용되지 않는 파일 형식입니다. (${mimeType})` }, 400);
    }

    // 첨부파일 수 제한 (게시글당 10개)
    if (post_id) {
      const countRow = await env.DB.prepare(
        'SELECT COUNT(*) as cnt FROM attachments WHERE post_id = ?'
      ).bind(post_id).first();
      if ((countRow?.cnt || 0) >= 10) {
        return json({ error: '첨부파일은 게시글당 최대 10개입니다.' }, 400);
      }
    }

    // 파일 → Base64
    let base64;
    try {
      const buffer = await file.arrayBuffer();
      const bytes  = new Uint8Array(buffer);
      let binary   = '';
      const chunkSize = 8192;
      for (let i = 0; i < bytes.byteLength; i += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
      }
      base64 = btoa(binary);
    } catch (e) {
      return json({ error: '파일 변환 중 오류가 발생했습니다: ' + e.message }, 500);
    }

    const ext       = (file.name.split('.').pop() || 'bin').toLowerCase();
    const storedKey = `posts/${post_id || 'comment'}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;

    // comment_id 컬럼 존재 여부에 따라 쿼리 분기
    const withComment = await hasCommentIdColumn(env);

    try {
      let result;
      if (withComment) {
        result = await env.DB.prepare(
          `INSERT INTO attachments (post_id, comment_id, uploader_id, filename, stored_key, file_size, mime_type, file_data)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          post_id    ? parseInt(post_id)    : null,
          comment_id ? parseInt(comment_id) : null,
          user.sub, file.name, storedKey, file.size, mimeType, base64
        ).run();
      } else {
        // 마이그레이션 미적용 환경: comment_id 컬럼 없이 INSERT
        result = await env.DB.prepare(
          `INSERT INTO attachments (post_id, uploader_id, filename, stored_key, file_size, mime_type, file_data)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          post_id ? parseInt(post_id) : null,
          user.sub, file.name, storedKey, file.size, mimeType, base64
        ).run();
      }

      return json({
        message: '파일이 업로드되었습니다.',
        attachment: {
          id:        result.meta.last_row_id,
          filename:  file.name,
          file_size: file.size,
          mime_type: mimeType
        }
      }, 201);
    } catch (e) {
      return json({ error: 'DB 저장 오류: ' + e.message }, 500);
    }
  }

  // ── GET /api/attachments/:id — 인라인 표시 ───────────────────────
  const matchGet = path.match(/^\/api\/attachments\/(\d+)$/);
  if (matchGet && method === 'GET') {
    const attId = parseInt(matchGet[1]);
    const att   = await env.DB.prepare(
      `SELECT a.*, p.author_id as post_author_id, p.company_id
       FROM attachments a
       LEFT JOIN posts p ON p.id = a.post_id
       WHERE a.id = ?`
    ).bind(attId).first();

    if (!att) return json({ error: '파일을 찾을 수 없습니다.' }, 404);

    if (user.role === 'partner' && att.company_id !== user.company_id) {
      return json({ error: '접근 권한이 없습니다.' }, 403);
    }

    try {
      const binary = atob(att.file_data);
      const bytes  = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

      return new Response(bytes.buffer, {
        headers: {
          'Content-Type':  att.mime_type,
          'Cache-Control': 'private, max-age=3600'
        }
      });
    } catch (e) {
      return json({ error: '파일 읽기 오류: ' + e.message }, 500);
    }
  }

  // ── GET /api/attachments/:id/download ────────────────────────────
  const matchDown = path.match(/^\/api\/attachments\/(\d+)\/download$/);
  if (matchDown && method === 'GET') {
    const attId = parseInt(matchDown[1]);
    const att   = await env.DB.prepare(
      `SELECT a.*, p.author_id, p.company_id
       FROM attachments a
       LEFT JOIN posts p ON p.id = a.post_id
       WHERE a.id = ?`
    ).bind(attId).first();

    if (!att) return json({ error: '파일을 찾을 수 없습니다.' }, 404);

    if (user.role === 'partner' && att.company_id !== user.company_id) {
      return json({ error: '접근 권한이 없습니다.' }, 403);
    }

    try {
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
    } catch (e) {
      return json({ error: '파일 다운로드 오류: ' + e.message }, 500);
    }
  }

  // ── DELETE /api/attachments/:id ───────────────────────────────────
  const matchDel = path.match(/^\/api\/attachments\/(\d+)$/);
  if (matchDel && method === 'DELETE') {
    const attId = parseInt(matchDel[1]);
    const att   = await env.DB.prepare(
      `SELECT a.*, p.author_id FROM attachments a
       LEFT JOIN posts p ON p.id = a.post_id WHERE a.id = ?`
    ).bind(attId).first();

    if (!att) return json({ error: '파일을 찾을 수 없습니다.' }, 404);
    if (att.uploader_id !== user.sub && !isAdmin(user)) {
      return json({ error: '삭제 권한이 없습니다.' }, 403);
    }

    await env.DB.prepare('DELETE FROM attachments WHERE id = ?').bind(attId).run();
    return json({ message: '파일이 삭제되었습니다.' });
  }

  return json({ error: '존재하지 않는 첨부파일 API입니다.' }, 404);
}
