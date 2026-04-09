/**
 * bahEMR API 클라이언트
 * 모든 fetch 요청을 래핑 — JWT 자동 첨부, 에러 처리.
 */
const API = (() => {
  const BASE = '';  // same-origin

  function getToken() {
    return localStorage.getItem('bahemr_token') || '';
  }

  function setToken(token) {
    localStorage.setItem('bahemr_token', token);
  }

  function clearToken() {
    localStorage.removeItem('bahemr_token');
    localStorage.removeItem('bahemr_user');
  }

  function setUser(user) {
    localStorage.setItem('bahemr_user', JSON.stringify(user));
  }

  function getUser() {
    try { return JSON.parse(localStorage.getItem('bahemr_user') || 'null'); }
    catch { return null; }
  }

  async function request(method, path, body, isFormData = false) {
    const headers = { Authorization: `Bearer ${getToken()}` };
    if (!isFormData) headers['Content-Type'] = 'application/json';

    const init = { method, headers };
    if (body) {
      init.body = isFormData ? body : JSON.stringify(body);
    }

    const res = await fetch(BASE + path, init);

    if (res.status === 401) {
      clearToken();
      window.location.href = '/index.html';
      return;
    }

    let data;
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      data = await res.json();
    } else {
      data = await res.blob();
    }

    if (!res.ok) {
      const msg = (data && data.error) ? data.error : `HTTP ${res.status}`;
      throw new Error(msg);
    }

    return data;
  }

  return {
    getToken, setToken, clearToken,
    setUser,  getUser,

    get:    (path)         => request('GET',    path),
    post:   (path, body)   => request('POST',   path, body),
    put:    (path, body)   => request('PUT',    path, body),
    patch:  (path, body)   => request('PATCH',  path, body),
    delete: (path)         => request('DELETE', path),
    upload: (path, formData) => request('POST', path, formData, true),

    /** CSV 다운로드용 */
    async download(path, filename) {
      const res = await fetch(BASE + path, {
        headers: { Authorization: `Bearer ${getToken()}` }
      });
      if (!res.ok) throw new Error('다운로드 실패');
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = filename || 'export.csv';
      a.click();
      URL.revokeObjectURL(url);
    },

    /** 첨부파일 다운로드 */
    async downloadAttachment(attId, filename) {
      const res = await fetch(`/api/attachments/${attId}/download`, {
        headers: { Authorization: `Bearer ${getToken()}` }
      });
      if (!res.ok) throw new Error('다운로드 실패');
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    }
  };
})();
