import { useState } from 'react';
import Dashboard from './components/Dashboard';
import LoginPage from './components/LoginPage';
import RegisterPage from './components/RegisterPage';
import ResetPasswordPage from './components/ResetPasswordPage';

export default function App() {
  const [page, setPage] = useState('login');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [user, setUser] = useState(null);

  const handleLogin = async (credentials) => {
    try {
      setNotice('');
      const result = await window.electronAPI.login(credentials);
      if (!result.success) {
        setError(result.message);
        return;
      }

      setUser(result.user);
      setError('');
      setNotice('');
      setRecoveryCode('');
      setPage('dashboard');
    } catch {
      setError('Terjadi kesalahan saat menghubungkan ke server E-Arsip.');
    }
  };

  const handleRegister = async (payload) => {
    try {
      const result = await window.electronAPI.register(payload);
      if (!result.success) {
        setError(result.message);
        return;
      }

      setError('');
      setNotice(result.message);
      setRecoveryCode(result.recoveryCode || '');
      setPage('login');
    } catch {
      setError('Terjadi kesalahan saat membuat akun.');
    }
  };

  const handleResetPassword = async (payload) => {
    try {
      const result = await window.electronAPI.resetPassword(payload);
      if (!result.success) {
        setError(result.message);
        return;
      }

      setError('');
      setNotice(result.message);
      setPage('login');
    } catch {
      setError('Gagal mengubah password.');
    }
  };

  const handleLogout = async () => {
    await window.electronAPI.logout();
    setUser(null);
    setPage('login');
  };

  if (page === 'reset') {
    return <ResetPasswordPage onReset={handleResetPassword} onBack={() => setPage('login')} error={error} />;
  }

  if (page === 'register') {
    return <RegisterPage onRegister={handleRegister} onBack={() => { setError(''); setPage('login'); }} error={error} />;
  }

  if (page === 'dashboard') {
    return <Dashboard onLogout={handleLogout} user={user} />;
  }

  return (
    <LoginPage
      onLogin={handleLogin}
      onForgotPassword={() => { setError(''); setNotice(''); setRecoveryCode(''); setPage('reset'); }}
      onRegister={() => { setError(''); setNotice(''); setRecoveryCode(''); setPage('register'); }}
      onDismissRecoveryCode={() => setRecoveryCode('')}
      error={error}
      notice={notice}
      recoveryCode={recoveryCode}
    />
  );
}
