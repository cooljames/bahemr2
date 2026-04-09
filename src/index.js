/**
 * bahEMR 사전접수 포털 — Cloudflare Workers 메인 엔트리
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

export default {
  async fetch(request, env, ctx) {
    const url    = new URL(request.url);
    const path   = url.pathname;
    const method = request.method;

    // CORS preflight
    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // ── 정적 파일 (Workers Sites / __STATIC_CONTENT) ──────────────
    if (!path.startsWith('/api/')) {
      return env.ASSETS.fetch(request);
    }

    // ── API 라우팅 ─────────────────────────────────────────────────
    try {
      // 인증 불필요 엔드포인트
      if (path.startsWith('/api/auth/')) {
        return handleAuth(request, env, path);
      }

      // 이하 모든 API는 JWT 인증 필요
      const user = await verifyJWT(request, env);
      if (!user) {
        return json({ error: '인증이 필요합니다.' }, 401);
      }

      if (path.startsWith('/api/users'))       return handleUsers(request, env, user, path);
      if (path.startsWith('/api/companies'))   return handleCompanies(request, env, user, path);
      if (path.startsWith('/api/boards'))      return handleBoards(request, env, user, path);
      if (path.startsWith('/api/posts'))       return handlePosts(request, env, user, path);
      if (path.startsWith('/api/comments'))    return handleComments(request, env, user, path);
      if (path.startsWith('/api/attachments')) return handleAttachments(request, env, user, path);
      if (path.startsWith('/api/stats'))       return handleStats(request, env, user, path);

      return json({ error: '존재하지 않는 API입니다.' }, 404);

    } catch (err) {
      console.error('API Error:', err);
      return json({ error: '서버 오류가 발생했습니다.', detail: err.message }, 500);
    }
  }
};

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}
