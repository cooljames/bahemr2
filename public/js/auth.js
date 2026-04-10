/**
 * bahEMR2 로그인 페이지 스크립트
 */

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('loginForm');
  const emailInput = document.getElementById('email');
  const passwordInput = document.getElementById('password');
  const loginBtn = document.getElementById('loginBtn');
  const errorDiv = document.getElementById('loginError');
  const pwToggle = document.getElementById('pwToggle');

  // 비밀번호 표시/숨김 토글
  if (pwToggle) {
    pwToggle.addEventListener('click', () => {
      const type = passwordInput.getAttribute('type') === 'password' ? 'text' : 'password';
      passwordInput.setAttribute('type', type);
      
      // 아이콘 변경 (선택사항)
      const eyeIcon = document.getElementById('eyeIcon');
      if (type === 'text') {
        eyeIcon.innerHTML = '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>';
      } else {
        eyeIcon.innerHTML = '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
      }
    });
  }

  // 폼 제출 이벤트
  form.addEventListener('submit', async (e) => {
    e.preventDefault(); // 기본 제출 방지 (중요!)
    
    const email = emailInput.value.trim();
    const password = passwordInput.value;

    // 간단한 유효성 검사
    if (!email || !password) {
      showError('이메일과 비밀번호를 모두 입력하세요.');
      return;
    }

    // 이메일 형식 검증
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      showError('올바른 이메일 형식이 아닙니다.');
      return;
    }

    // 로딩 상태 시작
    setLoading(true);
    hideError();

    try {
      // API 요청
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ email, password })
      });

      const data = await response.json();

      if (!response.ok) {
        // 에러 응답 처리
        showError(data.error || '로그인에 실패했습니다.');
        return;
      }

      // 성공 시 토큰과 사용자 정보 저장
      if (data.token && data.user) {
        localStorage.setItem('bahemr_token', data.token);
        localStorage.setItem('bahemr_user', JSON.stringify(data.user));
        
        // 대시보드로 리다이렉트
        window.location.href = '/dashboard.html';
      } else {
        showError('로그인 응답 형식이 올바르지 않습니다.');
      }

    } catch (error) {
      console.error('로그인 에러:', error);
      showError('서버 연결에 실패했습니다. 잠시 후 다시 시도해주세요.');
    } finally {
      setLoading(false);
    }
  });

  // 로딩 상태 관리
  function setLoading(isLoading) {
    const btnText = loginBtn.querySelector('.btn-text');
    const btnSpinner = loginBtn.querySelector('.btn-spinner');
    
    if (isLoading) {
      loginBtn.disabled = true;
      btnText.style.display = 'none';
      btnSpinner.style.display = 'inline-block';
      emailInput.disabled = true;
      passwordInput.disabled = true;
    } else {
      loginBtn.disabled = false;
      btnText.style.display = 'inline';
      btnSpinner.style.display = 'none';
      emailInput.disabled = false;
      passwordInput.disabled = false;
    }
  }

  // 에러 메시지 표시
  function showError(message) {
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';
  }

  // 에러 메시지 숨김
  function hideError() {
    errorDiv.textContent = '';
    errorDiv.style.display = 'none';
  }

  // 이미 로그인된 경우 대시보드로 이동
  const token = localStorage.getItem('bahemr_token');
  if (token) {
    // 토큰 유효성 간단 체크 (만료 시간 등은 서버에서 체크)
    window.location.href = '/dashboard.html';
  }
});
