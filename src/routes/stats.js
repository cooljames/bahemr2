import { json } from '../index.js';
import { isAdmin, isStaff } from '../utils/auth.js';

export async function handleStats(request, env, user, path) {
  // GET /api/stats/dashboard
  if (path === '/api/stats/dashboard') {
    const isStaffUser = isStaff(user);

    // 전체 통계 (staff 이상)
    let userCount   = null;
    let boardCount  = null;
    if (isStaffUser) {
      const uc = await env.DB.prepare('SELECT COUNT(*) as cnt FROM users WHERE is_active = 1').first();
      const bc = await env.DB.prepare('SELECT COUNT(*) as cnt FROM boards WHERE is_active = 1').first();
      userCount  = uc.cnt;
      boardCount = bc.cnt;
    }

    // 게시글 수 (role에 따라 필터)
    let postQuery = 'SELECT COUNT(*) as cnt FROM posts p';
    let postBinds = [];
    if (user.role === 'partner' && user.company_id) {
      postQuery += ' WHERE p.company_id = ?';
      postBinds.push(user.company_id);
    }
    const pc = await env.DB.prepare(postQuery).bind(...postBinds).first();

    // 상태별 접수 현황 (reception 게시판)
    let statusStats = [];
    if (isStaffUser) {
      const ss = await env.DB.prepare(
        `SELECT p.status, COUNT(*) as cnt
         FROM posts p
         JOIN boards b ON b.id = p.board_id
         WHERE b.type = 'reception'
         GROUP BY p.status`
      ).all();
      statusStats = ss.results;
    } else if (user.company_id) {
      const ss = await env.DB.prepare(
        `SELECT p.status, COUNT(*) as cnt
         FROM posts p
         JOIN boards b ON b.id = p.board_id
         WHERE b.type = 'reception' AND p.company_id = ?
         GROUP BY p.status`
      ).bind(user.company_id).all();
      statusStats = ss.results;
    }

    // 최근 게시글 5개
    let recentQuery = `
      SELECT p.id, p.title, p.status, p.created_at,
             u.name as author_name, c.name as company_name,
             b.name as board_name, b.id as board_id
      FROM posts p
      JOIN users u ON u.id = p.author_id
      LEFT JOIN companies c ON c.id = p.company_id
      JOIN boards b ON b.id = p.board_id
    `;
    let recentBinds = [];
    if (user.role === 'partner' && user.company_id) {
      recentQuery += ' WHERE p.company_id = ?';
      recentBinds.push(user.company_id);
    }
    recentQuery += ' ORDER BY p.created_at DESC LIMIT 10';

    const recent = await env.DB.prepare(recentQuery).bind(...recentBinds).all();

    return json({
      user_count:   userCount,
      board_count:  boardCount,
      post_count:   pc.cnt,
      status_stats: statusStats,
      recent_posts: recent.results
    });
  }

  return json({ error: '존재하지 않는 통계 API입니다.' }, 404);
}
