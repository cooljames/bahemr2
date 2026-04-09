import { json } from '../index.js';
import { isSuperAdmin, isAdmin } from '../utils/auth.js';

export async function handleCompanies(request, env, user, path) {
  const method = request.method;

  // GET /api/companies — 목록
  if (path === '/api/companies' && method === 'GET') {
    if (!isAdmin(user)) return json({ error: '권한이 없습니다.' }, 403);

    const rows = await env.DB.prepare(
      `SELECT c.*, COUNT(u.id) as user_count
       FROM companies c
       LEFT JOIN users u ON u.company_id = c.id AND u.is_active = 1
       WHERE c.is_active = 1
       GROUP BY c.id
       ORDER BY c.name`
    ).all();

    return json({ companies: rows.results });
  }

  // POST /api/companies — 생성 (superadmin)
  if (path === '/api/companies' && method === 'POST') {
    if (!isSuperAdmin(user)) return json({ error: '슈퍼관리자만 생성할 수 있습니다.' }, 403);

    const { name, type, contact, memo } = await request.json();
    if (!name?.trim()) return json({ error: '관계사명을 입력하세요.' }, 400);

    const result = await env.DB.prepare(
      `INSERT INTO companies (name, type, contact, memo) VALUES (?, ?, ?, ?)`
    ).bind(name.trim(), type || 'other', contact || '', memo || '').run();

    return json({ message: '관계사가 생성되었습니다.', id: result.meta.last_row_id }, 201);
  }

  // PATCH /api/companies/:id
  const matchPatch = path.match(/^\/api\/companies\/(\d+)$/);
  if (matchPatch && method === 'PATCH') {
    if (!isAdmin(user)) return json({ error: '권한이 없습니다.' }, 403);

    const id   = parseInt(matchPatch[1]);
    const body = await request.json();
    const { name, type, contact, memo } = body;

    const fields = [];
    const binds  = [];
    if (name    !== undefined) { fields.push('name = ?');    binds.push(name); }
    if (type    !== undefined) { fields.push('type = ?');    binds.push(type); }
    if (contact !== undefined) { fields.push('contact = ?'); binds.push(contact); }
    if (memo    !== undefined) { fields.push('memo = ?');    binds.push(memo); }
    if (!fields.length) return json({ error: '변경할 항목이 없습니다.' }, 400);

    binds.push(id);
    await env.DB.prepare(`UPDATE companies SET ${fields.join(', ')} WHERE id = ?`)
      .bind(...binds).run();

    return json({ message: '관계사 정보가 수정되었습니다.' });
  }

  // DELETE /api/companies/:id
  const matchDel = path.match(/^\/api\/companies\/(\d+)$/);
  if (matchDel && method === 'DELETE') {
    if (!isSuperAdmin(user)) return json({ error: '슈퍼관리자만 삭제할 수 있습니다.' }, 403);
    const id = parseInt(matchDel[1]);
    await env.DB.prepare('UPDATE companies SET is_active = 0 WHERE id = ?').bind(id).run();
    return json({ message: '관계사가 비활성화되었습니다.' });
  }

  return json({ error: '존재하지 않는 관계사 API입니다.' }, 404);
}
