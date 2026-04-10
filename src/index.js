/**
 * bahemr2 사전접수 포털 — Cloudflare Workers 메인 엔트리
 * 수정일: 2026-04-10
 */
import { handleAuth }        from './routes/auth.js';
import { handleUsers }       from './routes/users.js';
import { handleCompanies }   from './routes/companies.js';
import { handleBoards }      from './routes/boards.js';
import { handlePosts }       from './routes/posts.js';
import { handleComments }    from './routes/comments.js';
import { handleAttachments } from './routes/attachments.js';
import { handleStats }       from './routes/stats.js';
import { verifyJWT, corsHeaders } from './utils/auth.js';

// ── 공통 응답 함수 ────────────────────────────────────────────
export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

export default {
  async fetch(request, env, ctx) {
    const url    = new URL(request.url);
    const path   = url.pathname;
    const method = request.method;

    // ── CORS preflight 처리 ───────────────────────────────────
    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // ── 정적 파일 처리 (프론트엔드 에셋) ──────────────────────
    if (!path.startsWith('/api/')) {
      return env.ASSETS.fetch(request);
    }

    // ── API 라우팅 ────────────────────────────────────────────
    try {
      // 1. 인증이 필요 없는 API (로그인, 회원가입, 공개 관계사 목록 등)
      if (path.startsWith('/api/auth/')) {
        return handleAuth(request, env, path);
      }

      // 2. 이하 모든 API는 JWT 인증(Authentication) 검증
      // EMR 보안 요건에 따라 토큰 누락 및 변조 시 401 즉시 반환
      const user = await verifyJWT(request, env);
      if (!user) {
        return json({ error: '인증이 필요하거나 세션이 만료되었습니다.' }, 401);
      }

      // 3. 도메인별 핸들러로 분기
      // 🔥 [수정됨] 프론트엔드에서 /api/user(단수) 혹은 /api/profile 로 호출하더라도 users.js 에서 처리하도록 라우팅 조건 확장
      if (
        path.startsWith('/api/users') || 
        path.startsWith('/api/user') || 
        path.startsWith('/api/profile')
      ) {
        return handleUsers(request, env, user, path);
      }
      
      if (path.startsWith('/api/companies'))   return handleCompanies(request, env, user, path);
      if (path.startsWith('/api/boards'))      return handleBoards(request, env, user, path);
      if (path.startsWith('/api/posts'))       return handlePosts(request, env, user, path);
      if (path.startsWith('/api/comments'))    return handleComments(request, env, user, path);
      if (path.startsWith('/api/attachments')) return handleAttachments(request, env, user, path);
      if (path.startsWith('/api/stats'))       return handleStats(request, env, user, path);

      // 4. 매핑되지 않은 API (404 처리)
      return json({ error: '존재하지 않는 사용자 API입니다.' }, 404);
      
    } catch (err) {
      // 5. 전역 에러 핸들링
      console.error(`[API Error] ${method} ${path}:`, err);
      return json({ error: '서버 내부 오류가 발생했습니다. 관리자에게 문의하세요.' }, 500);
    }
  }
};
