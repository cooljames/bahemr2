import { json } from '../index.js';

export async function handleComments(request, env, user, path) {
  const method = request.method;
  const url    = new URL(request.url);

  // GET /api/comments?post_id=
  if (path === '/api/comments' && method === 'GET') {
    const post_id = url.searchParams.get('post_id');
    if (!post_id) return json({ error: 'post_id가 필요합니다.' }, 400);

    const rows = await env.DB.prepare(
      `SELECT c.id, c.post_id, c.content, c.parent_id, c.created_at, c.updated_at, c.is_deleted,
              u.id as author_id, u.name as author_name, u.role as author_role
       FROM comments c
       JOIN users u ON u.id = c.author_id
       WHERE c.post_id = ?
       ORDER BY c.created_at ASC`
    ).bind(post_id).all();

    // 삭제된 댓글은 내용 숨김.
    const comments = rows.results.map(c => ({
      ...c,
      content: c.is_deleted ? '(삭제된 댓글입니다.)' : c.content,
      can_edit:   !c.is_deleted && c.author_id === user.sub,
      can_delete: !c.is_deleted && c.author_id === user.sub
    }));

    return json({ comments });
  }

  // POST /api/comments — 댓글 작성
  if (path === '/api/comments' && method === 'POST') {
    const { post_id, content, parent_id } = await request.json();
    if (!post_id || !content?.trim()) return json({ error: 'post_id와 내용을 입력하세요.' }, 400);
    if (content.trim().length > 2000) return json({ error: '댓글은 2000자 이내로 작성하세요.' }, 400);

    // 게시글 존재 확인
    const post = await env.DB.prepare('SELECT id FROM posts WHERE id = ?').bind(post_id).first();
    if (!post) return json({ error: '게시글을 찾을 수 없습니다.' }, 404);

    const result = await env.DB.prepare(
      `INSERT INTO comments (post_id, author_id, content, parent_id) VALUES (?, ?, ?, ?)`
    ).bind(post_id, user.sub, content.trim(), parent_id || null).run();

    return json({ message: '댓글이 작성되었습니다.', id: result.meta.last_row_id }, 201);
  }

  // PATCH /api/comments/:id — 수정
  const matchPatch = path.match(/^\/api\/comments\/(\d+)$/);
  if (matchPatch && method === 'PATCH') {
    const commentId = parseInt(matchPatch[1]);
    const comment   = await env.DB.prepare('SELECT * FROM comments WHERE id = ?').bind(commentId).first();
    if (!comment) return json({ error: '댓글을 찾을 수 없습니다.' }, 404);
    if (comment.author_id !== user.sub) return json({ error: '수정 권한이 없습니다.' }, 403);
    if (comment.is_deleted) return json({ error: '삭제된 댓글은 수정할 수 없습니다.' }, 400);

    const { content } = await request.json();
    if (!content?.trim()) return json({ error: '내용을 입력하세요.' }, 400);

    await env.DB.prepare(
      `UPDATE comments SET content = ?, updated_at = datetime('now') WHERE id = ?`
    ).bind(content.trim(), commentId).run();

    return json({ message: '댓글이 수정되었습니다.' });
  }

  // DELETE /api/comments/:id — 삭제 (soft delete)
  const matchDel = path.match(/^\/api\/comments\/(\d+)$/);
  if (matchDel && method === 'DELETE') {
    const commentId = parseInt(matchDel[1]);
    const comment   = await env.DB.prepare('SELECT * FROM comments WHERE id = ?').bind(commentId).first();
    if (!comment) return json({ error: '댓글을 찾을 수 없습니다.' }, 404);
    if (comment.author_id !== user.sub) return json({ error: '삭제 권한이 없습니다.' }, 403);

    await env.DB.prepare(
      `UPDATE comments SET is_deleted = 1, updated_at = datetime('now') WHERE id = ?`
    ).bind(commentId).run();

    return json({ message: '댓글이 삭제되었습니다.' });
  }

  return json({ error: '존재하지 않는 댓글 API입니다.' }, 404);
}
