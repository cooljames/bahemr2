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

  /**
   * 핵심 요청 함수
   * body가 FormData이면 Content-Type 헤더를 설정하지 않음
   * (브라우저가 multipart/form-data + boundary를 자동으로 처리)
   */
  async function request(method, path, body) {
    const headers = { Authorization: `Bearer ${getToken()}` };

    const isFormData = body instanceof FormData;
    if (body && !isFormData) {
      headers['Content-Type'] = 'application/json';
    }

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

    const ct = res.headers.get('content-type') || '';
    let data;
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

  /** 파일 업로드 전용 (FormData) */
  async function upload(path, formData) {
    return request('POST', path, formData);
  }

  return {
    getToken, setToken, clearToken,
    setUser,  getUser,

    get:    (path)        => request('GET',    path),
    post:   (path, body)  => request('POST',   path, body),
    put:    (path, body)  => request('PUT',    path, body),
    patch:  (path, body)  => request('PATCH',  path, body),
    delete: (path)        => request('DELETE', path),
    upload,

    /** CSV / 일반 다운로드 */
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

    /** 첨부파일 이미지 Blob URL 가져오기 */
    async getAttachmentBlobUrl(attId) {
      const res = await fetch(`/api/attachments/${attId}`, {
        headers: { Authorization: `Bearer ${getToken()}` }
      });
      if (!res.ok) throw new Error('이미지 로드 실패');
      const blob = await res.blob();
      return URL.createObjectURL(blob);
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
