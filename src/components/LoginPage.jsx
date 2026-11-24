import { useState } from 'react';

const defaultForm = {
  username: '',
  password: '',
};

export default function LoginPage({ onLogin, onForgotPassword, onRegister, onDismissRecoveryCode, error, notice, recoveryCode }) {
  const [form, setForm] = useState(defaultForm);

  const handleSubmit = (event) => {
    event.preventDefault();
    onLogin(form);
  };

  return (
    <div className="auth-page">
      <div className="login-card">
        <div className="brand-wrap">
          <div className="brand-icon">E</div>
          <div>
            <p className="brand-kicker">Sistem Arsip</p>
            <h1 className="brand-title">E-Arsip Instansi</h1>
          </div>
        </div>
        <p className="brand-description">
          Masuk untuk mengakses, mengelola, dan menemukan dokumen arsip instansi Anda.
        </p>

        <form onSubmit={handleSubmit} className="auth-form">
          <label className="field-label" htmlFor="username">
            Username akun
          </label>
          <input
            id="username"
            type="text"
            value={form.username}
            onChange={(event) => setForm({ ...form, username: event.target.value })}
            placeholder="Ketik username Anda"
            autoComplete="username"
            required
          />

          <label className="field-label" htmlFor="password">
            Kata sandi
          </label>
          <input
            id="password"
            type="password"
            value={form.password}
            onChange={(event) => setForm({ ...form, password: event.target.value })}
            placeholder="Ketik kata sandi akun Anda"
            autoComplete="current-password"
            required
          />

          <div className="auth-links">
            <button type="button" className="text-link" onClick={onForgotPassword}>
              Lupa password?
            </button>
            <button type="button" className="text-link" onClick={onRegister}>
              Buat akun
            </button>
          </div>

          {error ? <p className="error-text">{error}</p> : null}
          {recoveryCode ? (
            <div className="recovery-code-notice" role="status">
              <p>{notice}</p>
              <code>{recoveryCode}</code>
              <button type="button" className="text-link" onClick={onDismissRecoveryCode}>
                Saya sudah menyimpan kode
              </button>
            </div>
          ) : notice ? <p className="success-text">{notice}</p> : null}

          <button type="submit" className="primary-button full-width">
            Masuk ke E-Arsip
          </button>
        </form>
      </div>
    </div>
  );
}
