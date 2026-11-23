import { useState } from 'react';

const defaultForm = {
  username: '',
  password: '',
  confirmPassword: '',
  inviteCode: '',
};

export default function RegisterPage({ onRegister, onBack, error }) {
  const [form, setForm] = useState(defaultForm);

  const handleSubmit = (event) => {
    event.preventDefault();
    onRegister(form);
  };

  return (
    <div className="auth-page">
      <div className="login-card register-card">
        <div className="brand-wrap">
          <div className="brand-icon">A</div>
          <div>
            <p className="brand-kicker">Akun Pengguna</p>
            <h1 className="brand-title">Buat Akun</h1>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="auth-form">
          <label className="field-label" htmlFor="register-username">
            Username
          </label>
          <input
            id="register-username"
            type="text"
            value={form.username}
            onChange={(event) => setForm({ ...form, username: event.target.value })}
            placeholder="Buat username"
            minLength={3}
            maxLength={32}
            pattern="[a-zA-Z0-9._-]{3,32}"
            autoComplete="username"
            required
          />

          <label className="field-label" htmlFor="register-invite-code">
            Kode Undangan
          </label>
          <input
            id="register-invite-code"
            type="text"
            value={form.inviteCode}
            onChange={(event) => setForm({ ...form, inviteCode: event.target.value })}
            placeholder="Minta kode dari admin instansi"
            autoComplete="off"
            required
          />

          <label className="field-label" htmlFor="register-password">
            Password
          </label>
          <input
            id="register-password"
            type="password"
            value={form.password}
            onChange={(event) => setForm({ ...form, password: event.target.value })}
            placeholder="Minimal 8 karakter"
            minLength={8}
            autoComplete="new-password"
            required
          />

          <label className="field-label" htmlFor="register-confirm-password">
            Konfirmasi Password
          </label>
          <input
            id="register-confirm-password"
            type="password"
            value={form.confirmPassword}
            onChange={(event) => setForm({ ...form, confirmPassword: event.target.value })}
            placeholder="Ulangi password"
            minLength={8}
            autoComplete="new-password"
            required
          />

          {error ? <p className="error-text">{error}</p> : null}

          <button type="submit" className="primary-button full-width">
            Buat Akun
          </button>
          <button type="button" className="secondary-button full-width" onClick={onBack}>
            Kembali ke Login
          </button>
        </form>
      </div>
    </div>
  );
}