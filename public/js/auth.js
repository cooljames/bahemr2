/**
 * 로그인 페이지 스크립트.
 */
(function () {
  // 이미 로그인된 경우 대시보드로
  const token = localStorage.getItem('bahemr_token');
  if (token) {
    window.location.href = '/dashboard.html';
    return;
  }

  const form     = document.getElementById('loginForm');
  const emailEl  = document.getElementById('email');
  const pwEl     = document.getElementById('password');
  const errorEl  = document.getElementById('loginError');
  const loginBtn = document.getElementById('loginBtn');
  const pwToggle = document.getElementById('pwToggle');

  // 비밀번호 표시/숨김
  pwToggle.addEventListener('click', () => {
    const isText = pwEl.type === 'text';
    pwEl.type = isText ? 'password' : 'text';
  });

  function setLoading(on) {
    loginBtn.disabled = on;
    loginBtn.querySelector('.btn-text').style.display    = on ? 'none' : '';
    loginBtn.querySelector('.btn-spinner').style.display = on ? 'flex' : 'none';
  }

  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.style.display = msg ? 'block' : 'none';
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    showError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          email:    emailEl.value.trim(),
          password: pwEl.value
        })
      });

      const data = await res.json();

      if (!res.ok) {
        showError(data.error || '로그인에 실패했습니다.');
        return;
      }

      // 저장 후 대시보드로
      localStorage.setItem('bahemr_token', data.token);
      localStorage.setItem('bahemr_user',  JSON.stringify(data.user));
      window.location.href = '/dashboard.html';

    } catch (err) {
      showError('서버 연결에 실패했습니다. 잠시 후 다시 시도하세요.');
    } finally {
      setLoading(false);
    }
  });
})();
