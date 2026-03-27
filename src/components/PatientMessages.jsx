import React, { useCallback, useEffect, useRef, useState } from 'react';
import './AdminDoctor.css';
import './PatientMessages.css';

const PatientMessages = ({ patientData }) => {
  const [conversation, setConversation] = useState([]);
  const [replyText, setReplyText] = useState('');
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [statusMessage, setStatusMessage] = useState('');
  const socketRef = useRef(null);
  const [unreadDoctorMeta, setUnreadDoctorMeta] = useState({
    hasUnread: false,
    unreadCount: 0
  });
  const [diagnosis, setDiagnosis] = useState(null);
  const [patientProfile, setPatientProfile] = useState(null);

  // Check if patient info is complete
  const isPatientInfoComplete = patientData?.id ? true : false;

  const storedContext = (() => {
    try {
      return JSON.parse(localStorage.getItem('latestPatientContext') || '{}');
    } catch {
      return {};
    }
  })();
  const activePatientId = patientData?.id || storedContext?.id;

  const currentAuthUser = (() => {
    try {
      return JSON.parse(localStorage.getItem('authUser') || '{}');
    } catch {
      return {};
    }
  })();

  const patientDisplayName =
    (patientProfile?.full_name || '').trim() ||
    (patientData?.fullName || '').trim() ||
    (storedContext?.full_name || '').trim() ||
    (storedContext?.fullName || '').trim() ||
    (currentAuthUser?.full_name || '').trim() ||
    (currentAuthUser?.fullName || '').trim() ||
    'Patient';

  const refreshUnreadDoctorMessages = useCallback((allMessages) => {
    if (!activePatientId) return;
    
    const seenKey = `patientSeenDoctorMessageTimestamp_${activePatientId}`;
    const lastSeenTime = localStorage.getItem(seenKey) 
      ? new Date(localStorage.getItem(seenKey)).getTime()
      : 0;

    const unreadMessages = allMessages.filter(m => {
      const msgTime = new Date(m.created_at || m.timestamp).getTime();
      return msgTime > lastSeenTime;
    });

    const hasUnread = unreadMessages.length > 0;
    setUnreadDoctorMeta({
      hasUnread,
      unreadCount: unreadMessages.length
    });
  }, [activePatientId]);

  const loadAllConversationData = useCallback(async () => {
    if (!activePatientId) return;

    try {
      const [doctorRes, diagnosisRes, scanRes, patientMsgRes, patientProfileRes] = await Promise.all([
        fetch(`http://127.0.0.1:8000/api/doctormessages/?patient=${activePatientId}`),
        fetch(`http://127.0.0.1:8000/api/diagnoses/?patient=${activePatientId}`),
        fetch(`http://127.0.0.1:8000/api/scans/?patient=${activePatientId}`),
        fetch(`http://127.0.0.1:8000/api/messages/?patient=${activePatientId}`),
        fetch(`http://127.0.0.1:8000/api/patients/${activePatientId}/`)
      ]);

      if (!doctorRes.ok || !diagnosisRes.ok || !scanRes.ok || !patientMsgRes.ok) {
        throw new Error('Failed to load complete conversation data.');
      }

      const doctorData = doctorRes.ok ? await doctorRes.json() : [];
      const diagnosisData = diagnosisRes.ok ? await diagnosisRes.json() : [];
      const scansData = scanRes.ok ? await scanRes.json() : [];
      const patientMsgData = patientMsgRes.ok ? await patientMsgRes.json() : [];
      const patientProfileData = await patientProfileRes.json().catch(() => null);
      setPatientProfile(patientProfileData);

      if (diagnosisData && diagnosisData.length > 0) {
        setDiagnosis(diagnosisData[0]);
      }

      // Merge doctor messages with diagnostic Q&A
      const mergedConversation = [];

      // Add diagnostic questions and answers
      if (diagnosis || (diagnosisData && diagnosisData.length > 0)) {
        const diagData = diagnosis || diagnosisData[0];
        if (diagData.questionnaire_answers) {
          try {
            const answers = typeof diagData.questionnaire_answers === 'string'
              ? JSON.parse(diagData.questionnaire_answers)
              : diagData.questionnaire_answers;

            if (Array.isArray(answers)) {
              answers.forEach((answer, idx) => {
                const questionText = answer.question || `Question ${idx + 1}`;
                const answerText = answer.answer || 'No answer provided';
                const timestamp = answer.timestamp || diagData.created_at || new Date().toISOString();

                mergedConversation.push({
                  id: `diag-q-${idx}`,
                  type: 'question',
                  text: questionText,
                  sender: 'dr',
                  timestamp,
                  created_at: timestamp
                });

                mergedConversation.push({
                  id: `diag-a-${idx}`,
                  type: 'answer',
                  text: answerText,
                  sender: 'patient',
                  timestamp: timestamp || new Date().toISOString(),
                  created_at: timestamp
                });
              });
            }
          } catch (e) {
            console.error('Error parsing questionnaire answers:', e);
          }
        }
      }

      // Add doctor messages
      (doctorData || []).forEach(msg => {
        const senderUsername = (msg?.sender?.username || '').toString().toLowerCase();
        const currentUsername = (currentAuthUser?.username || '').toString().toLowerCase();
        mergedConversation.push({
          ...msg,
          id: `doctor-msg-${msg.id}`,
          type: 'message',
          sender: senderUsername && currentUsername && senderUsername === currentUsername ? 'patient' : 'dr'
        });
      });

      // Add direct patient replies sent to doctor from the conversation reply box.
      (patientMsgData || [])
        .filter(msg => (msg.sender || '').toLowerCase() === 'patient')
        .forEach(msg => {
          mergedConversation.push({
            ...msg,
            id: `patient-msg-${msg.id || msg.timestamp || Date.now()}`,
            type: 'message',
            sender: 'patient'
          });
        });

      // Add uploaded files directly into the same chat timeline.
      (scansData || []).forEach(scan => {
        const fileUrl = normalizeFileUrl(scan.file || '');
        mergedConversation.push({
          id: `scan-${scan.id}`,
          type: 'attachment',
          sender: getScanSender(scan),
          timestamp: scan.uploaded_at,
          created_at: scan.uploaded_at,
          file_url: fileUrl,
          file_name: getFileName(fileUrl)
        });
      });

      // Sort by timestamp
      mergedConversation.sort((a, b) => {
        const timeA = new Date(a.created_at || a.timestamp).getTime();
        const timeB = new Date(b.created_at || b.timestamp).getTime();
        return timeA - timeB;
      });

      setConversation((prev) => {
        if (mergedConversation.length === 0 && (prev || []).length > 0) {
          return prev;
        }
        return mergedConversation;
      });
      refreshUnreadDoctorMessages(doctorData || []);
    } catch (err) {
      console.error('Error loading conversation data:', err);
    }
  }, [activePatientId, diagnosis, refreshUnreadDoctorMessages, currentAuthUser?.username]);

  const markDoctorMessagesAsSeen = useCallback(() => {
    if (!activePatientId) return;
    const seenKey = `patientSeenDoctorMessageTimestamp_${activePatientId}`;
    localStorage.setItem(seenKey, new Date().toISOString());
    setUnreadDoctorMeta({ hasUnread: false, unreadCount: 0 });
  }, [activePatientId]);

  useEffect(() => {
    if (!activePatientId) return undefined;

    loadAllConversationData();
    markDoctorMessagesAsSeen();

    const token = localStorage.getItem('token');
    if (!token) return undefined;

    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const browserHost = window.location.hostname || '127.0.0.1';
    // Keep websocket host aligned with REST backend host to avoid localhost/127 mismatch.
    const wsHost = (browserHost === 'localhost' || browserHost === '::1') ? '127.0.0.1' : browserHost;
    const wsUrl = `${protocol}://${wsHost}:8000/ws/chat/${activePatientId}/?token=${encodeURIComponent(token)}`;
    let ws = null;

    const refreshId = setInterval(() => {
      loadAllConversationData();
    }, 10000);

    try {
      ws = new WebSocket(wsUrl);
      socketRef.current = ws;

      ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data || '{}');
          const text = (payload?.message || '').toString().trim();
          if (!text) return;

          const senderName = (payload?.sender || '').toString().toLowerCase();
          const currentUsername = (currentAuthUser?.username || '').toString().toLowerCase();
          const sender = senderName && currentUsername && senderName === currentUsername ? 'patient' : 'dr';

          setConversation((prev) => {
            const duplicate = (prev || []).some((item) => {
              const itemText = (item?.text || '').toString().trim();
              const itemTs = (item?.created_at || item?.timestamp || '').toString();
              return itemText === text && itemTs === (payload?.timestamp || '');
            });
            if (duplicate) return prev;

            const next = [...(prev || []), {
              id: `ws-${payload.timestamp}-${senderName}-${text.slice(0, 16)}`,
              type: 'message',
              text,
              sender,
              timestamp: payload.timestamp,
              created_at: payload.timestamp,
            }];

            next.sort((a, b) => {
              const timeA = new Date(a.created_at || a.timestamp || 0).getTime();
              const timeB = new Date(b.created_at || b.timestamp || 0).getTime();
              return timeA - timeB;
            });
            return next;
          });
        } catch {
          // Ignore malformed websocket payloads.
        }
      };
    } catch {
      // Keep REST behavior as fallback if websocket fails to initialize.
    }

    return () => {
      clearInterval(refreshId);
      if (ws) {
        if (ws.readyState === WebSocket.CONNECTING) {
          ws.addEventListener('open', () => ws.close(), { once: true });
        } else if (ws.readyState === WebSocket.OPEN) {
          ws.close();
        }
      }
      if (socketRef.current) {
        socketRef.current = null;
      }
    };
  }, [activePatientId, loadAllConversationData, markDoctorMessagesAsSeen]);

  const formatTime = (timestamp) => {
    if (!timestamp) return '';
    try {
      const date = new Date(timestamp);
      return date.toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit',
        hour12: true 
      });
    } catch {
      return '';
    }
  };

  const normalizeFileUrl = (fileUrl = '') => {
    if (!fileUrl) return '';
    return fileUrl.startsWith('http') ? fileUrl : `http://127.0.0.1:8000${fileUrl}`;
  };

  const getFileName = (fileUrl = '') => {
    const clean = fileUrl.split('?')[0];
    const rawName = clean.split('/').pop() || 'Attachment';
    try {
      return decodeURIComponent(rawName);
    } catch {
      return rawName;
    }
  };

  const getScanSender = (scan) => {
    const role = (scan?.uploaded_by_role || '').toLowerCase();
    if (role === 'doctor' || role === 'admin') return 'dr';
    return 'patient';
  };

  const isPdfFile = (fileUrl = '') => /\.pdf(\?|$)/i.test(fileUrl);
  const isImageFile = (fileUrl = '') => /\.(jpe?g|png|gif|webp|bmp|heic|heif)(\?|$)/i.test(fileUrl);
  const getFileExtension = (fileUrl = '') => {
    const clean = fileUrl.split('?')[0];
    const idx = clean.lastIndexOf('.');
    return idx >= 0 ? clean.slice(idx + 1).toUpperCase() : 'FILE';
  };

  const renderAttachmentBubble = (item) => {
    const fileUrl = item.file_url || '';
    const fileName = item.file_name || getFileName(fileUrl);
    const senderLabel = item.sender === 'dr' ? 'Doctor shared a file' : 'Patient shared a file';

    if (!fileUrl) {
      return <div className="conversation-attachment">Attachment unavailable.</div>;
    }

    if (isImageFile(fileUrl)) {
      return (
        <>
          <span className="conversation-attachment-label">{senderLabel}</span>
          <a href={fileUrl} target="_blank" rel="noopener noreferrer" className="conversation-attachment-link">
            <img className="conversation-attachment-image" src={fileUrl} alt={fileName} />
            <span className="conversation-attachment-name">{fileName}</span>
          </a>
        </>
      );
    }

    return (
      <>
        <span className="conversation-attachment-label">{senderLabel}</span>
        <a href={fileUrl} target="_blank" rel="noopener noreferrer" className="conversation-attachment-link conversation-attachment-doc">
          <span className="conversation-attachment-ext">{isPdfFile(fileUrl) ? 'PDF' : getFileExtension(fileUrl)}</span>
          <span className="conversation-attachment-name">{fileName}</span>
        </a>
      </>
    );
  };

  const getConversationItemClass = (item) => {
    if (item.sender === 'dr') {
      if (item.type === 'question') return 'dr-question';
      if (item.type === 'attachment') return 'dr-attachment';
      return 'dr-message';
    }

    if (item.type === 'answer') return 'patient-answer';
    if (item.type === 'attachment') return 'patient-attachment';
    return 'patient-message';
  };

  const handleSendReply = async () => {
    const text = replyText.trim();
    if (!text || !activePatientId) return;
    const token = localStorage.getItem('token');

    // Enforce patient info submission before sending messages
    if (!isPatientInfoComplete) {
      setStatusMessage('❌ Please complete your patient information form first before sending messages to the doctor.');
      return;
    }

    setStatusMessage('Sending your answer...');
    try {
      const res = await fetch('http://127.0.0.1:8000/api/doctormessages/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Token ${token}` } : {}),
        },
        body: JSON.stringify({
          text,
          patient: activePatientId
        })
      });

      if (!res.ok) {
        throw new Error(`Failed to send answer (${res.status})`);
      }

      setReplyText('');
      setStatusMessage('Answer sent to doctor.');

      // If websocket is unavailable, fallback to explicit reload.
      if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
        loadAllConversationData();
      }
    } catch (err) {
      setStatusMessage(`Error: ${err.message}`);
    }
  };

  const handleFileChange = (event) => {
    const files = Array.from(event.target.files || []);
    const validFiles = files.filter(file => {
      const ext = (file.name.split('.').pop() || '').toLowerCase();
      const validType = (
        file.type.startsWith('image/') ||
        file.type === 'application/pdf' ||
        file.type === 'application/msword' ||
        file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        file.type === 'text/plain' ||
        ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'pdf', 'doc', 'docx', 'txt'].includes(ext)
      );
      const validSize = file.size <= 10 * 1024 * 1024;
      return validType && validSize;
    });

    if (validFiles.length !== files.length) {
      setStatusMessage('Some files were rejected. Allowed: images (including HEIC), PDF, DOC, DOCX, TXT under 10MB.');
    }

    setSelectedFiles((prev) => {
      const merged = [...prev, ...validFiles];
      const deduped = merged.filter((file, index, arr) => {
        const key = `${file.name}-${file.size}-${file.lastModified}`;
        return index === arr.findIndex((item) => `${item.name}-${item.size}-${item.lastModified}` === key);
      });
      return deduped;
    });

    if (validFiles.length > 0) {
      setStatusMessage(`Added ${validFiles.length} file(s). You can add more before uploading.`);
    }
    event.target.value = '';
  };

  const handleSendFiles = async () => {
    if (!activePatientId || selectedFiles.length === 0) return;

    // Enforce patient info submission before sending files
    if (!isPatientInfoComplete) {
      setStatusMessage('❌ Please complete your patient information form first before uploading files to the doctor.');
      return;
    }

    setStatusMessage('Uploading files...');
    try {
      await Promise.all(
        selectedFiles.map(async (file) => {
          const formData = new FormData();
          formData.append('patient', activePatientId);
          formData.append('file', file);
          const res = await fetch('http://127.0.0.1:8000/api/scans/', {
            method: 'POST',
            body: formData
          });
          if (!res.ok) {
            throw new Error(`Failed to upload ${file.name}`);
          }
        })
      );

      setSelectedFiles([]);
      setStatusMessage('Files sent to doctor successfully.');
      loadAllConversationData();
    } catch (err) {
      setStatusMessage(`Error: ${err.message}`);
    }
  };

  return (
    <div className="doctor-container">
      <div className="page-header patient-messages-header">
        <h2>
          Conversation with Doctor
          {unreadDoctorMeta.hasUnread && (
            <span className="unread-badge">{unreadDoctorMeta.unreadCount}</span>
          )}
        </h2>
        <p className="patient-list-meta">Patient: {patientDisplayName}</p>
        <p className="patient-list-meta">
          {(Number(patientProfile?.visit_count || patientData?.visitCount || 1) > 1)
            ? `Returning Patient (Visit #${Number(patientProfile?.visit_count || patientData?.visitCount || 1)})`
            : 'First Visit'}
        </p>
        {/* Topic badge showing patient's area_of_concern (only here for patient view) */}
        {(() => {
          const area = (patientProfile && (patientProfile.area_of_concern || patientProfile.area))
            || (diagnosis && (diagnosis.area_of_concern || diagnosis.area))
            || (patientData && (patientData.area_of_concern || patientData.areaOfConcern || patientData.area))
            || (storedContext && (storedContext.area_of_concern || storedContext.area));
          if (!area) return null;
          const label = String(area).charAt(0).toUpperCase() + String(area).slice(1).toLowerCase();
          return (
            <div className="area-info-card" role="note" aria-label={`Diagnostic area: ${label}`}>
              <div className="area-info-left">
                <span className="topic-badge"><span className="topic-dot" aria-hidden="true" />{label}</span>
              </div>
              <div className="area-info-body">
                <h4 className="area-info-title">Focused on {label}</h4>
                <p className="area-info-text">Messages below relate to the selected diagnostic area and assist clinicians in assessing symptoms and providing targeted recommendations.</p>
                <p className="area-info-why"><strong>Why this matters:</strong> Grouping conversation by diagnostic area helps clinicians quickly focus on relevant symptoms, reduces diagnostic noise, and enables targeted follow-up recommendations.</p>
              </div>
            </div>
          );
        })()}
      </div>

      {!isPatientInfoComplete && (
        <div className="alert alert-warning">
          <strong>⚠️ Patient Information Required:</strong> You must complete your patient information form before communicating with the doctor. Please navigate to the "Diagnosis Form" section and submit your information.
        </div>
      )}

      <div className="conversation-container">
        {conversation.length === 0 ? (
          <p className="no-messages-text">No messages yet. Start your health assessment to begin the conversation.</p>
        ) : (
          <div className="conversation-timeline">
            {conversation.map((item, idx) => (
              <div key={item.id ? `item-${item.id}-${getConversationItemClass(item)}` : `item-${idx}-${getConversationItemClass(item)}`} className={`conversation-item ${getConversationItemClass(item)}`}>
                <div className="conversation-bubble-wrapper">
                  {item.sender === 'dr' ? (
                    <div className="conversation-bubble doctor-bubble">
                      <div className="bubble-header">
                        <span className="sender-chip doctor-chip">👨‍⚕️ Doctor</span>
                        <span className="timestamp">{formatTime(item.created_at || item.timestamp)}</span>
                      </div>
                      <div className="bubble-content">
                        {item.type === 'question' && (
                          <>
                            <p className="question-text">{item.text}</p>
                          </>
                        )}
                        {item.type === 'message' && (
                          <p>{item.text}</p>
                        )}
                        {item.type === 'attachment' && renderAttachmentBubble(item)}
                      </div>
                    </div>
                  ) : (
                    <div className="conversation-bubble patient-bubble">
                      <div className="bubble-header">
                        <span className="sender-chip patient-chip">👤 You</span>
                        <span className="timestamp">{formatTime(item.created_at || item.timestamp)}</span>
                      </div>
                      <div className="bubble-content">
                        {item.type === 'answer' && (
                          <p className="answer-text">{item.text}</p>
                        )}
                        {item.type === 'message' && (
                          <p>{item.text}</p>
                        )}
                        {item.type === 'attachment' && renderAttachmentBubble(item)}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="patient-response-section">
        <h3>💬 Reply to Doctor</h3>
        <textarea
          rows={4}
          value={replyText}
          onChange={(e) => setReplyText(e.target.value)}
          placeholder="Type your message or answer to the doctor's question..."
          className="reply-textarea"
          disabled={!isPatientInfoComplete}
        />
        <button className="btn-primary" onClick={handleSendReply} disabled={!isPatientInfoComplete}>
          {isPatientInfoComplete ? 'Send Message' : '⚠️ Complete Patient Info to Send'}
        </button>

        <div className="patient-file-upload">
          <label htmlFor="patient-scan-upload">📎 Attach Files (Images incl. HEIC / PDF / DOC / DOCX / TXT)</label>
          <input
            id="patient-scan-upload"
            type="file"
            multiple
            accept="image/*,.jpg,.jpeg,.png,.heic,.heif,.pdf,.doc,.docx,.txt"
            onChange={handleFileChange}
            disabled={!isPatientInfoComplete}
          />
          {selectedFiles.length > 0 && (
            <div className="files-selected">
              <p>{selectedFiles.length} file(s) selected:</p>
              <ul>
                {selectedFiles.map((f, idx) => (
                  <li key={`${f.name}-${f.lastModified || idx}`}>{f.name}</li>
                ))}
              </ul>
            </div>
          )}
          <button 
            className="btn-secondary" 
            onClick={handleSendFiles} 
            disabled={selectedFiles.length === 0 || !isPatientInfoComplete}
          >
            Upload Files
          </button>
        </div>

        {statusMessage && (
          <p className={`patient-response-status ${statusMessage.includes('Error') ? 'error' : 'success'}`}>
            {statusMessage}
          </p>
        )}
      </div>
    </div>
  );
};

export default PatientMessages;