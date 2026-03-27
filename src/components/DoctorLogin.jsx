import React, { useState } from 'react';
import './AdminDoctor.css';

const DoctorLogin = ({ onLogin, onBack }) => {
  const [mode, setMode] = useState('login');
  const [fullName, setFullName] = useState('');
  const [uniqueId, setUniqueId] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [saveToPasswordManager, setSaveToPasswordManager] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const isValidDoctorId = (value) => /^DOC-[0-9]{4,}$/.test(value.trim().toUpperCase());
  const isStrongPassword = (value) => {
    return (
      value.length >= 8 &&
      /[A-Z]/.test(value) &&
      /[a-z]/.test(value) &&
      /[0-9]/.test(value) &&
      /[^A-Za-z0-9]/.test(value)
    );
  };

  const passwordChecks = [
    { label: `At least 8 characters (${password.length}/8)`, valid: password.length >= 8 },
    { label: 'One uppercase letter (A-Z)', valid: /[A-Z]/.test(password) },
    { label: 'One lowercase letter (a-z)', valid: /[a-z]/.test(password) },
    { label: 'One number (0-9)', valid: /[0-9]/.test(password) },
    { label: 'One special character (!@#$...)', valid: /[^A-Za-z0-9]/.test(password) },
  ];
  const generatePassword = () => {
    const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const lower = 'abcdefghijkmnopqrstuvwxyz';
    const digits = '23456789';
    const specials = '!@#$%^&*';
    const all = upper + lower + digits + specials;

    const chars = [
      upper[Math.floor(Math.random() * upper.length)],
      lower[Math.floor(Math.random() * lower.length)],
      digits[Math.floor(Math.random() * digits.length)],
      specials[Math.floor(Math.random() * specials.length)]
    ];
    while (chars.length < 12) {
      chars.push(all[Math.floor(Math.random() * all.length)]);
    }
    const shuffled = chars.sort(() => Math.random() - 0.5).join('');
    setPassword(shuffled);
  };

  const saveCredentials = async (id, plainPassword) => {
    if (!saveToPasswordManager) return;
    if (!window.PasswordCredential || !navigator.credentials?.store) return;

    try {
      const credential = new window.PasswordCredential({
        id,
        password: plainPassword,
        name: 'Doctor',
      });
      await navigator.credentials.store(credential);
    } catch (err) {
      // Some browsers may block or not support credential storage in this context.
      console.warn('Unable to store credentials in password manager', err);
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!isValidDoctorId(uniqueId)) {
      setError('Enter a valid Doctor ID in DOC-1234 format.');
      return;
    }

    try {
      const response = await fetch('http://localhost:8000/api/login/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ unique_id: uniqueId.trim().toUpperCase(), password }),
      });
      if (response.ok) {
        const data = await response.json();
        onLogin(data.user, data.token);
      } else {
        const data = await response.json().catch(() => ({}));
        setError(data.error || 'Invalid credentials');
      }
    } catch {
      setError('Login failed');
    }
  };

  const handleSignup = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!fullName.trim()) {
      setError('Full name is required.');
      return;
    }
    if (!/^[A-Za-z\s]+$/.test(fullName.trim())) {
      setError('Full name can only contain English letters and spaces.');
      return;
    }
    if (!isValidDoctorId(uniqueId)) {
      setError('Enter a valid Doctor ID in DOC-1234 format.');
      return;
    }
    if (!isStrongPassword(password)) {
      setError('Password must be at least 8 chars and include uppercase, lowercase, number, and special character.');
      return;
    }
    try {
      const normalizedId = uniqueId.trim().toUpperCase();
      const response = await fetch('http://localhost:8000/api/signup/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ full_name: fullName.trim(), unique_id: normalizedId, password, role: 'doctor' }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Sign up failed');
      }

      await saveCredentials(normalizedId, password);

      setSuccess('Doctor account created successfully. You can now log in.');
      setMode('login');
    } catch (err) {
      setError(err.message || 'Sign up failed');
    }
  };

  const handleSendOtp = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!isValidDoctorId(uniqueId)) {
      setError('Enter a valid Doctor ID in DOC-1234 format.');
      return;
    }
    if (!email.trim()) {
      setError('Email is required for password reset.');
      return;
    }

    try {
      const response = await fetch('http://localhost:8000/api/request-reset-otp/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          unique_id: uniqueId.trim().toUpperCase(),
          email: email.trim(),
          role: 'doctor',
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to send OTP');
      }

      setOtpSent(true);
      setSuccess('OTP sent. Enter OTP and your new password.');
    } catch (err) {
      setError(err.message || 'Failed to send OTP');
    }
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!isValidDoctorId(uniqueId)) {
      setError('Enter a valid Doctor ID in DOC-1234 format.');
      return;
    }
    if (!email.trim()) {
      setError('Email is required for password reset.');
      return;
    }
    if (!otpCode.trim()) {
      setError('Enter the OTP sent to your email.');
      return;
    }
    if (!isStrongPassword(password)) {
      setError('New password must be at least 8 chars and include uppercase, lowercase, number, and special character.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    try {
      const response = await fetch('http://localhost:8000/api/verify-reset-otp/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          unique_id: uniqueId.trim().toUpperCase(),
          email: email.trim(),
          otp_code: otpCode.trim(),
          new_password: password,
          role: 'doctor',
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Password reset failed');
      }

      setSuccess('Password reset successful. Please log in with your new password.');
      setMode('login');
      setPassword('');
      setConfirmPassword('');
      setOtpCode('');
      setOtpSent(false);
    } catch (err) {
      setError(err.message || 'Password reset failed');
    }
  };

  return (
    <div className="login-container">
      <h2>Doctor Login</h2>
      <div className="auth-tabs">
        <button
          type="button"
          className={`auth-tab ${mode === 'login' ? 'active' : ''}`}
          onClick={() => {
            setMode('login');
            setOtpSent(false);
            setOtpCode('');
          }}
        >
          Login
        </button>
        <button
          type="button"
          className={`auth-tab ${mode === 'signup' ? 'active' : ''}`}
          onClick={() => {
            setMode('signup');
            setOtpSent(false);
            setOtpCode('');
          }}
        >
          Sign Up
        </button>
        <button
          type="button"
          className={`auth-tab ${mode === 'reset' ? 'active' : ''}`}
          onClick={() => {
            setMode('reset');
            setOtpSent(false);
            setOtpCode('');
          }}
        >
          Forgot Password?
        </button>
      </div>
      {error && <div className="login-error">{error}</div>}
      {success && <div className="login-success">{success}</div>}
      <form
        className="login-form"
        autoComplete="off"
        onSubmit={mode === 'login' ? handleLogin : mode === 'signup' ? handleSignup : (otpSent ? handleResetPassword : handleSendOtp)}
      >
        {mode === 'signup' && (
          <label>
            Full Name
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Enter doctor full name"
              autoComplete="off"
            />
          </label>
        )}
        <label>
          Doctor ID
          <input
            type="text"
            value={uniqueId}
            onChange={(e) => setUniqueId(e.target.value)}
            placeholder="DOC-1234"
            autoComplete="off"
          />
        </label>
        {mode === 'reset' && (
          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="off"
              required
            />
          </label>
        )}
        {mode === 'reset' && otpSent && (
          <label>
            OTP Code
            <input
              type="text"
              value={otpCode}
              onChange={(e) => setOtpCode(e.target.value)}
              placeholder="Enter 6-digit OTP"
              inputMode="numeric"
            />
          </label>
        )}
        {(mode !== 'reset' || otpSent) && (
          <label>
            {mode === 'reset' ? 'New Password' : 'Password'}
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            />
          </label>
        )}
        {(mode === 'signup' || (mode === 'reset' && otpSent)) && (
          <div className="password-rules" aria-live="polite">
            {passwordChecks.map((rule) => (
              <p key={rule.label} className={`password-rule ${rule.valid ? 'valid' : 'invalid'}`}>
                {rule.label}
              </p>
            ))}
          </div>
        )}
        {mode === 'reset' && otpSent && (
          <label>
            Confirm New Password
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="off"
            />
          </label>
        )}
        {mode === 'signup' && (
          <>
            <button type="button" className="btn-secondary" onClick={generatePassword}>Auto Generate Password</button>
            <label className="password-manager-option">
              <input
                type="checkbox"
                checked={saveToPasswordManager}
                onChange={(e) => setSaveToPasswordManager(e.target.checked)}
              />
              Save this login to my password manager
            </label>
          </>
        )}
        <div className="login-buttons">
          <button type="submit" className="btn-login">
            {mode === 'login' ? 'Log In' : mode === 'signup' ? 'Create Doctor Account' : (otpSent ? 'Verify OTP and Reset Password' : 'Send OTP')}
          </button>
          <button type="button" className="btn-secondary" onClick={onBack}>
            Back
          </button>
        </div>

        {mode === 'login' && (
          <p className="auth-hint">
            Don't have an account?{' '}
            <button
              type="button"
              className="auth-link-btn"
              onClick={() => {
                setMode('signup');
                setOtpSent(false);
                setOtpCode('');
              }}
            >
              Sign Up
            </button>
          </p>
        )}
      </form>
    </div>
  );
};

export default DoctorLogin;