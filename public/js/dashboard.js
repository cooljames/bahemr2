/**
 * bahEMR 대시보드 — 메인 SPA 컨트롤러
 *
 * 구조:
 *  App.init()          → 앱 초기화 (인증확인, 유저정보 로드)
 *  App.showView(name)  → 뷰 전환 (home | board | post | write | users | companies)
 *  App.loadBoards()    → 사이드바 게시판 목록
 *  App.loadHome()      → 대시보드 홈 통계
 *  App.loadPosts()     → 게시판 목록
 *  App.loadPost(id)    → 게시글 상세
 *  App.openWriteView() → 글쓰기 폼
 *  각종 모달/관리 기능
 */
const App = (() => {
  let currentUser   = null;
  let currentBoardId = null;
  let currentPostId  = null;
  let currentPage    = 1;
  let boards         = [];
  let staffList      = [];
  let companyList    = [];
  let editingCompanyId = null;

  // ── 유틸 ──────────────────────────────────────────────────
  function toast(msg, type = 'info') {
    const tc   = document.getElementById('toastContainer');
    const div  = document.createElement('div');
    const icons = { success: '✅', error: '❌', info: 'ℹ️' };
    div.className = `toast toast-${type}`;
    div.innerHTML = `<span class="toast-icon">${icons[type] || 'ℹ️'}</span><span>${msg}</span>`;
    tc.appendChild(div);
    setTimeout(() => { div.classList.add('toast-out'); setTimeout(() => div.remove(), 220); }, 3200);
  }

  function fmtDate(str) {
    if (!str) return '-';
    const d = new Date(str.replace(' ', 'T') + (str.includes('T') ? '' : 'Z'));
    return `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')}`;
  }

  function fmtDateTime(str) {
    if (!str) return '-';
    const d = new Date(str.replace(' ', 'T') + (str.includes('T') ? '' : 'Z'));
    return `${fmtDate(str)} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  }

  function fileSize(bytes) {
    if (bytes < 1024)       return bytes + ' B';
    if (bytes < 1024*1024)  return (bytes/1024).toFixed(1) + ' KB';
    return (bytes/1024/1024).toFixed(1) + ' MB';
  }

  function fileIcon(mime) {
    if (mime.startsWith('image/'))       return '🖼️';
    if (mime === 'application/pdf')      return '📄';
    if (mime.includes('excel') || mime.includes('spreadsheet')) return '📊';
    if (mime.includes('word'))           return '📝';
    return '📎';
  }

  const STATUS_LABEL = { submitted:'제출', reviewing:'검토중', accepted:'접수완료', rejected:'반려' };
  const STATUS_BADGE = { submitted:'badge-submitted', reviewing:'badge-reviewing', accepted:'badge-accepted', rejected:'badge-rejected' };
  const ROLE_LABEL   = { superadmin:'슈퍼관리자', admin:'관리자', staff:'직원', partner:'파트너', pending:'승인대기' };
  const COMPANY_TYPE = { nursing_home:'요양원/복지관', clinic:'검진센터', insurance:'보험사/행정기관', corporate:'기업복지팀', shipping:'선사/해운사', agency:'해운에이전트', foreign:'외국인기관', other:'기타' };
  const ID_TYPE      = { passport:'여권', alien_reg:'외국인등록증', id_card:'신분증', shore_pass:'Shore Pass', other:'기타' };

  function badgeHtml(status) {
    return `<span class="badge ${STATUS_BADGE[status] || 'badge-general'}">${STATUS_LABEL[status] || status}</span>`;
  }

  // ── 뷰 전환 ──────────────────────────────────────────────
  function showView(name) {
    document.querySelectorAll('.view').forEach(v => v.style.display = 'none');
    const el = document.getElementById(`view-${name}`);
    if (el) { el.style.display = ''; el.style.animation = 'none'; requestAnimationFrame(() => { el.style.animation = ''; }); }
    // 사이드바 active 상태
    document.querySelectorAll('.sb-item').forEach(i => i.classList.remove('active'));
    if (name === 'home') document.getElementById('navHome')?.classList.add('active');
  }

  function setBreadcrumb(items) {
    const bc = document.getElementById('breadcrumb');
    bc.innerHTML = `<a href="/dashboard.html">홈</a>` +
      items.map(it => it.href
        ? `<span class="sep">›</span><a href="#" onclick="${it.fn || ''}" style="cursor:pointer">${it.label}</a>`
        : `<span class="sep">›</span><span class="current">${it.label}</span>`
      ).join('');
  }

  // ── 초기화 ────────────────────────────────────────────────
  async function init() {
    const token = API.getToken();
    const user = API.getUser();

    if (!token || !user) {
      console.error('토큰 또는 유저 정보 없음 → 로그인 페이지로');
      window.location.href = '/index.html';
      return;
    }

    currentUser = user;

    // UI 사용자 정보 표시
    const initial = (user.name || '?').charAt(0).toUpperCase();
    document.getElementById('sbAvatar').textContent = initial;
    document.getElementById('sbName').textContent   = user.name;
    document.getElementById('sbRole').textContent   = ROLE_LABEL[user.role] || user.role;
    document.getElementById('welcomeMsg').textContent = `${user.name}님, 환영합니다.`;

    if (user.company_name) {
      const cb = document.getElementById('companyBadge');
      cb.textContent  = user.company_name;
      cb.style.display = '';
    }

    if (['superadmin','admin'].includes(user.role)) {
      document.getElementById('sbAdminSection').style.display = '';
    }
    if (user.role === 'superadmin') {
      document.getElementById('sbCreateBoard').style.display = '';
    }

    document.getElementById('sbLogout').addEventListener('click', logout);
    document.getElementById('navHome').addEventListener('click', (e) => { e.preventDefault(); goHome(); });
    document.getElementById('hamburger').addEventListener('click', openSidebar);
    document.getElementById('sbClose').addEventListener('click', closeSidebar);
    document.getElementById('sbOverlay').addEventListener('click', closeSidebar);

    document.querySelectorAll('[data-view]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        const view = el.dataset.view;
        if (view === 'users')          loadUsersView();
        else if (view === 'companies') loadCompaniesView();
        else if (view === 'home')      goHome();
        closeSidebar();
      });
    });

    document.getElementById('searchInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') loadPosts();
    });

    try {
      await loadBoards();
      await loadHome();
      showView('home');
    } catch (err) {
      console.error('🚨 대시보드 로드 중 치명적 에러:', err);
      alert('로드 실패: ' + (err.message || err));
    }
  }

  // ── 사이드바 ──────────────────────────────────────────────
  function openSidebar() {
    document.getElementById('sidebar').classList.add('open');
    document.getElementById('sbOverlay').classList.add('show');
  }
  function closeSidebar() {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sbOverlay').classList.remove('show');
  }

  // ── 로그아웃 ─────────────────────────────────────────────
  function logout() {
    API.clearToken();
    window.location.href = '/index.html';
  }

  // ── 대시보드 홈 ───────────────────────────────────────────
  async function goHome() {
    showView('home');
    setBreadcrumb([]);
    currentBoardId = null;
    document.querySelectorAll('.sb-item').forEach(i => i.classList.remove('active'));
    document.getElementById('navHome').classList.add('active');
    await loadHome();
  }

  async function loadHome() {
    try {
      const data = await API.get('/api/stats/dashboard');

      // 통계
      if (data.user_count !== null) {
        document.getElementById('statCard1').style.display = '';
        document.getElementById('statCard2').style.display = '';
        document.getElementById('statUsers').textContent  = data.user_count;
        document.getElementById('statBoards').textContent = data.board_count;
      }
      document.getElementById('statPosts').textContent   = data.post_count;

      // 대기 중 접수 수
      const pending = (data.status_stats || []).find(s => s.status === 'submitted');
      document.getElementById('statPending').textContent = pending ? pending.cnt : 0;

      // 접수 상태 현황
      if (data.status_stats && data.status_stats.length > 0) {
        const panel = document.getElementById('statusPanel');
        panel.style.display = '';
        const total = data.status_stats.reduce((s, i) => s + i.cnt, 0);
        const barEl = document.getElementById('statusBars');
        barEl.innerHTML = data.status_stats.map(s => `
          <div class="status-row">
            <span class="status-row-label">${STATUS_LABEL[s.status] || s.status}</span>
            <div class="status-bar-bg">
              <div class="status-bar-fill s-${s.status}" style="width:${total ? (s.cnt/total*100).toFixed(1) : 0}%"></div>
            </div>
            <span class="status-row-count">${s.cnt}</span>
          </div>
        `).join('');
      }

      // 최근 게시글
      const listEl = document.getElementById('recentList');
      if (!data.recent_posts || data.recent_posts.length === 0) {
        listEl.innerHTML = '<div class="loading-row">최근 게시글이 없습니다.</div>';
      } else {
        listEl.innerHTML = data.recent_posts.map(p => `
          <div class="recent-row" onclick="App.loadPost(${p.id}, ${p.board_id})">
            <span class="recent-row-board">${esc(p.board_name)}</span>
            <span class="recent-row-title">${esc(p.title)}</span>
            ${p.status ? badgeHtml(p.status) : ''}
            <span class="recent-row-meta">${fmtDate(p.created_at)}</span>
          </div>
        `).join('');
      }
    } catch (err) {
      console.error('loadHome error:', err);
    }
  }

  // ── 게시판 사이드바 로드 ──────────────────────────────────
  async function loadBoards() {
    try {
      const data = await API.get('/api/boards');
      boards = data.boards || [];

      const listEl = document.getElementById('sbBoardList');
      if (!boards.length) {
        listEl.innerHTML = '<div style="padding:8px 10px;font-size:12px;color:var(--muted)">게시판 없음</div>';
        return;
      }

      listEl.innerHTML = boards.map(b => {
        const icon = b.type === 'notice' ? '📢' : b.type === 'reception' ? '📋' : '💬';
        return `
          <a href="#" class="sb-item sb-item-board" data-board-id="${b.id}"
             onclick="App.openBoard(${b.id}); return false;">
            <span style="font-size:14px;flex-shrink:0">${icon}</span>
            <span>${esc(b.name)}</span>
            ${b.post_count > 0 ? `<span style="margin-left:auto;font-size:10px;font-family:var(--mono);color:var(--muted)">${b.post_count}</span>` : ''}
          </a>`;
      }).join('');
    } catch (err) {
      document.getElementById('sbBoardList').innerHTML = '<div style="padding:8px 10px;font-size:12px;color:var(--error)">로드 실패</div>';
    }
  }

  // ── 게시판 열기 ───────────────────────────────────────────
  async function openBoard(boardId) {
    closeSidebar();
    currentBoardId = boardId;
    currentPage    = 1;
    const board    = boards.find(b => b.id === boardId) || {};

    document.getElementById('boardTitle').textContent = board.name || '게시판';
    document.getElementById('boardDesc').textContent  = board.description || '';

    // 접수 게시판이면 상태 필터 + CSV 버튼 표시
    const isReception = board.type === 'reception';
    document.getElementById('statusFilter').style.display = isReception ? '' : 'none';
    document.getElementById('thStatus').style.display     = isReception ? '' : 'none';
    document.getElementById('thCompany').style.display    = ['superadmin','admin','staff'].includes(currentUser.role) ? '' : 'none';
    document.getElementById('btnExport').style.display    = (isReception && ['superadmin','admin','staff'].includes(currentUser.role)) ? '' : 'none';

    // 쓰기 권한 확인
    document.getElementById('btnWrite').style.display = board.can_write ? '' : 'none';

    setBreadcrumb([{ label: board.name }]);
    showView('board');

    // 사이드바 active
    document.querySelectorAll('.sb-item-board').forEach(el => {
      el.classList.toggle('active', parseInt(el.dataset.boardId) === boardId);
    });

    await loadPosts();
  }

  // ── 게시글 목록 로드 ──────────────────────────────────────
  async function loadPosts() {
    if (!currentBoardId) return;
    const keyword = document.getElementById('searchInput').value.trim();
    const status  = document.getElementById('statusFilter').value;
    const tbody   = document.getElementById('postTableBody');
    tbody.innerHTML = '<tr><td colspan="6" class="empty-td">불러오는 중...</td></tr>';

    try {
      const params = new URLSearchParams({
        board_id: currentBoardId,
        page:     currentPage,
        limit:    20,
        ...(keyword ? { q: keyword } : {}),
        ...(status  ? { status }    : {})
      });
      const data = await API.get(`/api/posts?${params}`);
      renderPostTable(data);
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty-td" style="color:var(--error)">${err.message}</td></tr>`;
    }
  }

  function renderPostTable(data) {
    const posts   = data.posts || [];
    const total   = data.total || 0;
    const tbody   = document.getElementById('postTableBody');
    const board   = boards.find(b => b.id === currentBoardId) || {};
    const isAdmin = ['superadmin','admin','staff'].includes(currentUser.role);

    if (!posts.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty-td">게시글이 없습니다.</td></tr>`;
    } else {
      tbody.innerHTML = posts.map((p, i) => {
        const num     = total - ((currentPage - 1) * 20) - i;
        const pinIcon = p.is_pinned ? '<span class="td-pinned">📌</span>' : '';
        const cmt     = p.comment_count > 0 ? `<span class="td-cmt">💬${p.comment_count}</span>` : '';
        const att     = p.attachment_count > 0 ? `<span class="td-att">📎${p.attachment_count}</span>` : '';
        return `
          <tr onclick="App.loadPost(${p.id}, ${p.board_id})">
            <td class="td-num" data-label="번호">${p.is_pinned ? '📌' : num}</td>
            <td data-label="제목 및 메타">
              <div class="td-title">${pinIcon}<span class="td-title-text">${esc(p.title)}</span></div>
              <div class="td-meta">${cmt}${att}</div>
            </td>
            <td data-label="상태" style="display:${board.type==='reception'?'':'none'}">${badgeHtml(p.status)}</td>
            <td data-label="작성자">${esc(p.author_name)}</td>
            <td data-label="관계사" style="display:${isAdmin?'':'none'}">${esc(p.company_name||'-')}</td>
            <td class="td-date" data-label="날짜">${fmtDate(p.created_at)}</td>
          </tr>`;
      }).join('');
    }

    // 페이지네이션
    const totalPages = Math.ceil(total / 20);
    const pagEl = document.getElementById('pagination');
    if (totalPages <= 1) { pagEl.innerHTML = ''; return; }

    let btns = '';
    btns += `<button class="page-btn" onclick="App.goPage(${currentPage-1})" ${currentPage===1?'disabled':''}>‹</button>`;
    for (let p = Math.max(1, currentPage-2); p <= Math.min(totalPages, currentPage+2); p++) {
      btns += `<button class="page-btn ${p===currentPage?'active':''}" onclick="App.goPage(${p})">${p}</button>`;
    }
    btns += `<button class="page-btn" onclick="App.goPage(${currentPage+1})" ${currentPage===totalPages?'disabled':''}>›</button>`;
    pagEl.innerHTML = btns;
  }

  function goPage(p) {
    currentPage = p;
    loadPosts();
    window.scrollTo(0, 0);
  }

  // ── 게시글 상세 ───────────────────────────────────────────
  async function loadPost(postId, boardId) {
    if (boardId && boardId !== currentBoardId) {
      currentBoardId = boardId;
    }
    currentPostId = postId;
    showView('post');
    document.getElementById('postDetail').innerHTML = '<div class="loading-row" style="padding:40px">불러오는 중...</div>';

    try {
      const data  = await API.get(`/api/posts/${postId}`);
      const post  = data.post;
      const rd    = data.reception_data;
      const board = boards.find(b => b.id === post.board_id) || {};
      const isOwner   = post.author_id === currentUser.sub;
      const isAdmin   = ['superadmin','admin'].includes(currentUser.role);
      const isStaff   = ['superadmin','admin','staff'].includes(currentUser.role);

      setBreadcrumb([
        { label: board.name || '게시판', fn: `App.openBoard(${post.board_id}); return false;` },
        { label: post.title }
      ]);

      // 사이드바 active
      document.querySelectorAll('.sb-item-board').forEach(el => {
        el.classList.toggle('active', parseInt(el.dataset.boardId) === post.board_id);
      });

      let html = `
        <div class="post-header">
          <div class="post-title">${esc(post.title)}</div>
          <div class="post-meta-row">
            <span class="post-meta-item">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
              ${esc(post.author_name)}
              ${post.company_name ? `<span style="color:var(--muted);">(${esc(post.company_name)})</span>` : ''}
            </span>
            <span class="post-meta-item">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12,6 12,12 16,14"/></svg>
              ${fmtDateTime(post.created_at)}
            </span>
            <span class="post-meta-item">👁 ${post.view_count}</span>
            ${post.status ? badgeHtml(post.status) : ''}
          </div>
          <div class="post-actions">
            ${(isOwner && post.status === 'submitted') || isAdmin ? `<button class="btn-secondary btn-sm" onclick="App.openEditView()">수정</button>` : ''}
            ${isOwner || isAdmin ? `<button class="btn-danger btn-sm" onclick="App.deletePost()">삭제</button>` : ''}
            <button class="btn-ghost btn-sm" onclick="App.openBoard(${post.board_id})">목록으로</button>
          </div>
        </div>`;

      // 접수 정보 (reception 게시판)
      if (post.board_type === 'reception' && rd) {
        html += `
          <div class="reception-box">
            <h3>📋 접수 대상자 정보</h3>
            <div class="reception-grid">
              <div class="rg-item"><span class="rg-label">환자명</span><span class="rg-value">${esc(rd.patient_name||'')}</span></div>
              <div class="rg-item"><span class="rg-label">생년월일</span><span class="rg-value">${esc(rd.patient_dob||'')}</span></div>
              <div class="rg-item"><span class="rg-label">성별</span><span class="rg-value">${rd.patient_gender==='M'?'남성':rd.patient_gender==='F'?'여성':''}</span></div>
              <div class="rg-item"><span class="rg-label">연락처</span><span class="rg-value">${esc(rd.patient_phone||'')}</span></div>
              <div class="rg-item"><span class="rg-label">국적</span><span class="rg-value">${esc(rd.patient_nationality||'')}</span></div>
              <div class="rg-item"><span class="rg-label">신분증</span><span class="rg-value">${esc(ID_TYPE[rd.id_type]||rd.id_type||'')} ${esc(rd.id_number||'')}</span></div>
              ${rd.vessel_name ? `<div class="rg-item"><span class="rg-label">선박명</span><span class="rg-value">${esc(rd.vessel_name)}</span></div>` : ''}
              ${rd.port_of_call ? `<div class="rg-item"><span class="rg-label">입항지</span><span class="rg-value">${esc(rd.port_of_call)}</span></div>` : ''}
            </div>
            ${rd.chief_complaint ? `<div style="margin-top:14px"><span class="rg-label" style="display:block;margin-bottom:4px">주訴 / 증상</span><div style="font-size:13.5px;white-space:pre-wrap;color:var(--text2)">${esc(rd.chief_complaint)}</div></div>` : ''}
          </div>`;
      }

      // 상태 변경 바 (staff 이상)
      if (isStaff && post.board_type === 'reception') {
        // 담당자 목록 로드
        if (!staffList.length) await loadStaffList();
        html += `
          <div class="status-change-bar">
            <label>상태변경</label>
            <select class="status-select" id="postStatusSel" onchange="App.changeStatus()">
              <option value="submitted"  ${post.status==='submitted' ?'selected':''}>제출</option>
              <option value="reviewing"  ${post.status==='reviewing' ?'selected':''}>검토중</option>
              <option value="accepted"   ${post.status==='accepted'  ?'selected':''}>접수완료</option>
              <option value="rejected"   ${post.status==='rejected'  ?'selected':''}>반려</option>
            </select>
            <label>담당자배정</label>
            <select class="assign-select" id="postAssignSel" onchange="App.changeAssign()">
              <option value="">미배정</option>
              ${staffList.map(s => `<option value="${s.id}" ${post.assigned_to===s.id?'selected':''}>${esc(s.name)}</option>`).join('')}
            </select>
          </div>`;
      }

      // 본문
      html += `<div class="post-body">${esc(post.content)}</div>`;

      // 첨부파일
      html += renderAttachments(data.attachments, post.author_id === currentUser.sub || isAdmin);

      // 상태 이력
      if (data.history && data.history.length > 0) {
        html += `
          <div class="history-section">
            <h4>처리 이력</h4>
            <div class="history-list">
              ${data.history.map(h => `
                <div class="history-item">
                  <div class="history-dot hd-${h.to_status}"></div>
                  <div class="history-text">
                    <strong>${esc(h.changed_by_name)}</strong>
                    ${h.from_status ? `<span style="color:var(--muted)"> · ${STATUS_LABEL[h.from_status]||h.from_status} → </span>` : ' · '}
                    <span>${STATUS_LABEL[h.to_status]||h.to_status}</span>
                    ${h.memo ? `<span style="color:var(--muted)"> — ${esc(h.memo)}</span>` : ''}
                  </div>
                  <span class="history-time">${fmtDateTime(h.created_at)}</span>
                </div>`).join('')}
            </div>
          </div>`;
      }

      // 댓글
      html += await renderCommentsHtml(postId);

      document.getElementById('postDetail').innerHTML = html;

      // 파일 업로드 이벤트
      const dropZone = document.getElementById('dropZone');
      const fileInput = document.getElementById('fileInput');
      if (dropZone && fileInput) {
        dropZone.addEventListener('click', () => fileInput.click());
        dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
        dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
        dropZone.addEventListener('drop', (e) => {
          e.preventDefault(); dropZone.classList.remove('dragover');
          uploadFiles(Array.from(e.dataTransfer.files));
        });
        fileInput.addEventListener('change', () => uploadFiles(Array.from(fileInput.files)));
      }

      // 댓글 폼 제출
      const commentForm = document.getElementById('commentForm');
      if (commentForm) {
        commentForm.addEventListener('submit', submitComment);
      }
      
      // 댓글 파일 미리보기
      const commentFileInput = document.getElementById('commentAttachments');
      const commentPreviewDiv = document.getElementById('commentAttachmentPreview');
      if (commentFileInput && commentPreviewDiv) {
        commentFileInput.addEventListener('change', function(e) {
          commentPreviewDiv.innerHTML = '';
          Array.from(e.target.files).forEach(file => {
            if (file.type.startsWith('image/')) {
              const reader = new FileReader();
              reader.onload = function(e) {
                const img = document.createElement('img');
                img.src = e.target.result;
                img.className = 'attachment-thumb';
                commentPreviewDiv.appendChild(img);
              };
              reader.readAsDataURL(file);
            } else {
              const div = document.createElement('div');
              div.className = 'attachment-file';
              div.innerHTML = `${fileIcon(file.type)} ${file.name}`;
              commentPreviewDiv.appendChild(div);
            }
          });
        });
      }

    } catch (err) {
      document.getElementById('postDetail').innerHTML = `<div class="empty-state"><p style="color:var(--error)">${err.message}</p></div>`;
    }
  }

  function renderAttachments(attachments, canDelete) {
    const isStaff = ['superadmin','admin','staff'].includes(currentUser.role);
    const canUpload = isStaff || currentUser.role === 'partner';
    return `
      <div class="attach-section">
        <h4>첨부파일 (${attachments.length})</h4>
        <div class="attach-list" id="attachList">
          ${attachments.length === 0 ? '<div style="color:var(--muted);font-size:13px">첨부파일 없음</div>' :
            attachments.map(a => `
              <div class="attach-item" id="att-${a.id}">
                ${a.mime_type.startsWith('image/') ? `<img class="attach-thumb" src="/api/attachments/${a.id}" alt="${esc(a.filename)}" onclick="App.viewImage(${a.id}, '${esc(a.filename)}')" />` : `<span class="attach-icon">${fileIcon(a.mime_type)}</span>`}
                <div class="attach-info">
                  <div class="attach-name">${esc(a.filename)}</div>
                  <div class="attach-size">${fileSize(a.file_size)}</div>
                </div>
                <button class="attach-dl" onclick="App.downloadFile(${a.id}, '${esc(a.filename)}')">다운로드</button>
                ${canDelete ? `<button class="attach-del" onclick="App.deleteFile(${a.id})" title="삭제"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3,6 5,6 21,6"/><path d="M19,6v14a2,2,0,0,1-2,2H7a2,2,0,0,1-2-2V6m3,0V4a1,1,0,0,1,1-1h4a1,1,0,0,1,1,1v2"/></svg></button>` : ''}
              </div>`).join('')
          }
        </div>
        ${canUpload ? `
          <div style="margin-top:10px">
            <div class="file-drop-zone" id="dropZone">
              <p>여기에 파일을 끌어다 놓거나 <strong>클릭하여 업로드</strong></p>
              <p style="font-size:11px;margin-top:4px">PDF, 이미지, Word, Excel · 최대 20MB · 게시글당 10개</p>
            </div>
            <input type="file" id="fileInput" class="file-input-hidden" multiple accept=".pdf,.jpg,.jpeg,.png,.gif,.webp,.doc,.docx,.xls,.xlsx,.txt,.csv" />
          </div>` : ''}
      </div>`;
  }

  async function renderCommentsHtml(postId) {
    try {
      const data     = await API.get(`/api/comments?post_id=${postId}`);
      const comments = data.comments || [];
      const topLevel = comments.filter(c => !c.parent_id);
      const replies  = comments.filter(c => c.parent_id);

      const renderComment = (c) => {
        const isOwner = c.author_id === currentUser.sub;
        const isAdmin = ['superadmin','admin'].includes(currentUser.role);
        const reps = replies.filter(r => r.parent_id === c.id);
        const attachments = c.attachments || [];
        const attachmentHtml = attachments.length > 0 ? `
          <div class="comment-attachments" style="margin-top:8px;display:grid;grid-template-columns:repeat(auto-fill,minmax(80px,1fr));gap:8px">
            ${attachments.map(a => `
              <div class="comment-attach-item" style="position:relative">
                ${a.mime_type.startsWith('image/') 
                  ? `<img class="attach-thumb" src="/api/attachments/${a.id}" alt="${esc(a.filename)}" onclick="App.viewImage(${a.id}, '${esc(a.filename)}')" style="cursor:pointer;width:100%;height:100%;object-fit:cover;border-radius:6px;border:1px solid var(--border)" />`
                  : `<div class="attach-icon" style="width:100%;height:80px;display:flex;align-items:center;justify-content:center;background:var(--surface2);border-radius:6px;border:1px solid var(--border);font-size:28px">${fileIcon(a.mime_type)}</div>`
                }
                <div style="font-size:10px;color:var(--muted);margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(a.filename)}</div>
              </div>
            `).join('')}
          </div>` : '';
        return `
          <div class="comment-item ${c.is_deleted ? 'is-deleted' : ''}" id="cmt-${c.id}">
            <div class="comment-header">
              <span class="comment-author">${esc(c.author_name)}</span>
              <span class="comment-role">${ROLE_LABEL[c.author_role]||c.author_role}</span>
              <span class="comment-time">${fmtDateTime(c.created_at)}</span>
            </div>
            <div class="comment-body">${esc(c.content)}</div>
            ${attachmentHtml}
            ${!c.is_deleted ? `
              <div class="comment-actions">
                <button class="comment-btn" onclick="App.replyTo(${c.id}, '${esc(c.author_name)}')">답글</button>
                ${isOwner || isAdmin ? `<button class="comment-btn" onclick="App.editComment(${c.id}, this)">수정</button>` : ''}
                ${isOwner || isAdmin ? `<button class="comment-btn danger" onclick="App.deleteComment(${c.id})">삭제</button>` : ''}
              </div>` : ''}
          </div>
          ${reps.map(r => {
            const raAttachments = r.attachments || [];
            const raAttachmentHtml = raAttachments.length > 0 ? `
              <div class="comment-attachments" style="margin-top:8px;display:grid;grid-template-columns:repeat(auto-fill,minmax(80px,1fr));gap:8px">
                ${raAttachments.map(a => `
                  <div class="comment-attach-item" style="position:relative">
                    ${a.mime_type.startsWith('image/') 
                      ? `<img class="attach-thumb" src="/api/attachments/${a.id}" alt="${esc(a.filename)}" onclick="App.viewImage(${a.id}, '${esc(a.filename)}')" style="cursor:pointer;width:100%;height:100%;object-fit:cover;border-radius:6px;border:1px solid var(--border)" />`
                      : `<div class="attach-icon" style="width:100%;height:80px;display:flex;align-items:center;justify-content:center;background:var(--surface2);border-radius:6px;border:1px solid var(--border);font-size:28px">${fileIcon(a.mime_type)}</div>`
                    }
                    <div style="font-size:10px;color:var(--muted);margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(a.filename)}</div>
                  </div>
                `).join('')}
              </div>` : '';
            return `
              <div class="comment-item is-reply ${r.is_deleted?'is-deleted':''}" id="cmt-${r.id}">
                <div class="comment-header">
                  <span class="comment-author">${esc(r.author_name)}</span>
                  <span class="comment-role">${ROLE_LABEL[r.author_role]||r.author_role}</span>
                  <span class="comment-time">${fmtDateTime(r.created_at)}</span>
                </div>
                <div class="comment-body">${esc(r.content)}</div>
                ${raAttachmentHtml}
                ${!r.is_deleted ? `
                  <div class="comment-actions">
                    ${(r.author_id===currentUser.sub||['superadmin','admin'].includes(currentUser.role)) ? `<button class="comment-btn" onclick="App.editComment(${r.id}, this)">수정</button>` : ''}
                    ${(r.author_id===currentUser.sub||['superadmin','admin'].includes(currentUser.role)) ? `<button class="comment-btn danger" onclick="App.deleteComment(${r.id})">삭제</button>` : ''}
                  </div>` : ''}
              </div>`;
          }).join('')}`;
      };

      return `
        <div class="comment-section">
          <h4>댓글 (${comments.filter(c => !c.is_deleted).length})</h4>
          <div class="comment-list" id="commentList">
            ${topLevel.length === 0 ? '<div style="color:var(--muted);font-size:13px">댓글이 없습니다.</div>' : topLevel.map(renderComment).join('')}
          </div>
          <form class="comment-form" id="commentForm">
            <div id="replyIndicator" style="display:none;font-size:12px;color:var(--primary);margin-bottom:6px"></div>
            <input type="hidden" id="replyParentId" value="" />
            <textarea class="comment-input" id="commentInput" placeholder="댓글을 입력하세요..." rows="3"></textarea>
            <div class="comment-file-section" style="margin-top:8px;margin-bottom:8px">
              <label style="font-size:12px;color:var(--muted);display:block;margin-bottom:6px">파일 첨부 (선택사항)</label>
              <div class="comment-file-input">
                <input type="file" id="commentAttachments" multiple accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv" style="font-size:12px" />
              </div>
              <div id="commentAttachmentPreview" class="attachment-preview" style="margin-top:8px"></div>
            </div>
            <div class="comment-form-footer">
              <button type="button" class="btn-ghost btn-sm" id="cancelReplyBtn" style="display:none;margin-right:8px" onclick="App.cancelReply()">취소</button>
              <button type="submit" class="btn-primary btn-sm">댓글 등록</button>
            </div>
          </form>
        </div>`;
    } catch {
      return '';
    }
  }

  function replyTo(parentId, authorName) {
    document.getElementById('replyParentId').value = parentId;
    const ind = document.getElementById('replyIndicator');
    ind.textContent = `↩ ${authorName}님에게 답글 작성 중`;
    ind.style.display = '';
    document.getElementById('cancelReplyBtn').style.display = '';
    document.getElementById('commentInput').focus();
  }

  function cancelReply() {
    document.getElementById('replyParentId').value = '';
    document.getElementById('replyIndicator').style.display = 'none';
    document.getElementById('cancelReplyBtn').style.display = 'none';
  }

  async function submitComment(e) {
    e.preventDefault();
    const content  = document.getElementById('commentInput').value.trim();
    const parentId = document.getElementById('replyParentId').value || null;
    if (!content) { toast('댓글 내용을 입력하세요.', 'error'); return; }

    try {
      const res = await API.post('/api/comments', { post_id: currentPostId, content, parent_id: parentId ? parseInt(parentId) : null });
      const commentId = res.id;
      
      // 첨부파일 업로드
      const fileInput = document.getElementById('commentAttachments');
      if (fileInput && fileInput.files.length > 0) {
        for (let file of fileInput.files) {
          const formData = new FormData();
          formData.append('file', file);
          try {
            await API.post(`/api/attachments/upload?comment_id=${commentId}`, formData);
          } catch (err) {
            console.warn(`파일 업로드 실패: ${file.name}`, err);
          }
        }
      }
      
      toast('댓글이 등록되었습니다.', 'success');
      // 폼 초기화
      document.getElementById('commentInput').value = '';
      document.getElementById('commentAttachments').value = '';
      document.getElementById('commentAttachmentPreview').innerHTML = '';
      document.getElementById('replyParentId').value = '';
      document.getElementById('replyIndicator').style.display = 'none';
      document.getElementById('cancelReplyBtn').style.display = 'none';
      
      await loadPost(currentPostId, currentBoardId);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function editComment(commentId, btn) {
    const item    = document.getElementById(`cmt-${commentId}`);
    const bodyEl  = item.querySelector('.comment-body');
    const current = bodyEl.textContent;

    bodyEl.innerHTML = `<textarea style="width:100%;background:var(--bg);border:1px solid var(--primary);border-radius:6px;color:var(--text);font-family:var(--font);font-size:13px;padding:8px;resize:vertical;outline:none" rows="3">${current}</textarea>`;
    btn.textContent = '저장';
    btn.onclick = async () => {
      const newContent = bodyEl.querySelector('textarea').value.trim();
      if (!newContent) return;
      try {
        await API.patch(`/api/comments/${commentId}`, { content: newContent });
        toast('댓글이 수정되었습니다.', 'success');
        await loadPost(currentPostId, currentBoardId);
      } catch (err) { toast(err.message, 'error'); }
    };
  }

  async function deleteComment(commentId) {
    if (!confirm('댓글을 삭제하시겠습니까?')) return;
    try {
      await API.delete(`/api/comments/${commentId}`);
      toast('댓글이 삭제되었습니다.', 'success');
      await loadPost(currentPostId, currentBoardId);
    } catch (err) { toast(err.message, 'error'); }
  }

  // ── 파일 업로드/다운로드/삭제 ────────────────────────────
  async function uploadFiles(files) {
    for (const file of files) {
      const fd = new FormData();
      fd.append('file', file);
      try {
        await API.upload(`/api/attachments/upload?post_id=${currentPostId}`, fd);
        toast(`${file.name} 업로드 완료`, 'success');
      } catch (err) {
        toast(`${file.name}: ${err.message}`, 'error');
      }
    }
    await loadPost(currentPostId, currentBoardId);
  }

  async function downloadFile(attId, filename) {
    try {
      await API.downloadAttachment(attId, filename);
    } catch (err) { toast(err.message, 'error'); }
  }

  function viewImage(attId, filename) {
    const modal = document.createElement('div');
    modal.className = 'image-modal';
    modal.innerHTML = `
      <div class="image-modal-overlay" onclick="this.parentElement.remove()"></div>
      <div class="image-modal-content">
        <img src="/api/attachments/${attId}" alt="${esc(filename)}" />
        <button class="image-modal-close" onclick="this.parentElement.parentElement.remove()">✕</button>
      </div>
    `;
    document.body.appendChild(modal);
  }

  async function deleteFile(attId) {
    if (!confirm('첨부파일을 삭제하시겠습니까?')) return;
    try {
      await API.delete(`/api/attachments/${attId}`);
      document.getElementById(`att-${attId}`)?.remove();
      toast('파일이 삭제되었습니다.', 'success');
    } catch (err) { toast(err.message, 'error'); }
  }

  // ── 상태/담당자 변경 ──────────────────────────────────────
  async function changeStatus() {
    const status = document.getElementById('postStatusSel').value;
    try {
      await API.patch(`/api/posts/${currentPostId}`, { status });
      toast('상태가 변경되었습니다.', 'success');
    } catch (err) { toast(err.message, 'error'); }
  }

  async function changeAssign() {
    const assignTo = document.getElementById('postAssignSel').value;
    try {
      await API.patch(`/api/posts/${currentPostId}`, { assigned_to: assignTo ? parseInt(assignTo) : null });
      toast('담당자가 배정되었습니다.', 'success');
    } catch (err) { toast(err.message, 'error'); }
  }

  async function loadStaffList() {
    try {
      const data = await API.get('/api/users?role=staff');
      staffList  = data.users || [];
      const admins = await API.get('/api/users?role=admin');
      staffList = [...staffList, ...(admins.users||[])];
    } catch { staffList = []; }
  }

  // ── 글쓰기 뷰 ─────────────────────────────────────────────
  async function openWriteView(postId = null) {
    const board     = boards.find(b => b.id === currentBoardId) || {};
    const isReception = board.type === 'reception';
    const isEdit    = !!postId;
    let editData    = null;

    if (isEdit) {
      const data = await API.get(`/api/posts/${postId}`);
      editData = data;
    }

    const p = editData?.post || {};
    const rd = editData?.reception_data || {};

    setBreadcrumb([
      { label: board.name, fn: `App.openBoard(${currentBoardId}); return false;` },
      { label: isEdit ? '수정' : '글쓰기' }
    ]);

    document.getElementById('writeWrap').innerHTML = `
      <div class="page-header">
        <h1>${isEdit ? '게시글 수정' : '새 게시글 작성'}</h1>
      </div>
      <div class="write-form" id="writeForm">
        <div class="form-group">
          <label>제목 *</label>
          <input type="text" id="wTitle" placeholder="제목을 입력하세요" maxlength="200" value="${esc(p.title||'')}" />
        </div>
        ${isReception ? renderReceptionForm(rd) : ''}
        <div class="form-group">
          <label>${isReception ? '추가 내용 / 특이사항' : '내용 *'}</label>
          <textarea id="wContent" placeholder="내용을 입력하세요">${esc(p.content||'')}</textarea>
        </div>
        <div class="form-group">
          <label>첨부파일</label>
          <input type="file" id="wAttachments" multiple accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv" />
          <div id="attachmentPreview" class="attachment-preview"></div>
        </div>
        <div class="write-footer">
          <button class="btn-ghost" onclick="App.openBoard(${currentBoardId})">취소</button>
          <button class="btn-primary" onclick="App.submitPost(${isEdit ? postId : 'null'})">${isEdit ? '수정 완료' : '등록'}</button>
        </div>
      </div>`;

    showView('write');

    // 첨부파일 미리보기 이벤트
    const fileInput = document.getElementById('wAttachments');
    const previewDiv = document.getElementById('attachmentPreview');
    fileInput.addEventListener('change', function(e) {
      previewDiv.innerHTML = '';
      Array.from(e.target.files).forEach(file => {
        if (file.type.startsWith('image/')) {
          const reader = new FileReader();
          reader.onload = function(e) {
            const img = document.createElement('img');
            img.src = e.target.result;
            img.className = 'attachment-thumb';
            previewDiv.appendChild(img);
          };
          reader.readAsDataURL(file);
        } else {
          const div = document.createElement('div');
          div.className = 'attachment-file';
          div.innerHTML = `${fileIcon(file.type)} ${file.name}`;
          previewDiv.appendChild(div);
        }
      });
    });
  }

  function renderReceptionForm(rd = {}) {
    return `
      <div class="reception-form-box">
        <h3>📋 접수 대상자 정보</h3>
        <div class="form-grid">
          <div class="form-group">
            <label>환자명 *</label>
            <input type="text" id="rdName" placeholder="홍길동 / Hong Gil-dong" value="${esc(rd.patient_name||'')}" />
          </div>
          <div class="form-group">
            <label>생년월일</label>
            <input type="date" id="rdDob" value="${rd.patient_dob||''}" />
          </div>
          <div class="form-group">
            <label>성별</label>
            <select id="rdGender">
              <option value="">선택</option>
              <option value="M" ${rd.patient_gender==='M'?'selected':''}>남성</option>
              <option value="F" ${rd.patient_gender==='F'?'selected':''}>여성</option>
            </select>
          </div>
          <div class="form-group">
            <label>연락처</label>
            <input type="text" id="rdPhone" placeholder="010-0000-0000" value="${esc(rd.patient_phone||'')}" />
          </div>
          <div class="form-group">
            <label>국적</label>
            <input type="text" id="rdNation" placeholder="한국 / Philippines / etc." value="${esc(rd.patient_nationality||'')}" />
          </div>
          <div class="form-group">
            <label>신분증 종류</label>
            <select id="rdIdType">
              <option value="">선택</option>
              <option value="passport"  ${rd.id_type==='passport' ?'selected':''}>여권 (Passport)</option>
              <option value="alien_reg" ${rd.id_type==='alien_reg'?'selected':''}>외국인등록증</option>
              <option value="id_card"   ${rd.id_type==='id_card'  ?'selected':''}>신분증</option>
              <option value="shore_pass"${rd.id_type==='shore_pass'?'selected':''}>Shore Pass (상륙증)</option>
              <option value="other"     ${rd.id_type==='other'    ?'selected':''}>기타</option>
            </select>
          </div>
          <div class="form-group">
            <label>신분증 번호</label>
            <input type="text" id="rdIdNum" placeholder="여권번호 / 등록번호 등" value="${esc(rd.id_number||'')}" />
          </div>
          <div class="form-group">
            <label>선박명</label>
            <input type="text" id="rdVessel" placeholder="선박이름 (해운 관련 시)" value="${esc(rd.vessel_name||'')}" />
          </div>
          <div class="form-group">
            <label>입항지</label>
            <input type="text" id="rdPort" placeholder="부산항 / Busan Port" value="${esc(rd.port_of_call||'')}" />
          </div>
        </div>
        <div class="form-group" style="margin-top:10px">
          <label>주訴 / 증상</label>
          <textarea id="rdComplaint" rows="3" placeholder="주요 증상 및 주訴를 입력하세요.">${esc(rd.chief_complaint||'')}</textarea>
        </div>
      </div>`;
  }

  async function submitPost(postId) {
    const title   = document.getElementById('wTitle')?.value.trim();
    const content = document.getElementById('wContent')?.value.trim();
    const board   = boards.find(b => b.id === currentBoardId) || {};
    const isReception = board.type === 'reception';

    if (!title) { toast('제목을 입력하세요.', 'error'); return; }
    if (!content && !isReception) { toast('내용을 입력하세요.', 'error'); return; }

    let reception_data = null;
    if (isReception) {
      const name = document.getElementById('rdName')?.value.trim();
      if (!name) { toast('환자명을 입력하세요.', 'error'); return; }
      reception_data = {
        patient_name:        name,
        patient_dob:         document.getElementById('rdDob')?.value    || null,
        patient_gender:      document.getElementById('rdGender')?.value || null,
        patient_phone:       document.getElementById('rdPhone')?.value.trim()  || null,
        patient_nationality: document.getElementById('rdNation')?.value.trim() || null,
        id_type:             document.getElementById('rdIdType')?.value  || null,
        id_number:           document.getElementById('rdIdNum')?.value.trim()  || null,
        vessel_name:         document.getElementById('rdVessel')?.value.trim() || null,
        port_of_call:        document.getElementById('rdPort')?.value.trim()   || null,
        chief_complaint:     document.getElementById('rdComplaint')?.value.trim() || null,
      };
    }

    try {
      let savedId = postId;
      if (postId) {
        await API.patch(`/api/posts/${postId}`, { title, content: content || '(접수 폼 데이터 참조)', reception_data });
        toast('게시글이 수정되었습니다.', 'success');
      } else {
        const res = await API.post('/api/posts', { board_id: currentBoardId, title, content: content || '(접수 폼 데이터 참조)', reception_data });
        savedId = res.id;
        toast('게시글이 등록되었습니다.', 'success');
      }

      // 첨부파일 업로드
      const fileInput = document.getElementById('wAttachments');
      if (fileInput && fileInput.files.length > 0) {
        for (let file of fileInput.files) {
          const formData = new FormData();
          formData.append('file', file);
          await API.post(`/api/attachments/upload?post_id=${savedId}`, formData);
        }
        toast('첨부파일이 업로드되었습니다.', 'success');
      }

      await loadPost(savedId, currentBoardId);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function openEditView() {
    openWriteView(currentPostId);
  }

  async function deletePost() {
    if (!confirm('게시글을 삭제하시겠습니까? 첨부파일도 함께 삭제됩니다.')) return;
    try {
      await API.delete(`/api/posts/${currentPostId}`);
      toast('게시글이 삭제되었습니다.', 'success');
      await openBoard(currentBoardId);
    } catch (err) { toast(err.message, 'error'); }
  }

  // ── CSV 내보내기 ──────────────────────────────────────────
  async function exportCSV() {
    const status = document.getElementById('statusFilter').value;
    const params = new URLSearchParams({ board_id: currentBoardId, ...(status ? { status } : {}) });
    try {
      await API.download(`/api/posts/export?${params}`, `reception_${currentBoardId}_${Date.now()}.csv`);
      toast('CSV 파일이 다운로드되었습니다.', 'success');
    } catch (err) { toast(err.message, 'error'); }
  }

  // ── 게시판 생성 모달 ──────────────────────────────────────
  function openCreateBoardModal() {
    document.getElementById('modalCreateBoard').style.display = 'flex';
  }
  function closeCreateBoardModal() {
    document.getElementById('modalCreateBoard').style.display = 'none';
  }
  async function submitCreateBoard() {
    const name  = document.getElementById('mbName').value.trim();
    const desc  = document.getElementById('mbDesc').value.trim();
    const type  = document.getElementById('mbType').value;
    const order = parseInt(document.getElementById('mbOrder').value) || 0;
    const access= document.getElementById('mbAccess').value;
    const write = document.getElementById('mbWrite').value;
    if (!name) { toast('게시판 이름을 입력하세요.', 'error'); return; }
    try {
      await API.post('/api/boards', { name, description: desc, type, sort_order: order, access_role: access, write_role: write });
      toast('게시판이 생성되었습니다.', 'success');
      closeCreateBoardModal();
      document.getElementById('mbName').value = '';
      document.getElementById('mbDesc').value = '';
      await loadBoards();
    } catch (err) { toast(err.message, 'error'); }
  }

  // ── 사용자 관리 뷰 ────────────────────────────────────────
  async function loadUsersView() {
    showView('users');
    setBreadcrumb([{ label: '사용자 관리' }]);
    const el = document.getElementById('userManageContent');
    el.innerHTML = '<div class="loading-row">불러오는 중...</div>';

    try {
      const data = await API.get('/api/users?limit=100');
      const rows = (data.users || []).map(u => `
        <tr>
          <td>${u.id}</td>
          <td>${esc(u.name)}</td>
          <td style="font-family:var(--mono);font-size:12px">${esc(u.email)}</td>
          <td>${esc(u.company_name||'-')}</td>
          <td><span class="badge ${u.role==='superadmin'?'badge-accepted':u.role==='pending'?'badge-rejected':'badge-submitted'}">${ROLE_LABEL[u.role]||u.role}</span></td>
          <td><span style="color:${u.is_active?'var(--success)':'var(--error)'}">●</span> ${u.is_active?'활성':'비활성'}</td>
          <td style="font-size:12px;color:var(--muted)">${fmtDate(u.created_at)}</td>
          <td>
            <button class="btn-ghost btn-sm" onclick="App.openUserEdit(${u.id})">수정</button>
          </td>
        </tr>`).join('');

      el.innerHTML = `
        <div class="mgmt-table-wrap">
          <table class="mgmt-table">
            <thead><tr><th>ID</th><th>이름</th><th>이메일</th><th>관계사</th><th>역할</th><th>상태</th><th>가입일</th><th></th></tr></thead>
            <tbody>${rows || '<tr><td colspan="8" class="empty-td">사용자 없음</td></tr>'}</tbody>
          </table>
        </div>`;
    } catch (err) {
      el.innerHTML = `<div style="color:var(--error);padding:20px">${err.message}</div>`;
    }
  }

  async function openUserEdit(userId) {
    const data = await API.get(`/api/users/${userId}`);
    const u    = data.user;
    if (!companyList.length) await loadCompanyList();
    const modal = document.createElement('div');
    modal.className = 'modal-backdrop';
    modal.id = 'modalUserEdit';
    modal.innerHTML = `
      <div class="modal">
        <div class="modal-header"><h2>사용자 수정 — ${esc(u.name)}</h2><button class="modal-x" onclick="document.getElementById('modalUserEdit').remove()">✕</button></div>
        <div class="modal-body">
          <div class="mf-group"><label>역할</label>
            <select id="ueRole">
              ${['superadmin','admin','staff','partner','pending'].map(r =>
                `<option value="${r}" ${u.role===r?'selected':''}>${ROLE_LABEL[r]}</option>`).join('')}
            </select>
          </div>
          <div class="mf-group"><label>소속 관계사</label>
            <select id="ueCompany">
              <option value="">없음</option>
              ${companyList.map(c => `<option value="${c.id}" ${u.company_id===c.id?'selected':''}>${esc(c.name)}</option>`).join('')}
            </select>
          </div>
          <div class="mf-group"><label>활성 상태</label>
            <select id="ueActive">
              <option value="1" ${u.is_active?'selected':''}>활성</option>
              <option value="0" ${!u.is_active?'selected':''}>비활성</option>
            </select>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn-ghost" onclick="document.getElementById('modalUserEdit').remove()">취소</button>
          <button class="btn-primary" onclick="App.saveUserEdit(${userId})">저장</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
  }

  async function saveUserEdit(userId) {
    const role      = document.getElementById('ueRole').value;
    const companyId = document.getElementById('ueCompany').value;
    const isActive  = parseInt(document.getElementById('ueActive').value);
    try {
      await API.patch(`/api/users/${userId}`, { role, company_id: companyId ? parseInt(companyId) : null, is_active: isActive });
      toast('사용자 정보가 수정되었습니다.', 'success');
      document.getElementById('modalUserEdit')?.remove();
      loadUsersView();
    } catch (err) { toast(err.message, 'error'); }
  }

  // ── 관계사 관리 뷰 ────────────────────────────────────────
  async function loadCompanyList() {
    const data = await API.get('/api/companies');
    companyList = data.companies || [];
    return companyList;
  }

  async function loadCompaniesView() {
    showView('companies');
    setBreadcrumb([{ label: '관계사 관리' }]);
    const el = document.getElementById('companyListContent');
    el.innerHTML = '<div class="loading-row">불러오는 중...</div>';

    try {
      const list = await loadCompanyList();
      const rows = list.map(c => `
        <tr>
          <td>${c.id}</td>
          <td><strong>${esc(c.name)}</strong></td>
          <td>${COMPANY_TYPE[c.type]||c.type}</td>
          <td>${esc(c.contact||'-')}</td>
          <td>${c.user_count || 0}명</td>
          <td style="font-size:12px;color:var(--muted)">${fmtDate(c.created_at)}</td>
          <td>
            <button class="btn-ghost btn-sm" onclick="App.openCompanyModal(${c.id})">수정</button>
            ${currentUser.role === 'superadmin' ? `<button class="btn-danger btn-sm" onclick="App.deleteCompany(${c.id})">삭제</button>` : ''}
          </td>
        </tr>`).join('');

      el.innerHTML = `
        <div class="mgmt-table-wrap">
          <table class="mgmt-table">
            <thead><tr><th>ID</th><th>관계사명</th><th>유형</th><th>연락처</th><th>소속 사용자</th><th>등록일</th><th></th></tr></thead>
            <tbody>${rows || '<tr><td colspan="7" class="empty-td">관계사 없음</td></tr>'}</tbody>
          </table>
        </div>`;
    } catch (err) {
      el.innerHTML = `<div style="color:var(--error);padding:20px">${err.message}</div>`;
    }
  }

  async function openCompanyModal(companyId = null) {
    editingCompanyId = companyId;
    let c = {};
    if (companyId) {
      const found = companyList.find(x => x.id === companyId);
      if (found) c = found;
    }
    document.getElementById('companyModalTitle').textContent = companyId ? '관계사 수정' : '관계사 추가';
    document.getElementById('cmName').value    = c.name    || '';
    document.getElementById('cmType').value    = c.type    || 'other';
    document.getElementById('cmContact').value = c.contact || '';
    document.getElementById('cmMemo').value    = c.memo    || '';
    document.getElementById('modalCompany').style.display = 'flex';
  }

  function closeCompanyModal() {
    document.getElementById('modalCompany').style.display = 'none';
    editingCompanyId = null;
  }

  async function submitCompany() {
    const name    = document.getElementById('cmName').value.trim();
    const type    = document.getElementById('cmType').value;
    const contact = document.getElementById('cmContact').value.trim();
    const memo    = document.getElementById('cmMemo').value.trim();
    if (!name) { toast('관계사명을 입력하세요.', 'error'); return; }

    try {
      if (editingCompanyId) {
        await API.patch(`/api/companies/${editingCompanyId}`, { name, type, contact, memo });
        toast('관계사가 수정되었습니다.', 'success');
      } else {
        await API.post('/api/companies', { name, type, contact, memo });
        toast('관계사가 추가되었습니다.', 'success');
      }
      closeCompanyModal();
      await loadCompaniesView();
    } catch (err) { toast(err.message, 'error'); }
  }

  async function deleteCompany(companyId) {
    if (!confirm('관계사를 비활성화하시겠습니까?')) return;
    try {
      await API.delete(`/api/companies/${companyId}`);
      toast('관계사가 비활성화되었습니다.', 'success');
      await loadCompaniesView();
    } catch (err) { toast(err.message, 'error'); }
  }

  // ── XSS 방지 ─────────────────────────────────────────────
  function esc(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ── Public API ────────────────────────────────────────────
  return {
    init, goHome,
    openBoard, loadPosts, loadPost, goPage,
    openWriteView, openEditView, submitPost, deletePost,
    uploadFiles, downloadFile, deleteFile, viewImage,
    changeStatus, changeAssign,
    replyTo, cancelReply, editComment, deleteComment,
    exportCSV,
    openCreateBoardModal, closeCreateBoardModal, submitCreateBoard,
    openUserEdit, saveUserEdit,
    openCompanyModal, closeCompanyModal, submitCompany, deleteCompany,
    loadCompaniesView, loadUsersView,
    // toast 노출
    toast
  };
})();

// 앱 초기화
document.addEventListener('DOMContentLoaded', () => {
  const token = localStorage.getItem('bahemr_token');
  if (!token) { window.location.href = '/index.html'; return; }
  App.init();
});
