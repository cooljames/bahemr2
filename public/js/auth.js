import { json } from '../index.js';
import { signJWT, hashPassword, checkPassword, verifyJWT } from '../utils/auth.js';

/**
 * 인증 관련 라우터 (로그인, 회원가입, 내 정보 조회)
 */
export async function handleAuth(request, env, path) {
  const method = request.method;

  // ── 1. 로그인 (POST /api/auth/login) ──────────────────────────────
  if (path === '/api/auth/login') {
    if (method !== 'POST') return json({ error: '잘못된 요청 방식입니다.' }, 405);

    try {
      const { email, password } = await request.json();
      if (!email || !password) return json({ error: '이메일과 비밀번호를 입력하세요.' }, 400);

      // DB 조회 (is_active가 1인 활성 사용자만)
      const user = await env.DB.prepare(
        `SELECT u.*, c.name as company_name
         FROM users u
         LEFT JOIN companies c ON c.id = u.company_id
         WHERE u.email = ? AND u.is_active = 1`
      ).bind(email.trim().toLowerCase()).first();

      if (!user) return json({ error: '이메일 또는 비밀번호가 올바르지 않습니다.' }, 401);

      // 비밀번호 검증
      const ok = await checkPassword(password, user.password);
      if (!ok) return json({ error: '이메일 또는 비밀번호가 올바르지 않습니다.' }, 401);

      // 승인 상태 확인
      if (user.role === 'pending') {
        return json({ error: '관리자 승인 대기 중입니다. 담당자에게 문의하세요.' }, 403);
      }

      // JWT 발급
      const secretKey = env.JWT_SECRET || 'my_temporary_secret_key_12345';
      const token = await signJWT({
        sub: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        company_id: user.company_id
      }, secretKey);

      return json({
        token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          company_id: user.company_id,
          company_name: user.company_name,
          profile_image: user.profile_image || null
        }
      });
    } catch (err) {
      return json({ error: '로그인 처리 중 오류: ' + err.message }, 500);
    }
  }

  // ── 2. 회원가입 (POST /api/auth/signup) ────────────────────────────
  if (path === '/api/auth/signup') {
    if (method !== 'POST') return json({ error: '잘못된 요청 방식입니다.' }, 405);

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
      return json({ error: '회원가입 처리 중 오류: ' + err.message }, 500);
    }
  }

  // ── 3. 내 정보 확인 (GET /api/auth/me) ─────────────────────────────
  if (path === '/api/auth/me' && method === 'GET') {
    try {
      const user = await verifyJWT(request, env);
      if (!user) return json({ error: '인증이 필요합니다.' }, 401);

      const dbUser = await env.DB.prepare(
        `SELECT u.id, u.email, u.name, u.role, u.company_id, u.is_active, u.profile_image,
                c.name as company_name, c.type as company_type
         FROM users u
         LEFT JOIN companies c ON c.id = u.company_id
         WHERE u.id = ?`
      ).bind(user.sub || user.id).first();

      if (!dbUser) return json({ error: '사용자를 찾을 수 없습니다.' }, 404);
      return json({ user: dbUser });
    } catch (err) {
      return json({ error: '정보 조회 중 오류: ' + err.message }, 500);
    }
  }

  // ── 4. 공개 관계사 목록 (GET /api/auth/companies-public) ───────────
  if (path === '/api/auth/companies-public' && method === 'GET') {
    try {
      const { results } = await env.DB.prepare(
        `SELECT id, name, type FROM companies WHERE is_active = 1 ORDER BY name`
      ).all();
      return json({ companies: results });
    } catch (err) {
      return json({ error: '목록 조회 중 오류: ' + err.message }, 500);
    }
  }

  return json({ error: '존재하지 않는 API입니다.' }, 404);
}
