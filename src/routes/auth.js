import { json } from '../index.js';
import { signJWT, hashPassword, checkPassword } from '../utils/auth.js';

export async function handleAuth(request, env, path) {
  const method = request.method;

  // POST /api/auth/login
  if (path === '/api/auth/login' && method === 'POST') {
    try {
      const { email, password } = await request.json();
      if (!email || !password) return json({ error: '이메일과 비밀번호를 입력하세요.' }, 400);

      // 1. DB 조회 에러 추적
      let user;
      try {
        user = await env.DB.prepare(
          `SELECT u.*, c.name as company_name
           FROM users u
           LEFT JOIN companies c ON c.id = u.company_id
           WHERE u.email = ? AND u.is_active = 1`
        ).bind(email.trim().toLowerCase()).first();
      } catch (dbErr) {
        return json({ error: 'DB 조회 에러: ' + dbErr.message }, 500);
      }

      if (!user) return json({ error: '이메일 또는 비밀번호가 올바르지 않습니다.' }, 401);

      const ok = await checkPassword(password, user.password);
      if (!ok) return json({ error: '이메일 또는 비밀번호가 올바르지 않습니다.' }, 401);

      if (user.role === 'pending') {
        return json({ error: '관리자 승인 대기 중입니다. 담당자에게 문의하세요.' }, 403);
      }

      // 2. JWT 발급 에러 추적
      let token;
      try {
        token = await signJWT({
          sub:        user.id,
          email:      user.email,
          name:       user.name,
          role:       user.role,
          company_id: user.company_id,
          exp:        Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7  // 7일
        }, env.JWT_SECRET);
      } catch (jwtErr) {
        return json({ error: '토큰 발급 에러: ' + jwtErr.message }, 500);
      }

      return json({
        token,
        user: {
          id:           user.id,
          email:        user.email,
          name:         user.name,
          role:         user.role,
          company_id:   user.company_id,
          company_name: user.company_name
        }
      });

    } catch (err) {
      return json({ error: '서버 내부 에러(JSON 파싱 등): ' + err.message }, 500);
    }
  }

  // POST /api/auth/signup
  if (path === '/api/auth/signup' && method === 'POST') {
    try {
      const { email, password, name, company_id } = await request.json();
      if (!email || !password || !name) return json({ error: '필수 항목을 모두 입력하세요.' }, 400);
      if (password.length < 8) return json({ error: '비밀번호는 8자 이상이어야 합니다.' }, 400);

      const exists = await env.DB.prepare('SELECT id FROM users WHERE email = ?')
        .bind(email.trim().toLowerCase()).first();
      if (exists) return json({ error: '이미 사용 중인 이메일입니다.' }, 409);

      const hashed = await hashPassword(password);
      await env.DB.prepare(
        `INSERT INTO users (email, password, name, role, company_id)
         VALUES (?, ?, ?, 'pending', ?)`
      ).bind(email.trim().toLowerCase(), hashed, name.trim(), company_id || null).run();

      return json({ message: '회원가입이 완료되었습니다. 관리자 승인 후 이용 가능합니다.' }, 201);
    } catch (err) {
      return json({ error: '회원가입 처리 에러: ' + err.message }, 500);
    }
  }

  // GET /api/auth/me — 토큰으로 사용자 정보 조회
  if (path === '/api/auth/me' && method === 'GET') {
    try {
      const { verifyJWT } = await import('../utils/auth.js');
      const user = await verifyJWT(request, env);
      if (!user) return json({ error: '인증이 필요합니다.' }, 401);

      const dbUser = await env.DB.prepare(
        `SELECT u.id, u.email, u.name, u.role, u.company_id, u.is_active,
                c.name as company_name, c.type as company_type
         FROM users u
         LEFT JOIN companies c ON c.id = u.company_id
         WHERE u.id = ?`
      ).bind(user.sub).first();

      if (!dbUser) return json({ error: '사용자를 찾을 수 없습니다.' }, 404);
      return json({ user: dbUser });
    } catch (err) {
      return json({ error: '사용자 정보 조회 에러: ' + err.message }, 500);
    }
  }

  // GET /api/auth/companies-public — 회원가입 시 관계사 목록 (인증 불필요)
  if (path === '/api/auth/companies-public' && method === 'GET') {
    try {
      const rows = await env.DB.prepare(
        `SELECT id, name, type FROM companies WHERE is_active = 1 ORDER BY name`
      ).all();
      return json({ companies: rows.results });
    } catch (err) {
      return json({ error: '관계사 목록 조회 에러: ' + err.message }, 500);
    }
  }

  return json({ error: '존재하지 않는 인증 API입니다.' }, 404);
}
