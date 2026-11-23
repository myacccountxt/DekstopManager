import { useState } from 'react';

const defaultForm = {
  username: '',
  currentPassword: '',
  recoveryCode: '',
  newPassword: '',
  confirmPassword: '',
};

export default function ResetPasswordPage({ onReset, onBack, error }) {
  const [form, setForm] = useState(defaultForm);
  const [useCurrentPassword, setUseCurrentPassword] = useState(false);

  const handleSubmit = (event) => {
    event.preventDefault();
    onReset(form);
  };

  return (
    <div className="auth-page">
      <div className="login-card reset-card">
        <div className="brand-wrap">
          <div className="brand-icon">R</div>
          <div>
            <p className="brand-kicker">Pemulihan Akun</p>
            <h1 className="brand-title">Lupa Password?</h1>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="auth-form">
          <label className="field-label" htmlFor="reset-username">
            Username
          </label>
          <input
            id="reset-username"
            type="text"
            value={form.username}
            onChange={(event) => setForm({ ...form, username: event.target.value })}
            placeholder="Masukkan username"
            autoComplete="username"
            required
          />

          <label className="field-label" htmlFor={useCurrentPassword ? 'current-password' : 'recovery-code'}>
            {useCurrentPassword ? 'Password Saat Ini' : 'Kode Pemulihan'}
          </label>
          {useCurrentPassword ? (
            <input
              id="current-password"
              type="password"
              value={form.currentPassword}
              onChange={(event) => setForm({ ...form, currentPassword: event.target.value })}
              placeholder="Masukkan password saat ini"
              autoComplete="current-password"
              required
            />
          ) : (
            <>
              <input
                id="recovery-code"
                type="text"
                value={form.recoveryCode}
                onChange={(event) => setForm({ ...form, recoveryCode: event.target.value })}
                placeholder="Masukkan kode pemulihan akun"
                autoComplete="off"
                required
              />
              <p className="auth-help">
                Gunakan kode yang disimpan saat akun dibuat atau yang terakhir dibuat dari dashboard.
                Jika belum memiliki kode, masuk dengan password lalu buat kode pemulihan dari dashboard.
              </p>
            </>
          )}
          <button
            type="button"
            className="text-link auth-mode-link"
            onClick={() => setUseCurrentPassword((current) => !current)}
          >
            {useCurrentPassword ? 'Saya lupa password dan punya kode pemulihan' : 'Saya masih ingat password saat ini'}
          </button>

          <label className="field-label" htmlFor="new-password">
            Password Baru
          </label>
          <input
            id="new-password"
            type="password"
            value={form.newPassword}
            onChange={(event) => setForm({ ...form, newPassword: event.target.value })}
            placeholder="Masukkan password baru"
            minLength={8}
            autoComplete="new-password"
            required
          />

          <label className="field-label" htmlFor="confirm-password">
            Konfirmasi Password Baru
          </label>
          <input
            id="confirm-password"
            type="password"
            value={form.confirmPassword}
            onChange={(event) => setForm({ ...form, confirmPassword: event.target.value })}
            placeholder="Konfirmasi password baru"
            minLength={8}
            autoComplete="new-password"
            required
          />

          {error ? <p className="error-text">{error}</p> : null}

          <button type="submit" className="primary-button full-width">
            Simpan Password Baru
          </button>

          <button type="button" className="secondary-button full-width" onClick={onBack}>
            Kembali ke Login
          </button>
        </form>
      </div>
    </div>
  );
}
