import { json } from '../index.js';
import { isSuperAdmin, isAdmin, hashPassword } from '../utils/auth.js';

export async function handleUsers(request, env, user, path) {
  const method = request.method;
  const url    = new URL(request.url);

  // GET /api/users — 사용자 목록 (admin 이상)
  if (path === '/api/users' && method === 'GET') {
    if (!isAdmin(user)) return json({ error: '권한이 없습니다.' }, 403);

    const role       = url.searchParams.get('role') || '';
    const company_id = url.searchParams.get('company_id') || '';
    const keyword    = url.searchParams.get('q') || '';
    const page       = parseInt(url.searchParams.get('page') || '1');
    const limit      = 20;
    const offset     = (page - 1) * limit;

    let where = ['1=1'];
    let binds = [];
    if (role)       { where.push('u.role = ?');         binds.push(role); }
    if (company_id) { where.push('u.company_id = ?');   binds.push(company_id); }
    if (keyword)    { where.push('(u.name LIKE ? OR u.email LIKE ?)'); binds.push(`%${keyword}%`, `%${keyword}%`); }

    const whereStr = where.join(' AND ');
    const rows = await env.DB.prepare(
      `SELECT u.id, u.email, u.name, u.role, u.company_id, u.is_active, u.created_at,
              c.name as company_name
       FROM users u
       LEFT JOIN companies c ON c.id = u.company_id
       WHERE ${whereStr}
       ORDER BY u.created_at DESC LIMIT ? OFFSET ?`
    ).bind(...binds, limit, offset).all();

    const countRow = await env.DB.prepare(
      `SELECT COUNT(*) as cnt FROM users u WHERE ${whereStr}`
    ).bind(...binds).first();

    return json({ users: rows.results, total: countRow.cnt, page, limit });
  }

  // GET /api/users/:id
  const matchId = path.match(/^\/api\/users\/(\d+)$/);
  if (matchId && method === 'GET') {
    const targetId = parseInt(matchId[1]);
    if (!isAdmin(user) && user.sub !== targetId) return json({ error: '권한이 없습니다.' }, 403);

    const row = await env.DB.prepare(
      `SELECT u.id, u.email, u.name, u.role, u.company_id, u.is_active, u.created_at,
              c.name as company_name, c.type as company_type
       FROM users u LEFT JOIN companies c ON c.id = u.company_id
       WHERE u.id = ?`
    ).bind(targetId).first();

    if (!row) return json({ error: '사용자를 찾을 수 없습니다.' }, 404);
    return json({ user: row });
  }

  // PATCH /api/users/:id — 역할/상태 변경 (superadmin 전용)
  const matchPatch = path.match(/^\/api\/users\/(\d+)$/);
  if (matchPatch && method === 'PATCH') {
    if (!isSuperAdmin(user)) return json({ error: '슈퍼관리자만 변경 가능합니다.' }, 403);

    const targetId = parseInt(matchPatch[1]);
    const body     = await request.json();
    const { role, is_active, company_id, name } = body;

    const fields = [];
    const binds  = [];
    if (role       !== undefined) { fields.push('role = ?');       binds.push(role); }
    if (is_active  !== undefined) { fields.push('is_active = ?');  binds.push(is_active); }
    if (company_id !== undefined) { fields.push('company_id = ?'); binds.push(company_id); }
    if (name       !== undefined) { fields.push('name = ?');       binds.push(name); }
    if (!fields.length) return json({ error: '변경할 항목이 없습니다.' }, 400);

    fields.push('updated_at = datetime(\'now\')');
    binds.push(targetId);

    await env.DB.prepare(
      `UPDATE users SET ${fields.join(', ')} WHERE id = ?`
    ).bind(...binds).run();

    return json({ message: '사용자 정보가 수정되었습니다.' });
  }

  // PATCH /api/users/:id/password — 비밀번호 변경
  const matchPw = path.match(/^\/api\/users\/(\d+)\/password$/);
  if (matchPw && method === 'PATCH') {
    const targetId = parseInt(matchPw[1]);
    if (!isSuperAdmin(user) && user.sub !== targetId) return json({ error: '권한이 없습니다.' }, 403);

    const { current_password, new_password } = await request.json();
    if (!new_password || new_password.length < 8) return json({ error: '새 비밀번호는 8자 이상이어야 합니다.' }, 400);

    // 본인 변경 시 현재 비밀번호 확인
    if (user.sub === targetId && !isSuperAdmin(user)) {
      const { checkPassword } = await import('../utils/auth.js');
      const row = await env.DB.prepare('SELECT password FROM users WHERE id = ?').bind(targetId).first();
      if (!await checkPassword(current_password, row.password)) {
        return json({ error: '현재 비밀번호가 올바르지 않습니다.' }, 400);
      }
    }

    const hashed = await hashPassword(new_password);
    await env.DB.prepare('UPDATE users SET password = ?, updated_at = datetime(\'now\') WHERE id = ?')
      .bind(hashed, targetId).run();

    return json({ message: '비밀번호가 변경되었습니다.' });
  }

  // DELETE /api/users/:id — 계정 삭제 (superadmin)
  const matchDel = path.match(/^\/api\/users\/(\d+)$/);
  if (matchDel && method === 'DELETE') {
    if (!isSuperAdmin(user)) return json({ error: '슈퍼관리자만 삭제 가능합니다.' }, 403);
    const targetId = parseInt(matchDel[1]);
    if (targetId === user.sub) return json({ error: '자신의 계정은 삭제할 수 없습니다.' }, 400);

    await env.DB.prepare('UPDATE users SET is_active = 0 WHERE id = ?').bind(targetId).run();
    return json({ message: '계정이 비활성화되었습니다.' });
  }

  return json({ error: '존재하지 않는 사용자 API입니다.' }, 404);
}
