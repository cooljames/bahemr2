import { json } from '../index.js';
import { isAdmin, isSuperAdmin, hashPassword } from '../utils/auth.js';

// 이 부분이 가장 중요합니다! index.js에서 이 이름을 찾고 있습니다.
export async function handleUsers(request, env, authUser, path) {
  const method = request.method;
  const userId = authUser.id || authUser.sub;

  if ((path === '/api/profile' || path === '/api/users/me') && method === 'GET') {
    const stmt = env.DB.prepare(`
      SELECT u.id, u.email, u.name, u.role, u.company_id, u.profile_image, u.created_at, c.name as company_name
      FROM users u LEFT JOIN companies c ON u.company_id = c.id
      WHERE u.id = ? AND u.is_active = 1
    `);
    const userData = await stmt.bind(userId).first();
    if (!userData) return json({ error: '사용자를 찾을 수 없습니다.' }, 404);
    return json({ user: userData });
  }

  if ((path === '/api/profile' || path === '/api/users/me') && (method === 'PATCH' || method === 'PUT')) {
    try {
      const body = await request.json();
      const updates = [];
      const binds = [];

      if (body.name !== undefined) { updates.push('name = ?'); binds.push(body.name); }
      if (body.password) { 
        const hashed = await hashPassword(body.password);
        updates.push('password = ?'); binds.push(hashed); 
      }
      if (body.profile_image !== undefined) { updates.push('profile_image = ?'); binds.push(body.profile_image); }

      if (updates.length === 0) return json({ error: '수정할 데이터가 없습니다.' }, 400);

      updates.push("updated_at = datetime('now')");
      binds.push(userId); 

      await env.DB.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).bind(...binds).run();
      return json({ message: '프로필이 업데이트되었습니다.' });
    } catch (err) {
      return json({ error: '프로필 업데이트 서버 오류' }, 500);
    }
  }

  if (path === '/api/users' && method === 'GET') {
    if (!isAdmin(authUser)) return json({ error: '접근 권한이 없습니다.' }, 403);
    const { results } = await env.DB.prepare(`
      SELECT u.id, u.email, u.name, u.role, u.company_id, u.is_active, u.created_at, c.name as company_name
      FROM users u LEFT JOIN companies c ON u.company_id = c.id ORDER BY u.created_at DESC
    `).all();
    return json({ users: results || [] });
  }

  const match = path.match(/^\/api\/users\/(\d+)$/);
  if (match && method === 'PATCH') {
    if (!isSuperAdmin(authUser)) return json({ error: '수정 권한이 없습니다.' }, 403);
    const targetUserId = parseInt(match[1], 10);
    try {
      const body = await request.json();
      const updates = [];
      const binds = [];

      ['role', 'company_id', 'is_active'].forEach(field => {
        if (body[field] !== undefined) { updates.push(`${field} = ?`); binds.push(body[field]); }
      });

      if (updates.length === 0) return json({ error: '데이터가 없습니다.' }, 400);
      updates.push("updated_at = datetime('now')"); binds.push(targetUserId);

      await env.DB.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).bind(...binds).run();
      return json({ message: '수정 완료되었습니다.' });
    } catch (err) {
      return json({ error: '수정 오류' }, 500);
    }
  }

  return json({ error: '잘못된 요청입니다.' }, 405);
}
