import React, { useState, useEffect, useRef, useCallback } from 'react';
import './DiagnosticChat.css'; 
import { apiUrl } from '../api';

const DiagnosticChat = ({ patientData, dataset, onCompletionChange }) => {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [inputValue, setInputValue] = useState('');
  const [uploadedScans, setUploadedScans] = useState([]);
  const [pendingScans, setPendingScans] = useState([]);
  const [uploadStatus, setUploadStatus] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);
  const [questionnaireCompleted, setQuestionnaireCompleted] = useState(false);
  const [selectedOptionByQuestion, setSelectedOptionByQuestion] = useState({});
  const [editingQuestionId, setEditingQuestionId] = useState(null);
  const scanFileInputRef = useRef(null);
  const messageListRef = useRef(null);
  const messageIdCounterRef = useRef(1000);

  const generateMessageId = () => {
    messageIdCounterRef.current += Math.floor(Math.random() * 100);
    return messageIdCounterRef.current;
  };

  const getFileExtension = (fileName = '') => {
    const idx = fileName.lastIndexOf('.');
    return idx >= 0 ? fileName.slice(idx + 1).toLowerCase() : '';
  };

  const getDisplayFileType = (scan) => {
    if (scan?.type) {
      const parts = scan.type.split('/');
      return (parts[1] || parts[0] || 'FILE').toUpperCase();
    }
    return (getFileExtension(scan?.name) || 'FILE').toUpperCase();
  };

  const isAllowedUploadFile = (file) => {
    const mime = (file.type || '').toLowerCase();
    const ext = getFileExtension(file.name);
    const allowedMimes = new Set([
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'image/heic',
      'image/heif',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain'
    ]);
    const allowedExt = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'pdf', 'doc', 'docx', 'txt']);
    return allowedMimes.has(mime) || allowedExt.has(ext);
  };

  const getTotalDatasetQuestions = () => {
    return Array.isArray(dataset?.ourIntents) ? dataset.ourIntents.length : 0;
  };

  const getAnsweredQuestionCount = () => {
    return messages.filter(msg => msg.sender === 'you' && msg.type === 'text').length;
  };

  const getQuestionProgress = () => {
    const total = getTotalDatasetQuestions();
    const answered = Math.min(getAnsweredQuestionCount(), total);
    return { answered, total };
  };

  const areAllDatasetQuestionsAnswered = useCallback(() => {
    const total = Array.isArray(dataset?.ourIntents) ? dataset.ourIntents.length : 0;
    const answered = Math.min(messages.filter(msg => msg.sender === 'you' && msg.type === 'text').length, total);
    return total > 0 && answered >= total;
  }, [messages, dataset]);

  useEffect(() => {
    const completed = questionnaireCompleted || areAllDatasetQuestionsAnswered();
    if (onCompletionChange) {
      onCompletionChange(completed);
    }
  }, [questionnaireCompleted, onCompletionChange, areAllDatasetQuestionsAnswered]);

  // Ensure a friendly final acknowledgement is shown when all questions are answered.
  // Some datasets or backend responses may not return a final bot reply; in that case
  // Delay injecting a fallback final acknowledgement so we don't duplicate a backend reply.
  // When all questions are answered we'll wait a short time for the backend to respond.
  // If no backend reply appears we inject a local thank-you; if the backend replies first
  // we cancel the fallback to avoid duplicate messages.
  const thankYouTimeoutRef = React.useRef(null);
  useEffect(() => {
    const allAnswered = areAllDatasetQuestionsAnswered();
    if (!allAnswered) return;
    if (questionnaireCompleted) return;

    // Clear any existing fallback timer
    if (thankYouTimeoutRef.current) {
      clearTimeout(thankYouTimeoutRef.current);
      thankYouTimeoutRef.current = null;
    }

    // Schedule a short delay to allow backend reply to arrive.
    thankYouTimeoutRef.current = setTimeout(() => {
      try {
        // Use latest state here (not closed-over `messages`) so we don't append
        // a fallback thank-you if backend completion already arrived.
        setMessages(prev => {
          const hasCompletion = (prev || []).some(m => {
            const txt = m.content || m.text || m.reply || m.message || '';
            const sender = (m.sender || '').toString().toLowerCase();
            const isAssistant = sender === 'dr' || sender === 'bot' || sender.includes('assistant');
            return isAssistant && isAssistantCompletionMessage(txt);
          });

          if (hasCompletion) return prev;

          const botMessage = {
            id: generateMessageId(),
            sender: 'dr',
            type: 'text',
            content: 'Thank you - your answers have been recorded. A doctor will review them shortly.',
            timestamp: new Date()
          };
          return [...(prev || []), botMessage];
        });
        setQuestionnaireCompleted(true);
      } catch (e) {
        // ignore
      }
      thankYouTimeoutRef.current = null;
    }, 1500);

    return () => {
      if (thankYouTimeoutRef.current) {
        clearTimeout(thankYouTimeoutRef.current);
        thankYouTimeoutRef.current = null;
      }
    };
  }, [messages, areAllDatasetQuestionsAnswered, questionnaireCompleted]);

  const getLatestQuestionOptions = () => {
    const latestQuestion = [...messages]
      .reverse()
      .find(msg => msg.sender === 'dr' && msg.type === 'question');
    return latestQuestion?.responses || [];
  };

  const isAssistantCompletionMessage = (text = '') => {
    if (!text) return false;
    return /(thank[s]?|thank you|answers have been recorded|completed all the diagnostic|completed the diagnostic|completed the questions|diagnostic questions completed|completion)/i.test(String(text));
  };

  const getLatestQuestionMessage = () => {
    return [...messages]
      .reverse()
      .find(msg => msg.sender === 'dr' && msg.type === 'question');
  };

  const getQuestionOptions = (questionIndex) => {
    return dataset?.ourIntents?.[questionIndex]?.responses || [];
  };

  const getAnswerMessageByQuestionIndex = (questionIndex) => {
    return messages.find(msg => msg.sender === 'you' && msg.questionIndex === questionIndex);
  };

  const markQuestionnaireCompleted = () => {
    if (!areAllDatasetQuestionsAnswered()) {
      setError('Please answer all required questions before completing the diagnosis.');
      return;
    }
    setQuestionnaireCompleted(true);
  };

  const normalizeSelectedFiles = (files) => {
    const validFiles = Array.from(files).filter(file => {
      const isValidType = isAllowedUploadFile(file);
      const isValidSize = file.size <= 10 * 1024 * 1024; // 10MB limit
      return isValidType && isValidSize;
    });

    if (validFiles.length !== files.length) {
      setError('Some files were rejected. Only images (including HEIC), PDF, DOC, DOCX, and TXT under 10MB are allowed.');
      setTimeout(() => setError(''), 5000);
    }

    if (validFiles.length > 0) {
      setPendingScans((prev) => {
        const merged = [...prev, ...validFiles];
        return merged.filter((file, index, arr) => {
          const key = `${file.name}-${file.size}-${file.lastModified}`;
          return index === arr.findIndex((item) => `${item.name}-${item.size}-${item.lastModified}` === key);
        });
      });
      setUploadStatus(`Added ${validFiles.length} file(s). Click Upload Files to submit.`);
    }

    return validFiles;
  };

  const uploadFiles = async (filesToUpload) => {
    if (!filesToUpload || filesToUpload.length === 0) return;

    if (!patientData?.id) {
      setError('Patient record is missing. Please complete patient information before uploading files.');
      return;
    }

    setUploadStatus('Uploading files...');

    try {
      const uploaded = await Promise.all(filesToUpload.map(async (file) => {
        const form = new FormData();
        form.append('patient', patientData.id);
        form.append('file', file);
        const res = await fetch(apiUrl('/api/scans/'), {
          method: 'POST',
          body: form
        });
        if (!res.ok) {
          let backendError = '';
          try {
            const data = await res.json();
            backendError = data.error || data.detail || '';
          } catch {
            backendError = '';
          }
          throw new Error(backendError || `Failed to upload ${file.name}`);
        }

        const data = await res.json();
        return {
          id: data.id || `${Date.now()}-${Math.random()}`,
          file,
          name: file.name,
          type: file.type,
          size: file.size,
          preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
          uploadedAt: new Date(),
        };
      }));

      setUploadedScans((prev) => [...prev, ...uploaded]);
      setPendingScans((prev) => {
        const uploadKeys = new Set(filesToUpload.map((f) => `${f.name}-${f.size}-${f.lastModified}`));
        return prev.filter((f) => !uploadKeys.has(`${f.name}-${f.size}-${f.lastModified}`));
      });
      setUploadStatus('Files uploaded successfully.');
    } catch (err) {
      setError(err.message || 'Scan upload failed');
      setUploadStatus('Upload failed. Please try again.');
    }
  };

  const handleFileUpload = async () => {
    if (pendingScans.length === 0) return;
    await uploadFiles(pendingScans);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragOver(false);
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const validFiles = normalizeSelectedFiles(files);
      if (validFiles.length > 0) {
        uploadFiles(validFiles);
      }
    }
  };

  const removeScan = (scanId) => {
    setUploadedScans(prev => {
      const scanToRemove = prev.find(scan => scan.id === scanId);
      if (scanToRemove?.preview) {
        URL.revokeObjectURL(scanToRemove.preview);
      }
      return prev.filter(scan => scan.id !== scanId);
    });
  };

  useEffect(() => {
    // Initialize chat with first diagnostic question from dataset
    if (dataset && dataset.ourIntents && dataset.ourIntents.length > 0) {
      const firstIntent = dataset.ourIntents[0];
      // Be tolerant of different dataset shapes: try common keys for the question text
      let firstQuestion = (firstIntent.patterns && firstIntent.patterns[0])
        || firstIntent.pattern
        || (firstIntent.questions && firstIntent.questions[0])
        || firstIntent.question
        || firstIntent.prompt
        || '';
      // Ensure there's always a visible question text. Fallback to intent tag or a generic prompt.
      if (!firstQuestion || String(firstQuestion).trim().length === 0) {
        firstQuestion = firstIntent.tag || 'Please choose an option below';
      }
      const possibleResponses = firstIntent.responses || [];

      const initialQuestionId = generateMessageId();
      const initialQuestionMessage = {
        id: initialQuestionId,
        sender: 'dr',
        type: 'question',
        content: firstQuestion,
        questionIndex: 0,
        intent: firstIntent.tag,
        responses: [], // show no options initially
        timestamp: new Date()
      };

      setMessages([initialQuestionMessage]);
      // Remember the id of the just-added initial question and suppress
      // automatic scrolling when its responses are populated so the
      // question remains visible before the answers appear.
      justAddedQuestionIdRef.current = initialQuestionId;
      suppressAutoScrollForResponsesRef.current = initialQuestionId;
      setSelectedOptionByQuestion({});
      setEditingQuestionId(null);
      setQuestionnaireCompleted(false);
      if (onCompletionChange) {
        onCompletionChange(false);
      }

      // Reveal the answer options after a short delay so the question is visible first
      setTimeout(() => {
        setMessages(prev => prev.map(m => m.id === initialQuestionId ? { ...m, responses: possibleResponses } : m));
      }, 250);
    }
  }, [dataset, onCompletionChange]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (!messageListRef.current) return;

    const lastMsg = messages[messages.length - 1];

    // If nothing to scroll to, skip
    if (!lastMsg) return;

    // If this is the question we just added without responses, scroll to show it.
    if (lastMsg.type === 'question' && lastMsg.responses && lastMsg.responses.length === 0) {
      // scroll so the question is visible but responses (when added) will be below the fold
      setTimeout(() => {
        // position scroll a bit above the bottom so options are off-screen
        const el = messageListRef.current;
        el.scrollTop = Math.max(0, el.scrollHeight - Math.floor(el.clientHeight * 0.7));
      }, 0);
      return;
    }

    // If this message is the population of responses for a recently-added question, suppress auto-scroll
    if (suppressAutoScrollForResponsesRef.current) {
      const suppressId = suppressAutoScrollForResponsesRef.current;
      const found = messages.find(m => m.id === suppressId && m.responses && m.responses.length > 0);
      if (found) {
        // clear the suppression and do NOT auto-scroll so user must scroll to see options
        suppressAutoScrollForResponsesRef.current = null;
        return;
      }
    }

    // Default: scroll to bottom
    setTimeout(() => {
      messageListRef.current.scrollTop = messageListRef.current.scrollHeight;
    }, 0);
  }, [messages]);

  const justAddedQuestionIdRef = React.useRef(null);
  const suppressAutoScrollForResponsesRef = React.useRef(null);

  const handleSendMessage = async (text, questionId = null, questionIndexOverride = null, tempMessageId = null) => {
    if (!text.trim()) return;

    const targetQuestion = questionId !== null
      ? messages.find(msg => msg.id === questionId && msg.type === 'question')
      : getLatestQuestionMessage();
    const targetQuestionIndex = questionIndexOverride ?? targetQuestion?.questionIndex ?? getAnsweredQuestionCount();
    const existingAnswerMessage = getAnswerMessageByQuestionIndex(targetQuestionIndex);
    const isEditingExistingAnswer = Boolean(existingAnswerMessage);

    console.log('targetQuestionIndex for this answer:', targetQuestionIndex);
    console.log('questionId:', questionId);
    console.log('questionIndexOverride:', questionIndexOverride);
    console.log('targetQuestion:', targetQuestion);
    console.log('isEditingExistingAnswer:', isEditingExistingAnswer);
    console.log('existingAnswerMessage:', existingAnswerMessage);

    if (questionId !== null) {
      const latestQuestion = getLatestQuestionMessage();
      if (!isEditingExistingAnswer && (!latestQuestion || latestQuestion.id !== questionId)) {
        setError('Please answer the current active question.');
        return;
      }
    }

    if (!isEditingExistingAnswer && (questionnaireCompleted || areAllDatasetQuestionsAnswered())) {
      setQuestionnaireCompleted(true);
      setError('All required questions are already answered.');
      return;
    }
    const trimmedText = text.trim();

    const expectedResponses = getQuestionOptions(targetQuestionIndex);
    if (expectedResponses.length > 0 && !expectedResponses.includes(trimmedText)) {
      setError('Please select one of the provided answer options to continue.');
      return;
    }
    
    setError('');
    
    let userMessageId = messages.length + 1;
    if (!isEditingExistingAnswer) {
      const newUserMessage = {
        id: generateMessageId(),
        sender: 'you',
        type: 'text',
        content: trimmedText,
        questionIndex: targetQuestionIndex,
        timestamp: new Date()
      };
      console.log('Adding user answer message:', newUserMessage);
      setMessages(prev => {
        const updated = [...prev, newUserMessage];
        console.log('Messages after adding user answer:', updated);
        return updated;
      });
    }

    setSelectedOptionByQuestion(prev => ({
      ...prev,
      [questionId]: trimmedText,
    }));
    setEditingQuestionId(null);
    setInputValue('');
    
    // Send to backend API for AI response
    setLoading(true);
    try {
      const payload = {
        message: trimmedText,
        patient_id: patientData?.id,
        question_index: targetQuestionIndex
      };
      console.log('Chat request payload:', payload);
      const response = await fetch(apiUrl('/api/chat/'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `API Error: ${response.status}`);
      }

      const data = await response.json();
      console.log('Chat response data:', data);
      console.log('has_next_question:', data.has_next_question);
      console.log('next_question:', data.next_question);
      console.log('next_responses:', data.next_responses);
      console.log('question_index:', data.question_index);

      if (data.edited) {
        setMessages(prev => prev.map(msg => {
          if (msg.sender === 'you' && msg.questionIndex === targetQuestionIndex) {
            return { ...msg, content: trimmedText };
          }
          return msg;
        }));

        // Even if edited, check for next question. Add question first (no responses), then populate responses shortly after.
        if (data.has_next_question && data.next_question) {
          console.log('Adding next question after edit (deferred responses)');
          const nextQuestionContent = data.next_question || data.next_question_text || (data.next_question && data.next_question.content) || data.next_intent || '';
          const nextQuestionId = generateMessageId();
          // Create question with empty responses initially so question text displays first
          const nextQuestionMessage = {
            id: nextQuestionId,
            sender: 'dr',
            type: 'question',
            content: nextQuestionContent,
            questionIndex: data.question_index,
            intent: data.next_intent,
            responses: [],
            timestamp: new Date()
          };

          justAddedQuestionIdRef.current = nextQuestionMessage.id;
          suppressAutoScrollForResponsesRef.current = nextQuestionMessage.id;
          setMessages(prev => [...prev, nextQuestionMessage]);

          setTimeout(() => {
            setMessages(prev => prev.map(m => m.id === nextQuestionId ? { ...m, responses: data.next_responses || [] } : m));
          }, 250);
        }
        return;
      }

      const totalQuestions = getTotalDatasetQuestions();
      const answeredAfterSubmit = Math.min(getAnsweredQuestionCount() + 1, totalQuestions);
      
      // Add bot acknowledgment response to UI
      // only show acknowledgment if this was the last question
      if (!data.has_next_question) {
        if (totalQuestions > 0 && answeredAfterSubmit < totalQuestions) {
          setError(`Please answer all required questions (${answeredAfterSubmit}/${totalQuestions} answered).`);
          return;
        }

        // Mark completed IMMEDIATELY to prevent timeout effect from running
        // This must happen before we add any messages to prevent race conditions
        setQuestionnaireCompleted(true);

        // If a fallback thank-you timer was scheduled, cancel it because backend replied.
        try {
          if (typeof thankYouTimeoutRef !== 'undefined' && thankYouTimeoutRef && thankYouTimeoutRef.current) {
            clearTimeout(thankYouTimeoutRef.current);
            thankYouTimeoutRef.current = null;
          }
        } catch (e) {
          // ignore
        }

        // Add backend completion only if no assistant completion exists in latest state.
        setMessages(prev => {
          const alreadyHasCompletion = (prev || []).some(m => {
            const txt = m.content || m.text || m.reply || m.message || '';
            const sender = (m.sender || '').toString().toLowerCase();
            const isAssistant = sender === 'dr' || sender === 'bot' || sender.includes('assistant');
            return isAssistant && isAssistantCompletionMessage(txt);
          });

          if (alreadyHasCompletion) return prev;

          const botMessage = {
            id: generateMessageId(),
            sender: 'dr',
            type: 'text',
            content: data.reply,
            timestamp: new Date()
          };
          return [...prev, botMessage];
        });
      }
      
      // If there's a next question, replace the temp placeholder (if any) or add it immediately
      if (data.has_next_question && data.next_question) {
        console.log('Replacing/adding next question to messages');
        const nextQuestionContent = data.next_question || data.next_question_text || (data.next_question && data.next_question.content) || data.next_intent || '';
        const nextQuestionId = generateMessageId();
        // Create question with empty responses initially so question text displays first
        const nextQuestionMessage = {
          id: nextQuestionId,
          sender: 'dr',
          type: 'question',
          content: nextQuestionContent,
          questionIndex: data.question_index,
          intent: data.next_intent,
          responses: [],
          timestamp: new Date()
        };

        setMessages(prev => {
          if (tempMessageId) {
            // Replace temp placeholder with actual question (without responses yet)
            const replaced = prev.map(m => (m.id === tempMessageId ? nextQuestionMessage : m));
            if (!replaced.find(m => m.id === nextQuestionMessage.id)) {
              // append if replacement didn't actually occur
              justAddedQuestionIdRef.current = nextQuestionMessage.id;
              suppressAutoScrollForResponsesRef.current = nextQuestionMessage.id;
              return [...replaced, nextQuestionMessage];
            }
            justAddedQuestionIdRef.current = nextQuestionMessage.id;
            suppressAutoScrollForResponsesRef.current = nextQuestionMessage.id;
            return replaced;
          }
          // No placeholder - just append the new question
          justAddedQuestionIdRef.current = nextQuestionMessage.id;
          suppressAutoScrollForResponsesRef.current = nextQuestionMessage.id;
          return [...prev, nextQuestionMessage];
        });

        // Reveal the answer options shortly after the question appears so the question is visible first
        setTimeout(() => {
          setMessages(prev => prev.map(m => m.id === nextQuestionId ? { ...m, responses: data.next_responses || [] } : m));
        }, 250);
      } else {
        console.log('No next question in response or missing data - has_next_question:', data.has_next_question, 'next_question:', data.next_question);
      }
      
    } catch (err) {
      setError(`Error: ${err.message}`);
      console.error('Chat error:', err);
      
      // Add error message
      const errorMessage = {
        id: generateMessageId(),
        sender: 'system',
        type: 'error',
        content: `Failed to get response: ${err.message}`,
        timestamp: new Date()
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setLoading(false);
    }
  };

  const handleOptionSelect = (questionId, response) => {
    setSelectedOptionByQuestion(prev => ({
      ...prev,
      [questionId]: response,
    }));
    setError('');
  };

  const handleConfirmSelectedOption = (questionId) => {
    const selectedAnswer = selectedOptionByQuestion[questionId];
    const question = messages.find(msg => msg.id === questionId && msg.type === 'question');
    if (!selectedAnswer) {
      setError('Please select one answer option before confirming.');
      return;
    }
    // Send the selected answer to backend; next question will be added when response arrives
    handleSendMessage(selectedAnswer, questionId, question?.questionIndex);
  };

  const latestQuestionId = getLatestQuestionMessage()?.id;
  const currentQuestionHasOptions = getLatestQuestionOptions().length > 0;

  return (
    <div className="chat-page-bg">
      <div className="chat-container">
       
        <div className="side-panel">
          <div className="patient-info-section">
            <h3 className="patient-info-title">Patient Information</h3>
            <div className="patient-meta">
              <div className="patient-detail">
                <span className="detail-label">Name:</span>
                <span className="detail-value">{patientData?.fullName || 'N/A'}</span>
              </div>
              <div className="patient-detail">
                <span className="detail-label">Queue:</span>
                <span className="detail-value">{patientData?.queueNumber || 'N/A'}</span>
              </div>
            </div>
          </div>

          <div className="scan-upload-section">
            <h3 className="scan-upload-title">Medical Scans & Documents</h3>
            <p className="scan-upload-subtitle">Upload relevant medical scans, reports, or documents for better diagnosis</p>
            
            <div 
              className={`upload-zone ${isDragOver ? 'drag-over' : ''}`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <div className="upload-zone-content">
                <div className="upload-icon">📄</div>
                <div className="upload-text">
                  <span className="upload-primary">Drop files here or click to browse</span>
                  <span className="upload-secondary">Supports: Images (JPG, PNG, HEIC), PDF, DOC, DOCX, TXT up to 10MB each</span>
                </div>
                <input
                  ref={scanFileInputRef}
                  type="file"
                  id="scan-upload"
                  className="native-file-input"
                  multiple
                  accept="image/*,.heic,.heif,.pdf,.doc,.docx,.txt"
                  onChange={async (e) => {
                    const validFiles = normalizeSelectedFiles(e.target.files);
                    if (validFiles.length > 0) {
                      await uploadFiles(validFiles);
                    }
                    e.target.value = '';
                  }}
                />
                <div className="upload-actions">
                  <button type="button" className="upload-btn" onClick={handleFileUpload} disabled={pendingScans.length === 0}>
                    Upload Files
                  </button>
                </div>
              </div>
            </div>

            {pendingScans.length > 0 && (
              <div className="uploaded-scans">
                <h4 className="uploaded-scans-title">Files Ready to Upload ({pendingScans.length})</h4>
                <div className="scans-list">
                  {pendingScans.map((scan, idx) => (
                    <div key={`${scan.name}-${scan.size}-${scan.lastModified}-${idx}`} className="scan-item">
                      <div className="scan-preview">
                        <div className="scan-pdf-icon">📄</div>
                      </div>
                      <div className="scan-info">
                        <div className="scan-name" title={scan.name}>{scan.name}</div>
                        <div className="scan-meta">{(scan.size / 1024 / 1024).toFixed(2)} MB</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {uploadedScans.length > 0 && (
              <div className="uploaded-scans">
                <h4 className="uploaded-scans-title">Uploaded Files ({uploadedScans.length})</h4>
                <div className="scans-list">
                  {uploadedScans.map((scan, idx) => (
                    <div key={`scan-${scan.id || idx}`} className="scan-item">
                      <div className="scan-preview">
                        {scan.preview ? (
                          <img src={scan.preview} alt={scan.name} className="scan-thumbnail" />
                        ) : (
                          <div className="scan-pdf-icon">📄</div>
                        )}
                      </div>
                      <div className="scan-info">
                        <div className="scan-name" title={scan.name}>
                          {scan.name.length > 20 ? `${scan.name.substring(0, 20)}...` : scan.name}
                        </div>
                        <div className="scan-meta">
                          {(scan.size / 1024 / 1024).toFixed(2)} MB • {getDisplayFileType(scan)}
                        </div>
                      </div>
                      <button 
                        className="scan-remove-btn"
                        onClick={() => removeScan(scan.id)}
                        title="Remove file"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {uploadStatus && <p className="upload-secondary">{uploadStatus}</p>}
          </div>
        </div>

        {/* Right Chat Area */}
        <div className="chat-window">
          <div className="question-progress-banner">
            {(() => {
              const progress = getQuestionProgress();
              return `Questions answered: ${progress.answered}/${progress.total || 0}`;
            })()}
          </div>
          <div className="doctor-messages-note">
            If you have any other symptoms, you can tell your doctor through Doctor Messages.
          </div>
          <div className="message-list" ref={messageListRef}>
            {error && (
              <div className="error-banner">
                <span>⚠️ {error}</span>
              </div>
            )}
            
            {messages.map((msg, idx) => (
              <div key={msg.id ? `msg-${msg.id}-${msg.sender || 'unknown'}` : `msg-${idx}-${msg.sender || 'unknown'}`} className={`msg-wrapper ${msg.sender}`}>
                <span className="sender-label">
                  {msg.sender === 'dr' ? 'Dr. Assistant' : 
                   msg.sender === 'system' ? 'System' : 
                   'You'}
                </span>
                
                {msg.type === 'question' ? (
                  <div className="question-bubble">
                    <div className="question-text">{msg.content}</div>
                    {msg.responses && msg.responses.length > 0 && (
                      <div className="response-options">
                        <div className="options-label">Choose your answer:</div>
                        <div className="options-grid">
                          {(() => {
                            const savedAnswer = getAnswerMessageByQuestionIndex(msg.questionIndex)?.content || '';
                            const selectedAnswer = selectedOptionByQuestion[msg.id] || savedAnswer;
                            const isCurrentQuestion = latestQuestionId === msg.id;
                            const hasSavedAnswer = Boolean(savedAnswer);
                            const isEditingThisQuestion = editingQuestionId === msg.id;
                            const isAnswerControlsEnabled = !loading && (isCurrentQuestion || isEditingThisQuestion);

                            return (
                              <>
                          {msg.responses.map((response, idx) => (
                            <button
                              key={`${msg.id}-${idx}`}
                              className={`option-button ${selectedAnswer === response ? 'selected' : ''}`}
                              onClick={() => handleOptionSelect(msg.id, response)}
                              disabled={!isAnswerControlsEnabled}
                            >
                              <span className="option-text">{response}</span>
                              <span className="option-arrow">{selectedAnswer === response ? '✓' : '→'}</span>
                            </button>
                          ))}
                                <div className="option-confirm-row">
                                  {hasSavedAnswer && !isEditingThisQuestion && (
                                    <button
                                      type="button"
                                      className="edit-option-btn"
                                      onClick={() => {
                                        setEditingQuestionId(msg.id);
                                        setSelectedOptionByQuestion(prev => ({
                                          ...prev,
                                          [msg.id]: savedAnswer,
                                        }));
                                        setError('');
                                      }}
                                    >
                                      Change Answer
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    className="confirm-option-btn"
                                    onClick={() => handleConfirmSelectedOption(msg.id)}
                                    disabled={!isAnswerControlsEnabled || !selectedAnswer}
                                  >
                                    {hasSavedAnswer && !isCurrentQuestion ? 'Update Answer' : 'Confirm Selected Answer'}
                                  </button>
                                  {isEditingThisQuestion && !isCurrentQuestion && (
                                    <button
                                      type="button"
                                      className="cancel-edit-btn"
                                      onClick={() => {
                                        setEditingQuestionId(null);
                                        setSelectedOptionByQuestion(prev => ({
                                          ...prev,
                                          [msg.id]: savedAnswer,
                                        }));
                                      }}
                                    >
                                      Cancel
                                    </button>
                                  )}
                                  {selectedAnswer && (
                                    <span className="selected-answer-preview">
                                      Selected: {selectedAnswer}
                                    </span>
                                  )}
                                </div>
                              </>
                            );
                          })()}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className={`bubble ${msg.type === 'error' ? 'error' : ''}`}>
                    <div className="message-content">{msg.content}</div>
                    {msg.confidence !== undefined && (
                      <small className="confidence-badge">
                        (confidence: {(msg.confidence * 100).toFixed(0)}%)
                      </small>
                    )}
                  </div>
                )}
              </div>
            ))}
            
            {loading && (
              <div className="msg-wrapper dr">
                <span className="sender-label">Dr. Assistant</span>
                <div className="bubble loading">
                  <span className="typing-indicator">
                    <span></span><span></span><span></span>
                  </span>
                </div>
              </div>
            )}
          </div>

          <div className="input-area">
            <div className="input-container">
              <input 
                type="text" 
                value={inputValue}
                placeholder={currentQuestionHasOptions ? 'Choose one option above and confirm your answer.' : 'Type your response here...'}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !loading && !questionnaireCompleted && !currentQuestionHasOptions) {
                    handleSendMessage(inputValue);
                  }
                }}
                disabled={loading || questionnaireCompleted || currentQuestionHasOptions}
              />
              <button 
                onClick={() => handleSendMessage(inputValue)}
                disabled={loading || questionnaireCompleted || currentQuestionHasOptions || !inputValue.trim()}
                className="send-btn"
              >
                {loading ? (
                  <span className="sending-spinner">⟳</span>
                ) : (
                  <span className="send-icon">📤</span>
                )}
              </button>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
};

export default DiagnosticChat;