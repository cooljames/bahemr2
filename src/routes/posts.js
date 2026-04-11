import { json } from '../index.js';
import { isSuperAdmin, isAdmin, isStaff } from '../utils/auth.js';

export async function handlePosts(request, env, user, path) {
  const method = request.method;
  const url    = new URL(request.url);

  // GET /api/posts?board_id=&status=&company_id=&page=
  if (path === '/api/posts' && method === 'GET') {
    const board_id   = url.searchParams.get('board_id');
    const status     = url.searchParams.get('status') || '';
    const company_id = url.searchParams.get('company_id') || '';
    const keyword    = url.searchParams.get('q') || '';
    const page       = parseInt(url.searchParams.get('page') || '1');
    const limit      = parseInt(url.searchParams.get('limit') || '20');
    const offset     = (page - 1) * limit;

    if (!board_id) return json({ error: 'board_id가 필요합니다.' }, 400);

    // 게시판 존재 + 접근권한 확인
    const board = await env.DB.prepare('SELECT * FROM boards WHERE id = ? AND is_active = 1').bind(board_id).first();
    if (!board) return json({ error: '게시판을 찾을 수 없습니다.' }, 404);

    // partner 역할은 자신의 회사 게시글만 볼 수 있음
    const isPartner = user.role === 'partner';

    let where  = ['p.board_id = ?'];
    let binds  = [board_id];
    if (status)     { where.push('p.status = ?');     binds.push(status); }
    if (keyword)    { where.push('(p.title LIKE ? OR p.content LIKE ?)'); binds.push(`%${keyword}%`, `%${keyword}%`); }
    if (isPartner && user.company_id) {
      where.push('p.company_id = ?');
      binds.push(user.company_id);
    } else if (company_id && isAdmin(user)) {
      where.push('p.company_id = ?');
      binds.push(company_id);
    }

    const whereStr = where.join(' AND ');

    const rows = await env.DB.prepare(
      `SELECT p.id, p.title, p.status, p.is_pinned, p.view_count, p.created_at, p.updated_at,
              u.name as author_name, c.name as company_name,
              a.name as assigned_name,
              (SELECT COUNT(*) FROM comments cm WHERE cm.post_id = p.id AND cm.is_deleted = 0) as comment_count,
              (SELECT COUNT(*) FROM attachments at WHERE at.post_id = p.id) as attachment_count
       FROM posts p
       JOIN users u ON u.id = p.author_id
       LEFT JOIN companies c ON c.id = p.company_id
       LEFT JOIN users a ON a.id = p.assigned_to
       WHERE ${whereStr}
       ORDER BY p.is_pinned DESC, p.created_at DESC
       LIMIT ? OFFSET ?`
    ).bind(...binds, limit, offset).all();

    const countRow = await env.DB.prepare(
      `SELECT COUNT(*) as cnt FROM posts p WHERE ${whereStr}`
    ).bind(...binds).first();

    return json({ posts: rows.results, total: countRow.cnt, page, limit });
  }

  // POST /api/posts — 게시글 작성
  if (path === '/api/posts' && method === 'POST') {
    const body = await request.json();
    const { board_id, title, content, reception_data } = body;

    if (!board_id || !title?.trim() || !content?.trim()) {
      return json({ error: '게시판, 제목, 내용은 필수입니다.' }, 400);
    }

    const board = await env.DB.prepare('SELECT * FROM boards WHERE id = ? AND is_active = 1').bind(board_id).first();
    if (!board) return json({ error: '게시판을 찾을 수 없습니다.' }, 404);

    const result = await env.DB.prepare(
      `INSERT INTO posts (board_id, author_id, company_id, title, content, status)
       VALUES (?, ?, ?, ?, ?, 'submitted')`
    ).bind(board_id, user.sub, user.company_id || null, title.trim(), content.trim()).run();

    const postId = result.meta.last_row_id;

    // 접수 게시판이고 reception_data가 있으면 저장
    if (board.type === 'reception' && reception_data) {
      const rd = reception_data;
      await env.DB.prepare(
        `INSERT INTO reception_data
          (post_id, patient_name, patient_dob, patient_gender, patient_phone, patient_nationality,
           id_type, id_number, chief_complaint, symptoms, exam_results, vessel_name, port_of_call)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).bind(
        postId,
        rd.patient_name        || null,
        rd.patient_dob         || null,
        rd.patient_gender      || null,
        rd.patient_phone       || null,
        rd.patient_nationality || null,
        rd.id_type             || null,
        rd.id_number           || null,
        rd.chief_complaint     || null,
        rd.symptoms            || null,
        rd.exam_results ? JSON.stringify(rd.exam_results) : null,
        rd.vessel_name         || null,
        rd.port_of_call        || null
      ).run();
    }

    // 상태 이력 기록
    await env.DB.prepare(
      `INSERT INTO status_history (post_id, changed_by, from_status, to_status, memo)
       VALUES (?, ?, null, 'submitted', '최초 접수')`
    ).bind(postId, user.sub).run();

    return json({ message: '게시글이 작성되었습니다.', id: postId }, 201);
  }

  // GET /api/posts/:id
  const matchGet = path.match(/^\/api\/posts\/(\d+)$/);
  if (matchGet && method === 'GET') {
    const postId = parseInt(matchGet[1]);

    const post = await env.DB.prepare(
      `SELECT p.*, u.name as author_name, u.email as author_email,
              c.name as company_name, c.type as company_type,
              a.name as assigned_name,
              b.name as board_name, b.type as board_type
       FROM posts p
       JOIN users u ON u.id = p.author_id
       LEFT JOIN companies c ON c.id = p.company_id
       LEFT JOIN users a ON a.id = p.assigned_to
       JOIN boards b ON b.id = p.board_id
       WHERE p.id = ?`
    ).bind(postId).first();

    if (!post) return json({ error: '게시글을 찾을 수 없습니다.' }, 404);

    // partner는 본인 회사 게시글만
    if (user.role === 'partner' && post.company_id !== user.company_id) {
      return json({ error: '접근 권한이 없습니다.' }, 403);
    }

    // 조회수 증가
    await env.DB.prepare('UPDATE posts SET view_count = view_count + 1 WHERE id = ?').bind(postId).run();

    // 접수 상세 데이터
    let receptionData = null;
    if (post.board_type === 'reception') {
      receptionData = await env.DB.prepare('SELECT * FROM reception_data WHERE post_id = ?').bind(postId).first();
    }

    // 첨부파일 목록
    const attachments = await env.DB.prepare(
      `SELECT id, filename, file_size, mime_type, created_at FROM attachments WHERE post_id = ? ORDER BY created_at`
    ).bind(postId).all();

    // 상태 이력
    const history = await env.DB.prepare(
      `SELECT sh.*, u.name as changed_by_name
       FROM status_history sh JOIN users u ON u.id = sh.changed_by
       WHERE sh.post_id = ? ORDER BY sh.created_at DESC`
    ).bind(postId).all();

    return json({ post, reception_data: receptionData, attachments: attachments.results, history: history.results });
  }

  // PATCH /api/posts/:id — 수정
  const matchPatch = path.match(/^\/api\/posts\/(\d+)$/);
  if (matchPatch && method === 'PATCH') {
    const postId = parseInt(matchPatch[1]);
    const post   = await env.DB.prepare('SELECT * FROM posts WHERE id = ?').bind(postId).first();
    if (!post) return json({ error: '게시글을 찾을 수 없습니다.' }, 404);

    const isOwner   = post.author_id === user.sub;
    const canEdit   = isOwner;
    if (!canEdit) return json({ error: '수정 권한이 없습니다.' }, 403);

    const body = await request.json();
    const { title, content, status, assigned_to, is_pinned, reception_data } = body;

    const fields = [];
    const binds  = [];
    if (title       !== undefined) { fields.push('title = ?');       binds.push(title); }
    if (content     !== undefined) { fields.push('content = ?');     binds.push(content); }
    if (is_pinned   !== undefined && isAdmin(user)) { fields.push('is_pinned = ?'); binds.push(is_pinned); }
    if (assigned_to !== undefined && isStaff(user)) { fields.push('assigned_to = ?'); binds.push(assigned_to); }

    // 상태 변경 (staff 이상만)
    if (status !== undefined && isStaff(user) && status !== post.status) {
      fields.push('status = ?');
      binds.push(status);
      // 이력 기록
      await env.DB.prepare(
        `INSERT INTO status_history (post_id, changed_by, from_status, to_status) VALUES (?,?,?,?)`
      ).bind(postId, user.sub, post.status, status).run();
    }

    if (fields.length) {
      fields.push('updated_at = datetime(\'now\')');
      binds.push(postId);
      await env.DB.prepare(`UPDATE posts SET ${fields.join(', ')} WHERE id = ?`).bind(...binds).run();
    }

    // reception_data 업데이트
    if (reception_data) {
      const rd = reception_data;
      const existing = await env.DB.prepare('SELECT id FROM reception_data WHERE post_id = ?').bind(postId).first();
      if (existing) {
        await env.DB.prepare(
          `UPDATE reception_data SET
            patient_name=?, patient_dob=?, patient_gender=?, patient_phone=?, patient_nationality=?,
            id_type=?, id_number=?, chief_complaint=?, symptoms=?, exam_results=?, vessel_name=?, port_of_call=?
           WHERE post_id=?`
        ).bind(
          rd.patient_name||null, rd.patient_dob||null, rd.patient_gender||null,
          rd.patient_phone||null, rd.patient_nationality||null,
          rd.id_type||null, rd.id_number||null, rd.chief_complaint||null,
          rd.symptoms||null,
          rd.exam_results ? JSON.stringify(rd.exam_results) : null,
          rd.vessel_name||null, rd.port_of_call||null, postId
        ).run();
      } else {
        await env.DB.prepare(
          `INSERT INTO reception_data
            (post_id, patient_name, patient_dob, patient_gender, patient_phone, patient_nationality,
             id_type, id_number, chief_complaint, symptoms, exam_results, vessel_name, port_of_call)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
        ).bind(
          postId,
          rd.patient_name||null, rd.patient_dob||null, rd.patient_gender||null,
          rd.patient_phone||null, rd.patient_nationality||null,
          rd.id_type||null, rd.id_number||null, rd.chief_complaint||null,
          rd.symptoms||null,
          rd.exam_results ? JSON.stringify(rd.exam_results) : null,
          rd.vessel_name||null, rd.port_of_call||null
        ).run();


        
      }
    }

    return json({ message: '게시글이 수정되었습니다.' });
  }

  // DELETE /api/posts/:id
  const matchDel = path.match(/^\/api\/posts\/(\d+)$/);
  if (matchDel && method === 'DELETE') {
    const postId = parseInt(matchDel[1]);
    const post   = await env.DB.prepare('SELECT * FROM posts WHERE id = ?').bind(postId).first();
    if (!post) return json({ error: '게시글을 찾을 수 없습니다.' }, 404);

    const isOwner = post.author_id === user.sub;
    if (!isOwner) return json({ error: '삭제 권한이 없습니다.' }, 403);

    // 첨부파일은 D1에 저장되어 있으므로 posts 삭제 시 CASCADE로 자동 삭제됨
    await env.DB.prepare('DELETE FROM posts WHERE id = ?').bind(postId).run();
    return json({ message: '게시글이 삭제되었습니다.' });
  }

  // GET /api/posts/export?board_id= — Excel/CSV 내보내기 (staff 이상)
  if (path === '/api/posts/export' && method === 'GET') {
    if (!isStaff(user)) return json({ error: '권한이 없습니다.' }, 403);

    const board_id = url.searchParams.get('board_id');
    const status   = url.searchParams.get('status') || '';

    let where = board_id ? ['p.board_id = ?'] : ['1=1'];
    let binds = board_id ? [board_id] : [];
    if (status) { where.push('p.status = ?'); binds.push(status); }

    const rows = await env.DB.prepare(
      `SELECT p.id, p.title, p.status, p.created_at,
              u.name as author_name, c.name as company_name,
              a.name as assigned_name,
              rd.patient_name, rd.patient_dob, rd.patient_gender, rd.patient_phone,
              rd.patient_nationality, rd.id_type, rd.id_number,
              rd.chief_complaint, rd.vessel_name, rd.port_of_call
       FROM posts p
       JOIN users u ON u.id = p.author_id
       LEFT JOIN companies c ON c.id = p.company_id
       LEFT JOIN users a ON a.id = p.assigned_to
       LEFT JOIN reception_data rd ON rd.post_id = p.id
       WHERE ${where.join(' AND ')}
       ORDER BY p.created_at DESC`
    ).bind(...binds).all();

    // CSV 생성
    const headers = [
      'ID','제목','상태','작성자','관계사','담당자','작성일',
      '환자명','생년월일','성별','연락처','국적','신분증종류','신분증번호',
      '주訴','선박명','입항지'
    ];
    const escape = v => `"${String(v || '').replace(/"/g, '""')}"`;
    const lines  = [headers.join(',')];
    for (const r of rows.results) {
      lines.push([
        r.id, r.title, r.status, r.author_name, r.company_name, r.assigned_name||'', r.created_at,
        r.patient_name||'', r.patient_dob||'', r.patient_gender||'', r.patient_phone||'',
        r.patient_nationality||'', r.id_type||'', r.id_number||'',
        r.chief_complaint||'', r.vessel_name||'', r.port_of_call||''
      ].map(escape).join(','));
    }

    const bom = '\uFEFF';  // BOM for Excel UTF-8
    return new Response(bom + lines.join('\r\n'), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="reception_export_${Date.now()}.csv"`
      }
    });
  }

  return json({ error: '존재하지 않는 게시글 API입니다.' }, 404);
}
