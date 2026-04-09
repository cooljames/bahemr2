import { json } from '../index.js';
import { isSuperAdmin, isAdmin, isStaff } from '../utils/auth.js';

function canAccess(board, user) {
  if (isAdmin(user)) return true;
  if (board.access_role === 'all') return true;
  if (board.access_role === 'staff' && isStaff(user)) return true;
  return false;
}

function canWrite(board, user) {
  if (isAdmin(user)) return true;
  if (board.write_role === 'all') return true;
  if (board.write_role === 'staff' && isStaff(user)) return true;
  return false;
}

export async function handleBoards(request, env, user, path) {
  const method = request.method;

  // GET /api/boards — 게시판 목록 (접근 가능한 것만)
  if (path === '/api/boards' && method === 'GET') {
    const rows = await env.DB.prepare(
      `SELECT b.*, u.name as created_by_name,
              COUNT(DISTINCT p.id) as post_count
       FROM boards b
       LEFT JOIN users u ON u.id = b.created_by
       LEFT JOIN posts p ON p.board_id = b.id
       WHERE b.is_active = 1
       GROUP BY b.id
       ORDER BY b.sort_order, b.id`
    ).all();

    // 권한 필터링 + canWrite 플래그 추가
    const visible = rows.results.filter(b => canAccess(b, user)).map(b => ({
      ...b,
      can_write: canWrite(b, user)
    }));

    return json({ boards: visible });
  }

  // POST /api/boards — 게시판 생성 (superadmin 전용)
  if (path === '/api/boards' && method === 'POST') {
    if (!isSuperAdmin(user)) return json({ error: '슈퍼관리자만 게시판을 생성할 수 있습니다.' }, 403);

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
  }

  // GET /api/boards/:id
  const matchGet = path.match(/^\/api\/boards\/(\d+)$/);
  if (matchGet && method === 'GET') {
    const id = parseInt(matchGet[1]);
    const board = await env.DB.prepare('SELECT * FROM boards WHERE id = ? AND is_active = 1').bind(id).first();
    if (!board) return json({ error: '게시판을 찾을 수 없습니다.' }, 404);
    if (!canAccess(board, user)) return json({ error: '접근 권한이 없습니다.' }, 403);
    return json({ board: { ...board, can_write: canWrite(board, user) } });
  }

  // PATCH /api/boards/:id — 수정 (superadmin)
  const matchPatch = path.match(/^\/api\/boards\/(\d+)$/);
  if (matchPatch && method === 'PATCH') {
    if (!isSuperAdmin(user)) return json({ error: '슈퍼관리자만 수정할 수 있습니다.' }, 403);

    const id   = parseInt(matchPatch[1]);
    const body = await request.json();
    const { name, description, type, access_role, write_role, sort_order, is_active } = body;

    const fields = [];
    const binds  = [];
    if (name        !== undefined) { fields.push('name = ?');        binds.push(name); }
    if (description !== undefined) { fields.push('description = ?'); binds.push(description); }
    if (type        !== undefined) { fields.push('type = ?');        binds.push(type); }
    if (access_role !== undefined) { fields.push('access_role = ?'); binds.push(access_role); }
    if (write_role  !== undefined) { fields.push('write_role = ?');  binds.push(write_role); }
    if (sort_order  !== undefined) { fields.push('sort_order = ?');  binds.push(sort_order); }
    if (is_active   !== undefined) { fields.push('is_active = ?');   binds.push(is_active); }

    if (!fields.length) return json({ error: '변경할 항목이 없습니다.' }, 400);
    binds.push(id);

    await env.DB.prepare(`UPDATE boards SET ${fields.join(', ')} WHERE id = ?`).bind(...binds).run();
    return json({ message: '게시판이 수정되었습니다.' });
  }

  // DELETE /api/boards/:id — 삭제(비활성화) (superadmin)
  const matchDel = path.match(/^\/api\/boards\/(\d+)$/);
  if (matchDel && method === 'DELETE') {
    if (!isSuperAdmin(user)) return json({ error: '슈퍼관리자만 삭제할 수 있습니다.' }, 403);
    const id = parseInt(matchDel[1]);
    await env.DB.prepare('UPDATE boards SET is_active = 0 WHERE id = ?').bind(id).run();
    return json({ message: '게시판이 삭제되었습니다.' });
  }

  return json({ error: '존재하지 않는 게시판 API입니다.' }, 404);
}
