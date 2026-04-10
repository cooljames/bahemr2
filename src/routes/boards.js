import { json } from '../index.js';
import { isSuperAdmin, isAdmin, isStaff } from '../utils/auth.js';

/**
 * 권한 체크 유틸리티: 유저 객체가 없어도 에러가 나지 않도록 처리.
 */
function canAccess(board, user) {
  if (!user) return board.access_role === 'all';
  if (isAdmin(user)) return true;
  if (board.access_role === 'all') return true;
  if (board.access_role === 'staff' && isStaff(user)) return true;
  return false;
}

function canWrite(board, user) {
  if (!user) return board.write_role === 'all';
  if (isAdmin(user)) return true;
  if (board.write_role === 'all') return true;
  if (board.write_role === 'staff' && isStaff(user)) return true;
  return false;
}

export async function handleBoards(request, env, user, path) {
  const method = request.method;

  // --- 1. GET /api/boards (게시판 목록 조회) ---
  if (path === '/api/boards' && method === 'GET') {
    try {
      const response = await env.DB.prepare(
        `SELECT b.*, u.name as created_by_name,
                COUNT(DISTINCT p.id) as post_count
         FROM boards b
         LEFT JOIN users u ON u.id = b.created_by
         LEFT JOIN posts p ON p.board_id = b.id
         WHERE b.is_active = 1
         GROUP BY b.id
         ORDER BY b.sort_order ASC, b.id ASC`
      ).all();

      // Cloudflare D1 결과 대응: .results가 있으면 사용, 없으면 전체 사용
      const rows = response.results || response || [];

      const visible = rows
        .filter(b => canAccess(b, user))
        .map(b => ({
          ...b,
          can_write: canWrite(b, user)
        }));

      return json({ boards: visible });
    } catch (err) {
      return json({ error: '데이터베이스 조회 중 오류가 발생했습니다.', details: err.message }, 500);
    }
  }

  // --- 2. POST /api/boards (게시판 생성) ---
  if (path === '/api/boards' && method === 'POST') {
    if (!isSuperAdmin(user)) return json({ error: '슈퍼관리자만 게시판을 생성할 수 있습니다.' }, 403);

    try {
      const { name, description, type, access_role, write_role, sort_order } = await request.json();
      if (!name?.trim()) return json({ error: '게시판 이름을 입력하세요.' }, 400);

      const result = await env.DB.prepare(
        `INSERT INTO boards (name, description, type, access_role, write_role, sort_order, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        name.trim(),
        description || '',
        type        || 'general',
        access_role || 'all',
        write_role  || 'all',
        sort_order  || 0,
        user.sub
      ).run();

      return json({ message: '게시판이 생성되었습니다.', id: result.meta.last_row_id }, 201);
    } catch (err) {
      return json({ error: '게시판 생성 실패', details: err.message }, 500);
    }
  }

  // ID 기반 라우팅을 위한 매치 (GET / PATCH / DELETE 공용)
  const matchId = path.match(/^\/api\/boards\/(\d+)$/);
  
  if (matchId) {
    const boardId = parseInt(matchId[1], 10);

    // --- 3. GET /api/boards/:id (단일 조회) ---
    if (method === 'GET') {
      const board = await env.DB.prepare('SELECT * FROM boards WHERE id = ? AND is_active = 1')
        .bind(boardId)
        .first();

      if (!board) return json({ error: '게시판을 찾을 수 없습니다.' }, 404);
      if (!canAccess(board, user)) return json({ error: '접근 권한이 없습니다.' }, 403);

      return json({ board: { ...board, can_write: canWrite(board, user) } });
    }

    // --- 4. PATCH /api/boards/:id (수정) ---
    if (method === 'PATCH') {
      if (!isSuperAdmin(user)) return json({ error: '슈퍼관리자만 수정할 수 있습니다.' }, 403);

      const body = await request.json();
      const fields = [];
      const binds = [];

      const updateableFields = ['name', 'description', 'type', 'access_role', 'write_role', 'sort_order', 'is_active'];
      updateableFields.forEach(field => {
        if (body[field] !== undefined) {
          fields.push(`${field} = ?`);
          binds.push(body[field]);
        }
      });

      if (fields.length === 0) return json({ error: '변경할 항목이 없습니다.' }, 400);
      
      binds.push(boardId); // WHERE 절 id 바인딩

      await env.DB.prepare(`UPDATE boards SET ${fields.join(', ')} WHERE id = ?`)
        .bind(...binds)
        .run();

      return json({ message: '게시판이 수정되었습니다.' });
    }

    // --- 5. DELETE /api/boards/:id (삭제/비활성화) ---
    if (method === 'DELETE') {
      if (!isSuperAdmin(user)) {
        return json({ error: '슈퍼관리자만 삭제할 수 있습니다.' }, 403);
      }

      try {
        // 1. 게시판 존재 여부 확인
        const board = await env.DB.prepare('SELECT id FROM boards WHERE id = ? AND is_active = 1').bind(boardId).first();
        if (!board) {
          return json({ error: '존재하지 않거나 이미 삭제된 게시판입니다.' }, 404);
        }

        // 2. 소프트 삭제 (is_active = 0) 처리
        await env.DB.prepare('UPDATE boards SET is_active = 0 WHERE id = ?').bind(boardId).run();

        return json({ message: '게시판이 성공적으로 삭제(비활성화) 되었습니다.' });
      } catch (err) {
        console.error('[Board Delete Error]', err);
        return json({ error: '게시판 삭제 처리 중 서버 오류가 발생했습니다.' }, 500);
      }
    }

    // 일치하는 라우트가 없을 경우
    return json({ error: '지원하지 않는 게시판 API 메서드입니다.' }, 405);
  }

  return json({ error: '존재하지 않는 게시판 API입니다.' }, 404);
}
