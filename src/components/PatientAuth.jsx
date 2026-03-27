import React, { useEffect, useState } from 'react';
import './AdminDoctor.css';

const PatientAuth = ({ onLogin, onBack }) => {
  const [mode, setMode] = useState('login');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [saveToPasswordManager, setSaveToPasswordManager] = useState(true);
  const [formNonce, setFormNonce] = useState(() => Date.now());
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    // Prevent stale browser-injected values when switching auth modes.
    setFullName('');
    setEmail('');
    setPassword('');
    setConfirmPassword('');
    setOtpCode('');
    setFormNonce(Date.now());
  }, [mode]);

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
        name: 'Patient',
      });
      await navigator.credentials.store(credential);
    } catch (err) {
      // Some browsers may block or not support credential storage in this context.
      console.warn('Unable to store credentials in password manager', err);
    }
  };

  const handlePatientLogin = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!email.trim() || !password) {
      setError('Email and password are required.');
      return;
    }

    try {
      const response = await fetch('http://localhost:8000/api/patient-login/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: email.trim(),
          password,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Patient login failed');
      }

      onLogin(data.user, data.token, data.patient);
    } catch (err) {
      setError(err.message || 'Patient login failed');
    }
  };

  const handlePatientSignup = async (e) => {
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

    if (!email.trim()) {
      setError('Email is required.');
      return;
    }

    if (!isStrongPassword(password)) {
      setError('Password must be at least 8 chars and include uppercase, lowercase, number, and special character.');
      return;
    }

    try {
      const response = await fetch('http://localhost:8000/api/patient-signup/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          full_name: fullName.trim(),
          email: email.trim(),
          phone_number: '',
          password,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Patient sign up failed');
      }

      await saveCredentials(email.trim(), password);

      setSuccess('Patient account created successfully. You can now log in.');
      setMode('login');
      setPassword('');
      setConfirmPassword('');
    } catch (err) {
      setError(err.message || 'Patient sign up failed');
    }
  };

  const handleSendOtp = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!email.trim()) {
      setError('Email is required for password reset.');
      return;
    }

    try {
      const response = await fetch('http://localhost:8000/api/patient-request-reset-otp/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email: email.trim() }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to send OTP');
      }

      setOtpSent(true);
      setSuccess('OTP sent to your email. Enter OTP and your new password.');
    } catch (err) {
      setError(err.message || 'Failed to send OTP');
    }
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!email.trim()) {
      setError('Email is required for password reset.');
      return;
    }
    if (!otpCode.trim()) {
      setError('Enter the OTP sent to your email.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    try {
      const response = await fetch('http://localhost:8000/api/patient-verify-reset-otp/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: email.trim(),
          otp_code: otpCode.trim(),
          new_password: password,
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
      <h2>Patient Access</h2>
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
        onSubmit={mode === 'login' ? handlePatientLogin : mode === 'signup' ? handlePatientSignup : (otpSent ? handleResetPassword : handleSendOtp)}
      >
        {/* Decoy fields reduce aggressive browser autofill into real inputs. */}
        <input type="text" name="fake_username" autoComplete="username" style={{ display: 'none' }} tabIndex={-1} />
        <input type="password" name="fake_password" autoComplete="current-password" style={{ display: 'none' }} tabIndex={-1} />

        {mode === 'signup' && (
          <label>
            Full Name
            <input
              key={`full-name-${mode}-${formNonce}`}
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="John Smith"
              autoComplete="off"
            />
          </label>
        )}

        <label>
          Email
          <input
            key={`email-${mode}-${formNonce}`}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
              autoComplete="off"
          />
        </label>

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
              key={`password-${mode}-${formNonce}`}
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
            {mode === 'login' ? 'Patient Log In' : mode === 'signup' ? 'Create Patient Account' : (otpSent ? 'Verify OTP and Reset Password' : 'Send OTP')}
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

export default PatientAuth;
