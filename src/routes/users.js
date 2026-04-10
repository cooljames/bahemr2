/**
 * users.js — 사용자 관련 API 핸들러
 *
 * 주요 수정사항:
 * - PATCH /api/users/profile: profile_image Base64 크기 검증 추가
 * D1 row 한계(~1MB)를 고려, Base64 문자열 800KB 초과 시 400 반환
 * - profile_image 컬럼 없는 환경 safe fallback
 */
import { json } from '../index.js';
// 💡 수정됨: crypto.js를 삭제하고, auth.js에서 hashPassword를 가져옵니다.
import { isAdmin, isSuperAdmin, hashPassword } from '../utils/auth.js';

// profile_image 컬럼 존재 캐시
let _hasProfileImageCol = null;

async function hasProfileImageColumn(env) {
  if (_hasProfileImageCol !== null) return _hasProfileImageCol;
  try {
    const info = await env.DB.prepare("PRAGMA table_info(users)").all();
    _hasProfileImageCol = (info.results || []).some(col => col.name === 'profile_image');
  } catch {
    _hasProfileImageCol = false;
  }
  return _hasProfileImageCol;
}

// Base64 문자열의 실제 바이트 크기 추정
function base64ByteSize(b64str) {
  if (!b64str) return 0;
  const padding = (b64str.endsWith('==') ? 2 : b64str.endsWith('=') ? 1 : 0);
  return Math.floor(b64str.length * 3 / 4) - padding;
}

// profile_image를 웹용 크기(max 200x200)로 리사이즈하는 함수
// Cloudflare Worker 환경에서는 Canvas API 없으므로, 클라이언트에서 리사이즈 후 전송하는 방식 권장
// 여기서는 크기 검증만 수행
const MAX_PROFILE_IMAGE_BYTES = 600 * 1024; // 600KB (Base64 후 ~800KB)

export async function handleUsers(request, env, user, path) {
  const method = request.method;
  const url    = new URL(request.url);

  // ── GET /api/users — 목록 (admin 이상) ─────────────────────────
  if (path === '/api/users' && method === 'GET') {
    if (!isAdmin(user)) return json({ error: '권한이 없습니다.' }, 403);

    const role  = url.searchParams.get('role')  || null;
    const limit = parseInt(url.searchParams.get('limit') || '100');

    let query  = 'SELECT u.id, u.email, u.name, u.role, u.is_active, u.created_at, c.name as company_name, u.company_id FROM users u LEFT JOIN companies c ON c.id = u.company_id';
    const params = [];
    if (role) { query += ' WHERE u.role = ?'; params.push(role); }
    query += ' ORDER BY u.created_at DESC LIMIT ?';
    params.push(limit);

    const rows = await env.DB.prepare(query).bind(...params).all();
    return json({ users: rows.results || [] });
  }

  // ── GET /api/users/:id ──────────────────────────────────────────
  const matchId = path.match(/^\/api\/users\/(\d+)$/);
  if (matchId && method === 'GET') {
    if (!isAdmin(user)) return json({ error: '권한이 없습니다.' }, 403);
    const uid = parseInt(matchId[1]);
    const u   = await env.DB.prepare(
      'SELECT u.*, c.name as company_name FROM users u LEFT JOIN companies c ON c.id = u.company_id WHERE u.id = ?'
    ).bind(uid).first();
    if (!u) return json({ error: '사용자를 찾을 수 없습니다.' }, 404);
    const { password: _, ...safe } = u;
    return json({ user: safe });
  }

  // ── PATCH /api/users/profile — 본인 프로필 수정 ─────────────────
  if (path === '/api/users/profile' && method === 'PATCH') {
    let body;
    try { body = await request.json(); }
    catch { return json({ error: '잘못된 요청입니다.' }, 400); }

    const { name, password, profile_image } = body;

    if (!name || !name.trim()) {
      return json({ error: '이름을 입력하세요.' }, 400);
    }

    // 비밀번호 변경 요청 시 검증
    let hashedPw = null;
    if (password) {
      if (password.length < 6) {
        return json({ error: '비밀번호는 6자 이상이어야 합니다.' }, 400);
      }
      hashedPw = await hashPassword(password);
    }

    // 프로필 이미지 크기 검증
    // profile_image는 'data:image/jpeg;base64,...' 형식
    if (profile_image !== undefined && profile_image !== null && profile_image !== '') {
      // data URI에서 base64 부분만 추출
      const b64part = profile_image.includes(',')
        ? profile_image.split(',')[1]
        : profile_image;

      const byteSize = base64ByteSize(b64part);
      if (byteSize > MAX_PROFILE_IMAGE_BYTES) {
        return json({
          error: `프로필 이미지가 너무 큽니다. (${Math.round(byteSize/1024)}KB → 최대 600KB)\n` +
                 '이미지를 더 작게 줄이거나 압축 후 다시 시도해주세요.'
        }, 400);
      }
    }

    // profile_image 컬럼 존재 여부 확인
    const withProfileImg = await hasProfileImageColumn(env);

    try {
      if (withProfileImg) {
        // profile_image가 명시적으로 전달된 경우 업데이트, 아니면 유지
        if (profile_image !== undefined) {
          // '' 이면 NULL (이미지 삭제), data URI면 저장
          const imgValue = profile_image === '' ? null : profile_image;

          if (hashedPw) {
            await env.DB.prepare(
              'UPDATE users SET name = ?, password = ?, profile_image = ?, updated_at = datetime("now") WHERE id = ?'
            ).bind(name.trim(), hashedPw, imgValue, user.sub).run();
          } else {
            await env.DB.prepare(
              'UPDATE users SET name = ?, profile_image = ?, updated_at = datetime("now") WHERE id = ?'
            ).bind(name.trim(), imgValue, user.sub).run();
          }
        } else {
          // profile_image 미전달 → 이름/비밀번호만 수정
          if (hashedPw) {
            await env.DB.prepare(
              'UPDATE users SET name = ?, password = ?, updated_at = datetime("now") WHERE id = ?'
            ).bind(name.trim(), hashedPw, user.sub).run();
          } else {
            await env.DB.prepare(
              'UPDATE users SET name = ?, updated_at = datetime("now") WHERE id = ?'
            ).bind(name.trim(), user.sub).run();
          }
        }
      } else {
        // profile_image 컬럼 없는 환경
        if (hashedPw) {
          await env.DB.prepare(
            'UPDATE users SET name = ?, password = ?, updated_at = datetime("now") WHERE id = ?'
          ).bind(name.trim(), hashedPw, user.sub).run();
        } else {
          await env.DB.prepare(
            'UPDATE users SET name = ?, updated_at = datetime("now") WHERE id = ?'
          ).bind(name.trim(), user.sub).run();
        }
      }

      // 업데이트된 사용자 정보 반환 (password 제외)
      const updated = await env.DB.prepare(
        `SELECT u.id, u.email, u.name, u.role, u.company_id, u.is_active, u.created_at, u.updated_at,
                ${withProfileImg ? 'u.profile_image,' : ''}
                c.name as company_name
         FROM users u
         LEFT JOIN companies c ON c.id = u.company_id
         WHERE u.id = ?`
      ).bind(user.sub).first();

      return json({ message: '프로필이 업데이트되었습니다.', user: updated });
    } catch (e) {
      console.error('profile update error:', e);
      return json({ error: '프로필 업데이트 중 오류가 발생했습니다: ' + e.message }, 500);
    }
  }

  // ── PATCH /api/users/:id — 관리자가 사용자 수정 ─────────────────
  if (matchId && method === 'PATCH') {
    if (!isAdmin(user)) return json({ error: '권한이 없습니다.' }, 403);
    const uid = parseInt(matchId[1]);

    let body;
    try { body = await request.json(); }
    catch { return json({ error: '잘못된 요청입니다.' }, 400); }

    const { role, company_id, is_active } = body;

    // superadmin 역할 부여는 superadmin만
    if (role === 'superadmin' && !isSuperAdmin(user)) {
      return json({ error: 'superadmin 역할은 슈퍼관리자만 부여할 수 있습니다.' }, 403);
    }

    const fields = [];
    const params = [];
    if (role !== undefined)       { fields.push('role = ?');       params.push(role); }
    if (company_id !== undefined) { fields.push('company_id = ?'); params.push(company_id); }
    if (is_active !== undefined)  { fields.push('is_active = ?');  params.push(is_active ? 1 : 0); }

    if (!fields.length) return json({ error: '수정할 항목이 없습니다.' }, 400);

    fields.push('updated_at = datetime("now")');
    params.push(uid);

    await env.DB.prepare(
      `UPDATE users SET ${fields.join(', ')} WHERE id = ?`
    ).bind(...params).run();

    return json({ message: '사용자 정보가 수정되었습니다.' });
  }

  // ── DELETE /api/users/:id (비활성화) ────────────────────────────
  if (matchId && method === 'DELETE') {
    if (!isSuperAdmin(user)) return json({ error: '슈퍼관리자만 삭제할 수 있습니다.' }, 403);
    const uid = parseInt(matchId[1]);
    await env.DB.prepare(
      'UPDATE users SET is_active = 0, updated_at = datetime("now") WHERE id = ?'
    ).bind(uid).run();
    return json({ message: '사용자가 비활성화되었습니다.' });
  }

  return json({ error: '존재하지 않는 사용자 API입니다.' }, 404);
}
