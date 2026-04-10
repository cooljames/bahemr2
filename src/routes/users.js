import { json } from '../index.js';
import { isAdmin, isSuperAdmin, hashPassword } from '../utils/auth.js';

/**
 * 사용자 정보 및 권한 관리 라우터
 */
export async function handleUsers(request, env, authUser, path) {
  const method = request.method;
  const userId = authUser.id || authUser.sub; // JWT 호환성

  // ── 1. 내 프로필 조회 (GET /api/profile 또는 GET /api/users/me) ────────
  if ((path === '/api/profile' || path === '/api/users/me') && method === 'GET') {
    const stmt = env.DB.prepare(`
      SELECT u.id, u.email, u.name, u.role, u.company_id, u.profile_image, u.created_at, c.name as company_name
      FROM users u
      LEFT JOIN companies c ON u.company_id = c.id
      WHERE u.id = ? AND u.is_active = 1
    `);
    
    const userData = await stmt.bind(userId).first();
    if (!userData) return json({ error: '사용자를 찾을 수 없거나 비활성화되었습니다.' }, 404);
    
    return json({ user: userData });
  }

  // ── 2. 내 프로필 수정 (PATCH /api/profile 또는 PATCH /api/users/me) ──────
  if ((path === '/api/profile' || path === '/api/users/me') && (method === 'PATCH' || method === 'PUT')) {
    try {
      const body = await request.json();
      const updates = [];
      const binds = [];

      if (body.name !== undefined) {
        updates.push('name = ?');
        binds.push(body.name);
      }
      if (body.password) {
        const hashed = await hashPassword(body.password);
        updates.push('password = ?');
        binds.push(hashed);
      }
      if (body.profile_image !== undefined) {
        updates.push('profile_image = ?');
        binds.push(body.profile_image);
      }

      if (updates.length === 0) {
        return json({ error: '수정할 데이터가 전달되지 않았습니다.' }, 400);
      }

      updates.push("updated_at = datetime('now')");
      binds.push(userId); 

      const query = `UPDATE users SET ${updates.join(', ')} WHERE id = ?`;
      await env.DB.prepare(query).bind(...binds).run();

      return json({ message: '프로필이 성공적으로 업데이트되었습니다.' });
    } catch (err) {
      console.error('[Profile Update Error]', err);
      return json({ error: '프로필 업데이트 중 서버 오류가 발생했습니다.' }, 500);
    }
  }

  // ── 3. 전체 사용자 목록 조회 (GET /api/users) - 관리자 전용 ────────────
  if (path === '/api/users' && method === 'GET') {
    if (!isAdmin(authUser)) {
      return json({ error: '접근 권한이 없습니다. (관리자 이상 필요)' }, 403);
    }

    const { results } = await env.DB.prepare(`
      SELECT u.id, u.email, u.name, u.role, u.company_id, u.is_active, u.created_at, c.name as company_name
      FROM users u
      LEFT JOIN companies c ON u.company_id = c.id
      ORDER BY u.created_at DESC
    `).all();

    return json({ users: results || [] });
  }

  // ── 4. 특정 사용자 정보/권한 수정 (PATCH /api/users/:id) - 최고 관리자 전용 ──
  const match = path.match(/^\/api\/users\/(\d+)$/);
  if (match && method === 'PATCH') {
    if (!isSuperAdmin(authUser)) {
      return json({ error: '권한 및 소속 수정은 최고 관리자(superadmin)만 가능합니다.' }, 403);
    }

    const targetUserId = parseInt(match[1], 10);
    try {
      const body = await request.json();
      const updates = [];
      const binds = [];

      const updatableFields = ['role', 'company_id', 'is_active'];
      updatableFields.forEach(field => {
        if (body[field] !== undefined) {
          updates.push(`${field} = ?`);
          binds.push(body[field]);
        }
      });

      if (updates.length === 0) return json({ error: '수정할 데이터가 없습니다.' }, 400);

      updates.push("updated_at = datetime('now')");
      binds.push(targetUserId);

      const query = `UPDATE users SET ${updates.join(', ')} WHERE id = ?`;
      await env.DB.prepare(query).bind(...binds).run();

      return json({ message: '사용자 정보가 성공적으로 수정되었습니다.' });
    } catch (err) {
      console.error('[User Admin Update Error]', err);
      return json({ error: '사용자 상태 업데이트 중 오류가 발생했습니다.' }, 500);
    }
  }

  // 위 라우트에 걸리지 않은 모든 요청
  return json({ error: '지원하지 않는 사용자 API 요청입니다.' }, 405);
}
