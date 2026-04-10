import { signJWT, hashPassword, checkPassword, verifyJWT, corsHeaders } from '../utils/auth.js';

// 내부용 응답 함수 (순환 참조 방지).
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' }
});

export async function handleAuth(request, env, path) {
  const method = request.method;

  // POST /api/auth/login
  if (path === '/api/auth/login' && method === 'POST') {
    try {
      const { email, password } = await request.json();
      if (!email || !password) return json({ error: '이메일과 비밀번호를 입력하세요.' }, 400);

      const user = await env.DB.prepare(
        `SELECT u.*, c.name as company_name
         FROM users u
         LEFT JOIN companies c ON c.id = u.company_id
         WHERE u.email = ? AND u.is_active = 1`
      ).bind(email.trim().toLowerCase()).first();

      if (!user) return json({ error: '이메일 또는 비밀번호가 올바르지 않습니다.' }, 401);

      const ok = await checkPassword(password, user.password);
      if (!ok) return json({ error: '이메일 또는 비밀번호가 올바르지 않습니다.' }, 401);

      if (user.role === 'pending') {
        return json({ error: '관리자 승인 대기 중입니다.' }, 403);
      }

      const secretKey = env.JWT_SECRET || 'fallback_secret_key';
      const token = await signJWT({
        sub: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        company_id: user.company_id,
        exp: Math.floor(Date.now() / 1000) + (60 * 60 * 24 * 7)
      }, secretKey);

      return json({
        token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          company_id: user.company_id,
          company_name: user.company_name
        }
      });
    } catch (err) {
      return json({ error: '로그인 처리 에러: ' + err.message }, 500);
    }
  }

  // POST /api/auth/signup
  if (path === '/api/auth/signup' && method === 'POST') {
    try {
      const { email, password, name, company_id } = await request.json();
      if (!email || !password || !name) return json({ error: '필수 항목을 모두 입력하세요.' }, 400);
      
      const exists = await env.DB.prepare('SELECT id FROM users WHERE email = ?')
        .bind(email.trim().toLowerCase()).first();
      if (exists) return json({ error: '이미 사용 중인 이메일입니다.' }, 409);

      const hashed = await hashPassword(password);
      await env.DB.prepare(
        `INSERT INTO users (email, password, name, role, company_id)
         VALUES (?, ?, ?, 'pending', ?)`
      ).bind(email.trim().toLowerCase(), hashed, name.trim(), company_id || null).run();

      return json({ message: '회원가입 완료. 관리자 승인을 기다려주세요.' }, 201);
    } catch (err) {
      return json({ error: '회원가입 처리 에러: ' + err.message }, 500);
    }
  }

  // GET /api/auth/me
  if (path === '/api/auth/me' && method === 'GET') {
    const user = await verifyJWT(request, env);
    if (!user) return json({ error: '인증 필요' }, 401);
    
    const dbUser = await env.DB.prepare(
      `SELECT u.id, u.email, u.name, u.role, u.company_id, c.name as company_name
       FROM users u LEFT JOIN companies c ON c.id = u.company_id WHERE u.id = ?`
    ).bind(user.sub).first();
    
    return json({ user: dbUser });
  }

  return json({ error: '존재하지 않는 인증 API입니다.' }, 404);
}
