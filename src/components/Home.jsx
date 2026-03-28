import React, { useEffect, useState } from 'react';
import './Home.css';
import PatientAuth from './PatientAuth';
import { apiUrl } from '../api';

const QUESTIONNAIRE_COMPLETION_TEXT = 'Thank you for completing all the diagnostic questions';

const Home = ({ onGetStarted, onPatientStart, onDoctorLogin, onAdminLogin, onPatientLogin }) => {
  const [showAuthForm, setShowAuthForm] = useState(false);
  const [showUnreadModal, setShowUnreadModal] = useState(false);
  const [unreadMessages, setUnreadMessages] = useState({
    doctorMessages: [],
    adminMessages: [],
    hasDoctor: false,
    hasAdmin: false
  });
  const [pendingNavigation, setPendingNavigation] = useState(null);
  const [pendingPatientId, setPendingPatientId] = useState(null);

  const hasCompletedQuestionnaire = (messages) => {
    if (!Array.isArray(messages)) {
      return false;
    }
    return messages.some((msg) => {
      const sender = (msg?.sender || '').toString().toLowerCase();
      const text = (msg?.text || '').toString();
      return sender === 'bot' && text.includes(QUESTIONNAIRE_COMPLETION_TEXT);
    });
  };

  useEffect(() => {
    // Always show home content with three role sections initially
    setShowAuthForm(false);
  }, []);

  const checkForUnreadMessages = async (patientProfile) => {
    const patientId = patientProfile?.id;
    if (!patientId) {
      if (onPatientStart) {
        onPatientStart();
      } else if (onGetStarted) {
        onGetStarted();
      }
      return;
    }

    const hasStartedDiagnosis = Boolean(
      patientProfile?.queue_number || patientProfile?.queueNumber
    );

    // First-time patients (no prior diagnosis intake) should not see notifications modal.
    if (!hasStartedDiagnosis) {
      if (onPatientLogin) {
        onPatientLogin(patientProfile, 'form');
      } else if (onPatientStart) {
        onPatientStart();
      } else if (onGetStarted) {
        onGetStarted();
      }
      return;
    }

    try {
      const [messagesRes, doctorRes, adminRes] = await Promise.all([
        fetch(apiUrl(`/api/messages/?patient=${patientId}`)),
        fetch(apiUrl(`/api/doctormessages/?patient=${patientId}`)),
        fetch(apiUrl(`/api/diagnoses/?patient=${patientId}`))
      ]);

      const chatMessages = messagesRes.ok ? await messagesRes.json() : [];
      const isFullyCompleted = hasCompletedQuestionnaire(chatMessages);

      const doctorData = doctorRes.ok ? await doctorRes.json() : [];
      const adminData = adminRes.ok ? await adminRes.json() : [];

      const doctorSeenKey = `patientSeenDoctorMessageTimestamp_${patientId}`;
      const adminSeenKey = `patientSeenAdminDiagnosisTimestamp_${patientId}`;
      const lastDoctorSeen = localStorage.getItem(doctorSeenKey)
        ? new Date(localStorage.getItem(doctorSeenKey)).getTime()
        : 0;
      const lastAdminSeen = localStorage.getItem(adminSeenKey)
        ? new Date(localStorage.getItem(adminSeenKey)).getTime()
        : 0;

      const unreadDoctor = (doctorData || []).filter((msg) => {
        const ts = new Date(msg.created_at || msg.timestamp || 0).getTime();
        const senderRole = (msg?.sender?.role || msg?.sender_role || '').toString().toLowerCase();
        const senderText = (typeof msg?.sender === 'string' ? msg.sender : '').toLowerCase();
        const isDoctorOrigin = senderRole === 'doctor' || senderRole === 'admin' || senderText.includes('doctor') || senderText.includes('admin');
        return isDoctorOrigin && ts > lastDoctorSeen;
      });

      const unreadAdmin = (adminData || []).filter((msg) => {
        const ts = new Date(msg.created_at || msg.timestamp || 0).getTime();
        return ts > lastAdminSeen;
      });

      const hasDoctor = unreadDoctor.length > 0;
      const hasAdmin = unreadAdmin.length > 0;

      if (!hasDoctor && !hasAdmin && !isFullyCompleted) {
        if (onPatientLogin) {
          onPatientLogin({ id: patientId }, 'form');
        } else if (onPatientStart) {
          onPatientStart();
        } else if (onGetStarted) {
          onGetStarted();
        }
        return;
      }

      // Always ask where the patient wants to go after login.
      setUnreadMessages({
        doctorMessages: unreadDoctor,
        adminMessages: unreadAdmin,
        hasDoctor,
        hasAdmin
      });
      setPendingPatientId(patientId);
      setShowUnreadModal(true);
      setPendingNavigation(() => {
        if (onPatientLogin) {
          return () => onPatientLogin({ id: patientId }, 'form');
        } else if (onPatientStart) {
          return onPatientStart;
        } else if (onGetStarted) {
          return onGetStarted;
        }
      });
    } catch (err) {
      console.error('Error checking unread messages:', err);
      // If completion state cannot be verified, send patient to form and avoid false notification prompts.
      if (onPatientLogin) {
        onPatientLogin({ id: patientId }, 'form');
      } else if (onPatientStart) {
        onPatientStart();
      } else if (onGetStarted) {
        onGetStarted();
      }
    }
  };

  const handleCloseUnreadModal = () => {
    setShowUnreadModal(false);
    // Navigate after modal is closed
    if (pendingNavigation) {
      pendingNavigation();
    }
    setPendingPatientId(null);
  };

  const handleNavigateFromUnreadModal = (destination) => {
    setShowUnreadModal(false);
    if (onPatientLogin && pendingPatientId) {
      onPatientLogin({ id: pendingPatientId }, destination);
    } else if (destination === 'form' && pendingNavigation) {
      pendingNavigation();
    }
    setPendingPatientId(null);
  };

  const handlePatientAuthSuccess = (patientData) => {
    setShowAuthForm(false);
    checkForUnreadMessages(patientData);
    // Don't navigate immediately - let user see the unread messages modal first
    // Navigation will happen when they click "View Messages" or close the modal
  };

  const previewMessage = (value, maxLength = 90) => {
    const text = (value || '').toString().replace(/\s+/g, ' ').trim();
    if (text.length <= maxLength) return text;
    return `${text.slice(0, maxLength - 1)}...`;
  };

  const handleClick = async () => {
    try {
      const res = await fetch(apiUrl('/api/'));
      const data = await res.json();
      console.log('Backend says:', data.message);
    } catch (err) {
      console.error('Could not contact backend', err);
    }
    setShowAuthForm(true);
  };

  return (
    <div className="home-container">
      {showUnreadModal && (
        <div
          className="modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              handleCloseUnreadModal();
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === 'Escape') {
              handleCloseUnreadModal();
            }
          }}
          role="button"
          tabIndex={0}
          aria-label="Close unread messages modal"
        >
          <div className="modal-box unread-messages-modal" role="dialog" aria-modal="true">
            <div className="modal-header">
              <h2>Where do you want to go now?</h2>
              <button className="modal-close" onClick={handleCloseUnreadModal}>&times;</button>
            </div>
            <div className="modal-content">
              <p>
                Choose your next destination after login. You can continue filling patient information or open your messages.
              </p>

              <div className="unread-section">
                <h3>💬 Doctor Messages ({unreadMessages.doctorMessages.length})</h3>
                <h3>📋 System Admin Updates ({unreadMessages.adminMessages.length})</h3>
              </div>

              {(unreadMessages.hasDoctor || unreadMessages.hasAdmin) && (
                <div className="unread-list">
                  {unreadMessages.hasDoctor && unreadMessages.doctorMessages.slice(0, 2).map(msg => (
                    <div key={`doctor-${msg.id}`} className="unread-item">
                      <p>{previewMessage(msg.text)}</p>
                    </div>
                  ))}
                  {unreadMessages.hasAdmin && unreadMessages.adminMessages.slice(0, 2).map(msg => (
                    <div key={`admin-${msg.id}`} className="unread-item">
                      <p>{previewMessage(msg.admin_notes)}</p>
                    </div>
                  ))}
                </div>
              )}

              <button className="btn-primary" onClick={() => handleNavigateFromUnreadModal('form')}>
                Go to Patient Information
              </button>
              <button className="btn-primary" onClick={() => handleNavigateFromUnreadModal('patientMessages')}>
                Go to Doctor Messages
              </button>
              <button className="btn-primary" onClick={() => handleNavigateFromUnreadModal('patientDiagnosis')}>
                Go to System Admin Messages
              </button>
            </div>
          </div>
        </div>
      )}

      {!showAuthForm ? (
        <div className="home-content">
          <div className="medical-header">
            <h1 className="main-title">MediBridge</h1>
            <div className="subtitle-badge">Medical Assessment Assistant</div>
          </div>

          <h2 className="hero-heading">
            Intelligent Health Information <strong>Collection Tool</strong>
          </h2>

          <p className="hero-description">
            Our platform helps gather preliminary health information to support
            healthcare professionals in making informed diagnostic decisions.
          </p>

          <div className="features-grid">
            <div className="feature-item">
              <div className="feature-icon">🔒</div>
              <h3>Data Security</h3>
              <p>Your information is protected with enterprise-grade security measures</p>
            </div>
            <div className="feature-item">
              <div className="feature-icon">📋</div>
              <h3>Structured Collection</h3>
              <p>Systematic gathering of health information for medical evaluation</p>
            </div>
            <div className="feature-item">
              <div className="feature-icon">🤖</div>
              <h3>Smart Assistance</h3>
              <p>Smart algorithms help organize and present health information clearly</p>
            </div>
          </div>

          <div className="login-section">
            <h3>Choose Your Access</h3>
            <div className="role-sections">
              {/* Patient Section */}
              <button type="button" className="role-card patient-card" onClick={handleClick} aria-label="Continue as patient">
                <div className="role-icon">👤</div>
                <h4>Patient</h4>
                <p className="role-description">Submit your health information for assessment</p>
                <div className="role-action">Get Started →</div>
              </button>

              {/* Doctor Section */}
              <button type="button" className="role-card doctor-card" onClick={onDoctorLogin} aria-label="Continue as healthcare provider">
                <div className="role-icon">👨‍⚕️</div>
                <h4>Healthcare Provider</h4>
                <p className="role-description">Review patient data and provide assessments</p>
                <div className="role-action">Get Started →</div>
              </button>

              {/* Admin Section */}
              <button type="button" className="role-card admin-card" onClick={onAdminLogin} aria-label="Continue as system administrator">
                <div className="role-icon">⚙️</div>
                <h4>System Administrator</h4>
                <p className="role-description">Manage platform and user information</p>
                <div className="role-action">Get Started →</div>
              </button>
            </div>
          </div>
        </div>
      ) : (
        <PatientAuth
          onLogin={(userData, token, patientData) => {
            localStorage.setItem('token', token);
            localStorage.setItem('authUser', JSON.stringify(userData));
            if (patientData) {
              localStorage.setItem('latestPatientContext', JSON.stringify({
                id: patientData.id,
                fullName: patientData.full_name,
                queueNumber: patientData.queue_number
              }));
              handlePatientAuthSuccess(patientData);
            }
          }}
          onBack={() => setShowAuthForm(false)}
        />
      )}
    </div>
  );
};

export default Home;