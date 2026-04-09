/**
 * JWT 인증 유틸리티
 * Workers 환경: Web Crypto API 사용 (Node.js crypto 불가)
 */

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};

// ── JWT 생성 ──────────────────────────────────────────────────
export async function signJWT(payload, secret) {
  const header  = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body    = b64url(JSON.stringify({ ...payload, iat: Math.floor(Date.now() / 1000) }));
  const signing = `${header}.${body}`;
  const key     = await importKey(secret);
  const sig     = await crypto.subtle.sign('HMAC', key, enc(signing));
  return `${signing}.${b64url(sig)}`;
}

// ── JWT 검증 ──────────────────────────────────────────────────
export async function verifyJWT(request, env) {
  const authHeader = request.headers.get('Authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return null;

  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const secret = env.JWT_SECRET || 'my_temporary_secret_key_12345';
    const key  = await importKey(secret);
    const sig  = b64urlDecode(parts[2]);
    const data = enc(`${parts[0]}.${parts[1]}`);
    const ok   = await crypto.subtle.verify('HMAC', key, sig, data);
    if (!ok) return null;

    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(escape(atob(base64)));
    const payload = JSON.parse(jsonPayload);

    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

// ── 비밀번호 해싱 (SHA-256 기반) ──────────────────────────────
export async function hashPassword(password) {
  const data   = enc(password + ':bahemr-salt');
  const buffer = await crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}

export async function checkPassword(password, hash) {
  return (await hashPassword(password)) === hash;
}

// ── 권한 확인 헬퍼 ────────────────────────────────────────────
export function isSuperAdmin(user) { return user.role === 'superadmin'; }
export function isAdmin(user)      { return ['superadmin','admin'].includes(user.role); }
export function isStaff(user)      { return ['superadmin','admin','staff'].includes(user.role); }
export function isActive(user)     { return user.is_active === 1 && user.role !== 'pending'; }

// ── 내부 유틸 ─────────────────────────────────────────────────
function enc(str) { return new TextEncoder().encode(str); }

function b64url(data) {
  const str = data instanceof ArrayBuffer
    ? btoa(String.fromCharCode(...new Uint8Array(data)))
    : btoa(unescape(encodeURIComponent(typeof data === 'string' ? data : JSON.stringify(data))));
  return str.replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
}

function b64urlDecode(str) {
  const padded = str.replace(/-/g,'+').replace(/_/g,'/');
  const binary = atob(padded);
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}

async function importKey(secret) {
  return crypto.subtle.importKey(
    'raw', enc(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign','verify']
  );
}
