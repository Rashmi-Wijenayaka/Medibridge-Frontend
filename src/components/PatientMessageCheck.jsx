import React, { useState } from 'react';
import './PatientMessageCheck.css';
import { apiUrl } from '../api';

const PatientMessageCheck = ({ onBack }) => {
  const [searchMethod, setSearchMethod] = useState('phone'); // 'phone' or 'email'
  const [searchInput, setSearchInput] = useState('');
  const [messages, setMessages] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searched, setSearched] = useState(false);

  const handleSearch = async (e) => {
    e.preventDefault();
    setError('');
    setMessages(null);
    setLoading(true);
    setSearched(false);

    const query = searchInput.trim();
    if (!query) {
      setError(`Please enter a ${searchMethod === 'phone' ? 'phone number' : 'email address'}`);
      setLoading(false);
      return;
    }

    try {
      const endpoint = searchMethod === 'phone'
        ? apiUrl(`/api/check-messages/?phone=${encodeURIComponent(query)}`)
        : apiUrl(`/api/check-messages/?email=${encodeURIComponent(query)}`);

      const res = await fetch(endpoint);
      const data = await res.json();

      setSearched(true);

      if (!res.ok) {
        setError(data.error || 'Could not find any records');
        setLoading(false);
        return;
      }

      setMessages(data);
    } catch (err) {
      setSearched(true);
      setError('Error checking for messages. Please try again.');
      console.error('Error:', err);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString) => {
    try {
      const date = new Date(dateString);
      return date.toLocaleString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return dateString;
    }
  };

  return (
    <div className="message-check-container">
      <div className="message-check-card">
        {/* Header */}
        <div className="message-check-header">
          <button className="back-button" onClick={onBack} title="Go back">
            ← Back
          </button>
          <h2>📨 Check Your Messages</h2>
          <p className="subtitle">View messages from your doctor without logging in</p>
        </div>

        {/* Search Form */}
        <form onSubmit={handleSearch} className="search-form">
          <div className="search-method-tabs">
            <button
              type="button"
              className={`method-tab ${searchMethod === 'phone' ? 'active' : ''}`}
              onClick={() => {
                setSearchMethod('phone');
                setSearchInput('');
                setError('');
                setMessages(null);
              }}
            >
              📱 Phone Number
            </button>
            <button
              type="button"
              className={`method-tab ${searchMethod === 'email' ? 'active' : ''}`}
              onClick={() => {
                setSearchMethod('email');
                setSearchInput('');
                setError('');
                setMessages(null);
              }}
            >
              ✉️ Email Address
            </button>
          </div>

          <div className="input-group">
            <input
              type={searchMethod === 'email' ? 'email' : 'tel'}
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder={
                searchMethod === 'phone'
                  ? 'Enter your phone number (e.g., +1234567890 or 123-456-7890)'
                  : 'Enter your email address'
              }
              className="search-input"
            />
            <button
              type="submit"
              className="search-button"
              disabled={loading}
            >
              {loading ? 'Searching...' : 'Search'}
            </button>
          </div>
        </form>

        {/* Error Message */}
        {error && (
          <div className="error-alert">
            <span className="error-icon">⚠️</span>
            <span>{error}</span>
          </div>
        )}

        {/* Results */}
        {searched && messages && (
          <div className="results-container">
            <div className="patient-info">
              <h3>👤 {messages.patient_name}</h3>
              <p className="info-small">Patient ID: {messages.patient_id}</p>
            </div>

            {messages.has_messages ? (
              <>
                {/* Doctor Messages */}
                {messages.doctor_message_count > 0 && (
                  <div className="message-section">
                    <h4>💬 Messages from Doctor ({messages.doctor_message_count})</h4>
                    <div className="messages-list">
                      {messages.doctor_messages.map((msg) => (
                        <div key={`msg-${msg.id}-doctor`} className="message-item doctor-message">
                          <div className="message-header">
                            <span className="sender-badge doctor-badge">👨‍⚕️ Doctor</span>
                            <span className="message-time">{formatDate(msg.created_at)}</span>
                          </div>
                          <p className="message-text">{msg.text}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Admin Messages */}
                {messages.admin_message_count > 0 && (
                  <div className="message-section">
                    <h4>📋 Updates from System Admin ({messages.admin_message_count})</h4>
                    <div className="messages-list">
                      {messages.admin_messages.map((msg) => (
                        <div key={`msg-${msg.id}-admin`} className="message-item admin-message">
                          <div className="message-header">
                            <span className="sender-badge admin-badge">📋 System Admin</span>
                            <span className="message-time">{formatDate(msg.created_at)}</span>
                          </div>
                          <div className="message-text">
                            <p><strong>Diagnosis Notes:</strong></p>
                            <p>{msg.admin_notes}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="cta-section">
                  <p className="cta-text">To reply to these messages, please log in to your account.</p>
                  <button className="btn-login-cta" onClick={onBack}>
                    Go to Login/Sign Up →
                  </button>
                </div>
              </>
            ) : (
              <div className="no-messages">
                <p className="no-messages-emoji">📬</p>
                <p className="no-messages-text">No messages at this time.</p>
                <p className="no-messages-subtext">Your doctor or admin will send you messages once your assessment is complete.</p>
              </div>
            )}
          </div>
        )}

        {/* Info Section */}
        {!searched && (
          <div className="info-section">
            <h4>How to use:</h4>
            <ol>
              <li>Enter your phone number or email address</li>
              <li>Click "Search" to check for messages</li>
              <li>View all messages from your doctor and system admin</li>
              <li>Log in to your account to reply to messages</li>
            </ol>
          </div>
        )}
      </div>
    </div>
  );
};

export default PatientMessageCheck;
