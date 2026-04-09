/**
 * 회원가입 페이지 스크립트
 */
(async function () {
  const token = localStorage.getItem('bahemr_token');
  if (token) { window.location.href = '/dashboard.html'; return; }

  const form       = document.getElementById('signupForm');
  const errorEl    = document.getElementById('signupError');
  const successEl  = document.getElementById('signupSuccess');
  const signupBtn  = document.getElementById('signupBtn');
  const companyEl  = document.getElementById('company');

  // 관계사 목록 로드
  try {
    const res  = await fetch('/api/auth/companies-public');
    if (res.ok) {
      const data = await res.json();
      (data.companies || []).forEach(c => {
        const opt = document.createElement('option');
        opt.value       = c.id;
        opt.textContent = c.name;
        companyEl.appendChild(opt);
      });
    }
  } catch {
    // 관계사 목록 로드 실패는 무시 (선택 사항)
  }

  function setLoading(on) {
    signupBtn.disabled = on;
    signupBtn.querySelector('.btn-text').style.display    = on ? 'none' : '';
    signupBtn.querySelector('.btn-spinner').style.display = on ? 'flex' : 'none';
  }

  function showError(msg) {
    errorEl.textContent   = msg;
    errorEl.style.display = msg ? 'block' : 'none';
    successEl.style.display = 'none';
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    showError('');

    const name      = document.getElementById('name').value.trim();
    const email     = document.getElementById('email').value.trim();
    const pw        = document.getElementById('password').value;
    const pw2       = document.getElementById('password2').value;
    const companyId = companyEl.value || null;

    if (!name)  return showError('이름을 입력하세요.');
    if (!email) return showError('이메일을 입력하세요.');
    if (pw.length < 8) return showError('비밀번호는 8자 이상이어야 합니다.');
    if (pw !== pw2)    return showError('비밀번호가 일치하지 않습니다.');

    setLoading(true);
    try {
      const res = await fetch('/api/auth/signup', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ name, email, password: pw, company_id: companyId ? parseInt(companyId) : null })
      });

      const data = await res.json();
      if (!res.ok) {
        showError(data.error || '회원가입에 실패했습니다.');
        return;
      }

      successEl.textContent   = '회원가입이 완료되었습니다! 관리자 승인 후 로그인하실 수 있습니다.';
      successEl.style.display = 'block';
      form.reset();

      setTimeout(() => { window.location.href = '/index.html'; }, 2500);

    } catch {
      showError('서버 연결에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  });
})();
