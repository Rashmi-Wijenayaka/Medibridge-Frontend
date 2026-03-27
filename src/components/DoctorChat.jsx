import React, { useState, useEffect, useCallback, useRef } from 'react';
import './AdminDoctor.css';

// simple doctor chat interface for communicating with patients
const DoctorChat = ({ onBack, user }) => {
  const DEFAULT_CONVERSATION_START_ISO = '1970-01-01T00:00:00.000Z';
  const [patients, setPatients] = useState([]);
  const [patientsWithSummaries, setPatientsWithSummaries] = useState([]);
  const [patientUnreadMeta, setPatientUnreadMeta] = useState({});
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [messages, setMessages] = useState([]);
  const [patientAnswers, setPatientAnswers] = useState([]);
  const [summaryPdfs, setSummaryPdfs] = useState([]);
  const [patientClueSummaryById, setPatientClueSummaryById] = useState({});
  const [clueSummaryView, setClueSummaryView] = useState(null);
  const [input, setInput] = useState('');
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [uploadStatus, setUploadStatus] = useState('');
  const socketRef = useRef(null);
  const latestConversationRequestRef = useRef(0);
  const conversationRequestCounterRef = useRef(0);

  // LocalStorage keys for persisting doctor UI state
  const doctorSeenSummaryStorageKey = 'doctor_seen_summary_v1';
  const doctorSeenReplyStorageKey = 'doctor_seen_reply_v1';
  const doctorConversationStartStorageKey = 'doctor_conversation_start_v1';
  const doctorManualStartStorageKey = 'doctor_manual_start_v1';

  const toTimeMs = useCallback((ts) => {
    if (!ts) return 0;
    // numeric timestamps (ms) may be passed as numbers or strings
    const asNumber = Number(ts);
    if (!Number.isNaN(asNumber) && asNumber > 0) return asNumber;
    const parsed = Date.parse(ts);
    return Number.isNaN(parsed) ? 0 : parsed;
  }, []);

  const cleanClueSummaryText = useCallback((text = '') => {
    if (!text) return '';
    return text
      .replace(/\bAI\b\s*/gi, '')
      .replace(/\(?\s*\d+(?:\.\d+)?\s*%\s*confidence\s*\)?/gi, '')
      .replace(/\s{2,}/g, ' ')
      .split('\n')
      .map((line) => line.trim().replace(/\s+([,.;:])/g, '$1'))
      .filter(Boolean)
      .join('\n');
  }, []);

  const getJsonFromStorage = useCallback((key) => {
    try {
      const raw = localStorage.getItem(key) || '{}';
      return JSON.parse(raw || '{}') || {};
    } catch (e) {
      return {};
    }
  }, []);

  const saveJsonToStorage = useCallback((key, obj) => {
    try {
      localStorage.setItem(key, JSON.stringify(obj || {}));
    } catch (e) {
      // ignore storage errors
    }
  }, []);

  const getSeenSummaryMap = useCallback(() => getJsonFromStorage(doctorSeenSummaryStorageKey), [getJsonFromStorage]);
  const saveSeenSummaryMap = useCallback((m) => saveJsonToStorage(doctorSeenSummaryStorageKey, m), [saveJsonToStorage]);

  const getSeenReplyMap = useCallback(() => getJsonFromStorage(doctorSeenReplyStorageKey), [getJsonFromStorage]);
  const saveSeenReplyMap = useCallback((nextMap) => saveJsonToStorage(doctorSeenReplyStorageKey, nextMap), [saveJsonToStorage]);

  const getConversationStartMap = useCallback(() => getJsonFromStorage(doctorConversationStartStorageKey), [getJsonFromStorage]);
  const saveConversationStartMap = useCallback((m) => saveJsonToStorage(doctorConversationStartStorageKey, m), [saveJsonToStorage]);

  const getManualStartMap = useCallback(() => getJsonFromStorage(doctorManualStartStorageKey), [getJsonFromStorage]);
  const saveManualStartMap = useCallback((m) => saveJsonToStorage(doctorManualStartStorageKey, m), [saveJsonToStorage]);

  const ensureConversationStartTimestamp = useCallback((patientId) => {
    if (!patientId) return DEFAULT_CONVERSATION_START_ISO;
    const key = String(patientId);
    const map = getConversationStartMap();
    if (map && map[key]) return map[key];
    // If a manual start flag was set, prefer returning the stored start (if any)
    const manual = getManualStartMap();
    if (manual && manual[key]) {
      return map[key] || new Date().toISOString();
    }
    return DEFAULT_CONVERSATION_START_ISO;
  }, [getConversationStartMap, getManualStartMap]);

  // Append realtime message from websocket safely into state
  const appendRealtimeMessage = useCallback((payload) => {
    if (!payload) return;
    const pid = payload.patient || payload.patient_id || null;
    if (!selectedPatient || !selectedPatient.id) return;
    if (String(pid) !== String(selectedPatient.id)) return;
    const ts = payload.timestamp || payload.created_at || new Date().toISOString();
    const startTs = ensureConversationStartTimestamp(selectedPatient.id);
    if (toTimeMs(ts) < toTimeMs(startTs)) return;
    // If the incoming message contains an area_of_concern and it's different
    // from the patient's current area, update the selectedPatient topic in UI.
    try {
      const incomingArea = payload.area_of_concern || payload.area || null;
      if (incomingArea && String(incomingArea) !== String(selectedPatient.area_of_concern)) {
        const normalized = String(incomingArea).trim();
        const nextPatient = { ...(selectedPatient || {}), area_of_concern: normalized };
        setSelectedPatient(nextPatient);
        setPatients(prev => (prev || []).map(p => (p.id === nextPatient.id ? { ...p, area_of_concern: normalized } : p)));
        setPatientsWithSummaries(prev => (prev || []).map(p => (p.id === nextPatient.id ? { ...p, area_of_concern: normalized } : p)));
      }
    } catch (e) {
      // Ignore any normalization errors
    }
    setMessages((prev) => {
      const arr = prev || [];
      if (arr.some(m => String(m.id) === String(payload.id))) return arr;
      const merged = [...arr, payload];
      merged.sort((a, b) => toTimeMs(a.timestamp || a.created_at) - toTimeMs(b.timestamp || b.created_at));
      return merged;
    });
  }, [selectedPatient, ensureConversationStartTimestamp, toTimeMs]);

  const buildPatientDisplayKey = useCallback((patient) => {
    const name = (patient?.full_name || '').trim().toLowerCase();
    const queue = (patient?.queue_number || '').trim().toLowerCase();
    return `${name}::${queue}`;
  }, []);

  const dedupePatientsByDisplay = useCallback((items) => {
    const byDisplayKey = new Map();

    (items || []).forEach((patient) => {
      const key = buildPatientDisplayKey(patient);
      const existing = byDisplayKey.get(key);
      if (!existing) {
        byDisplayKey.set(key, patient);
        return;
      }

      // Prefer records with ready summary, then newer id.
      if (patient.hasSummaryReady && !existing.hasSummaryReady) {
        byDisplayKey.set(key, patient);
        return;
      }
      if (patient.hasSummaryReady === existing.hasSummaryReady && (patient.id || 0) > (existing.id || 0)) {
        byDisplayKey.set(key, patient);
      }
    });

    return Array.from(byDisplayKey.values());
  }, [buildPatientDisplayKey]);

  const fetchDoctorData = useCallback(() => {
    const token = localStorage.getItem('token');
    Promise.all([
      fetch('http://127.0.0.1:8000/api/patients/', { headers: { 'Authorization': `Token ${token}` } }),
      fetch('http://127.0.0.1:8000/api/diagnoses/', { headers: { 'Authorization': `Token ${token}` } }),
      fetch('http://127.0.0.1:8000/api/messages/', { headers: { 'Authorization': `Token ${token}` } }),
      fetch('http://127.0.0.1:8000/api/doctormessages/', { headers: { 'Authorization': `Token ${token}` } })
    ])
      .then(async ([patientsRes, diagnosesRes, messagesRes, doctorMessagesRes]) => {
        const [patientsData, diagnosesData, messagesData, doctorMessagesData] = await Promise.all([
          patientsRes.json(), diagnosesRes.json(), messagesRes.json(), doctorMessagesRes.json()
        ]);

        const diagnosisCountByPatient = {};
        (diagnosesData || []).forEach((d) => {
          const pid = d.patient_details?.id || d.patient;
          if (!pid) return;
          const k = String(pid);
          diagnosisCountByPatient[k] = (diagnosisCountByPatient[k] || 0) + 1;
        });

        const summaryReadyDiagnoses = (diagnosesData || []).filter(d => d.sent_to_doctor && d.summary_pdf);
        const seenSummaryMap = getSeenSummaryMap();
        const latestSummaryTimestampByPatient = {};
        // Be tolerant of diagnosis items that may expose the patient id in
        // different fields (`patient_details.id`, `patient`, or `patient_id`).
        summaryReadyDiagnoses.forEach((item) => {
          const pid = item.patient_details?.id || item.patient || item.patient_id;
          if (!pid) return;
          const k = String(pid);
          const ts = item.created_at || item.timestamp || '';
          if (!latestSummaryTimestampByPatient[k] || toTimeMs(ts) > toTimeMs(latestSummaryTimestampByPatient[k])) {
            latestSummaryTimestampByPatient[k] = ts;
          }
        });

        const unreadSummaryPatientIds = new Set(Object.entries(latestSummaryTimestampByPatient)
          .filter(([pid, ts]) => { const seen = seenSummaryMap[pid] || ''; return !seen || toTimeMs(ts) > toTimeMs(seen); })
          .map(([pid]) => Number(pid)));

        const summaryPatientMap = new Map();
        summaryReadyDiagnoses.forEach((item) => {
          const pid = item.patient_details?.id || item.patient || item.patient_id;
          if (!pid) return;
          if (!unreadSummaryPatientIds.has(Number(pid))) return;
          const patientDetails = item.patient_details || { id: pid, full_name: item.patient_name || item.patient_full_name || '' };
          summaryPatientMap.set(Number(pid), { ...patientDetails, diagnosisRound: diagnosisCountByPatient[String(pid)] || 1 });
        });

        const dedupedSummaryPatients = dedupePatientsByDisplay(Array.from(summaryPatientMap.values()));

        const patientsWithActivity = new Set([
          ...(diagnosesData || []).map(d => d.patient_details?.id || d.patient).filter(Boolean),
          ...(messagesData || []).filter(m => m.sender === 'patient' && m.patient).map(m => m.patient),
          ...(doctorMessagesData || []).filter(m => (m?.sender?.role || '').toLowerCase() === 'patient' && m.patient).map(m => m.patient),
        ]);

        const patientList = (patientsData || [])
          .filter(p => patientsWithActivity.has(p.id))
          .map(p => ({ ...p, hasSummaryReady: unreadSummaryPatientIds.has(p.id), diagnosisRound: diagnosisCountByPatient[String(p.id)] || 1 }));

        const dedupedPatients = dedupePatientsByDisplay(patientList);
        const summaryIds = new Set(dedupedSummaryPatients.map(p => p.id));
        const dedupedPatientsFiltered = dedupedPatients.filter(p => !summaryIds.has(p.id));

        const latestDiagnosisByPatient = {};
        (diagnosesData || []).forEach((item) => {
          const pid = item.patient_details?.id || item.patient;
          if (!pid) return;
          const k = String(pid);
          const ts = item.created_at || item.timestamp || '';
          const existing = latestDiagnosisByPatient[k];
          if (!existing || toTimeMs(ts) > toTimeMs(existing.createdAt)) {
            latestDiagnosisByPatient[k] = { createdAt: ts, summary: cleanClueSummaryText(item.admin_notes || ''), summaryPdf: item.summary_pdf || '' };
          }
        });

        dedupedPatientsFiltered.sort((a, b) => {
          if (a.hasSummaryReady === b.hasSummaryReady) return (a.full_name || '').localeCompare(b.full_name || '');
          return a.hasSummaryReady ? -1 : 1;
        });

        setPatients(dedupedPatientsFiltered);
        setPatientsWithSummaries(dedupedSummaryPatients);
        setPatientClueSummaryById(latestDiagnosisByPatient);
      })
      .catch(err => console.error('Error loading doctor data', err));
  }, [dedupePatientsByDisplay, getSeenSummaryMap, cleanClueSummaryText, toTimeMs]);

  

  const markSummaryAsRead = useCallback((patientId, summaryTimestamp) => {
    if (!patientId || !summaryTimestamp) return;
    const seenSummaryMap = getSeenSummaryMap();
    const key = String(patientId);
    const seenTs = seenSummaryMap[key] || '';
    if (!seenTs || toTimeMs(summaryTimestamp) > toTimeMs(seenTs)) {
      seenSummaryMap[key] = summaryTimestamp;
      saveSeenSummaryMap(seenSummaryMap);
    }

    // Ensure patient appears in main patient list after marking summary read.
    setPatientsWithSummaries((prevSummaries) => {
      const prev = prevSummaries || [];
      const removed = prev.find(item => String(item.id) === key);
      const nextSummaries = prev.filter(item => String(item.id) !== key);

      if (removed) {
        setPatients((prevPatients) => {
          const patientsArr = prevPatients || [];
          const exists = patientsArr.some(p => String(p.id) === key);
          if (exists) {
            return patientsArr.map((item) => (String(item.id) === key ? { ...item, hasSummaryReady: false } : item));
          }

          const newPatient = { ...removed, hasSummaryReady: false, diagnosisRound: removed.diagnosisRound || 1 };
          const merged = [...patientsArr, newPatient];
          return dedupePatientsByDisplay(merged);
        });
      } else {
        // If we didn't find the patient in summaries, still ensure any existing patient flags are cleared.
        setPatients((prevPatients) => (prevPatients || []).map((item) => {
          if (String(item.id) !== key) return item;
          return { ...item, hasSummaryReady: false };
        }));
      }

      return nextSummaries;
    });
    // Refresh data so diagnosis rounds and lists reflect latest server state
    try { fetchDoctorData(); } catch (e) { /* ignore */ }
  }, [getSeenSummaryMap, saveSeenSummaryMap, toTimeMs, dedupePatientsByDisplay, fetchDoctorData]);

  const refreshUnreadPatientReplies = useCallback(() => {
    const token = localStorage.getItem('token');
    Promise.all([
      fetch('http://127.0.0.1:8000/api/messages/', {
        headers: { 'Authorization': `Token ${token}` }
      }),
      fetch('http://127.0.0.1:8000/api/doctormessages/', {
        headers: { 'Authorization': `Token ${token}` }
      })
    ])
      .then(async ([legacyMsgRes, doctorMsgRes]) => {
        const [legacyMessages, doctorMessages] = await Promise.all([
          legacyMsgRes.ok ? legacyMsgRes.json() : [],
          doctorMsgRes.ok ? doctorMsgRes.json() : [],
        ]);

        const seenMap = getSeenReplyMap();
        const legacyPatientMessages = (legacyMessages || []).filter(msg => msg.sender === 'patient' && msg.patient);
        const doctorChannelPatientMessages = (doctorMessages || []).filter(msg => {
          const senderRole = (msg?.sender?.role || '').toString().toLowerCase();
          return senderRole === 'patient' && msg.patient;
        });

        const patientMessages = [...legacyPatientMessages, ...doctorChannelPatientMessages];
        const byPatient = {};

        patientMessages.forEach((msg) => {
          const patientId = msg.patient;
          const timestamp = msg.timestamp || '';
          const startTs = ensureConversationStartTimestamp(patientId);
          if (toTimeMs(timestamp) < toTimeMs(startTs)) {
            return;
          }
          if (!byPatient[patientId]) {
            byPatient[patientId] = { latestTimestamp: timestamp, unreadCount: 1 };
            return;
          }
          byPatient[patientId].unreadCount += 1;
          if (timestamp > byPatient[patientId].latestTimestamp) {
            byPatient[patientId].latestTimestamp = timestamp;
          }
        });

        const unreadMeta = {};
        Object.entries(byPatient).forEach(([patientId, meta]) => {
          const seenTs = seenMap[patientId] || '';
          const isUnread = meta.latestTimestamp > seenTs;
          unreadMeta[patientId] = {
            hasUnread: isUnread,
            unreadCount: isUnread ? meta.unreadCount : 0,
            latestTimestamp: meta.latestTimestamp,
          };
        });

        setPatientUnreadMeta(unreadMeta);
      })
      .catch(err => console.error('Error loading unread patient replies', err));
  }, [getSeenReplyMap, ensureConversationStartTimestamp]);

  const buildPdfUrl = (pdfPath, createdAt) => {
    if (!pdfPath) return '#';
    const base = pdfPath.startsWith('http') ? pdfPath : `http://127.0.0.1:8000${pdfPath}`;
    const stamp = createdAt ? new Date(createdAt).getTime() : Date.now();
    return `${base}?v=${stamp}`;
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

  const resolveAttachmentSender = (scan) => {
    const role = (scan?.uploaded_by_role || '').toLowerCase();
    if (role === 'doctor' || role === 'admin') return 'doctor';

    // Fallback for legacy records where uploaded_by_role may be missing.
    const currentUserId = Number(user?.id || 0);
    const uploadedById = Number(scan?.uploaded_by || 0);
    if (currentUserId > 0 && uploadedById > 0 && currentUserId === uploadedById) {
      return 'doctor';
    }

    return 'patient';
  };

  const mapScanToAttachmentMessage = (scan) => {
    const fileUrl = normalizeFileUrl(scan?.file || '');
    return {
      id: `scan-${scan?.id || Date.now()}`,
      timestamp: scan?.uploaded_at || new Date().toISOString(),
      sender: { role: resolveAttachmentSender(scan), username: 'Attachment' },
      source: 'scan_attachment',
      file_url: fileUrl,
      file_name: getFileName(fileUrl),
    };
  };

  const isPdfFile = (fileUrl = '') => /\.pdf(\?|$)/i.test(fileUrl);
  const isImageFile = (fileUrl = '') => /\.(jpe?g|png|gif|webp|bmp|heic|heif)(\?|$)/i.test(fileUrl);
  const getFileExtension = (fileUrl = '') => {
    const clean = fileUrl.split('?')[0];
    const idx = clean.lastIndexOf('.');
    return idx >= 0 ? clean.slice(idx + 1).toUpperCase() : 'FILE';
  };

  const getPatientDisplayName = (patient) => {
    const fullName = (patient?.full_name || '').trim();
    return fullName || 'Unknown Patient';
  };

  const getDiagnosisRoundLabel = (patient) => {
    const round = Number(patient?.diagnosisRound || 1);
    return `Round ${round}`;
  };

  useEffect(() => {
    fetchDoctorData();
    refreshUnreadPatientReplies();

    const pollId = setInterval(() => {
      refreshUnreadPatientReplies();
    }, 5000);

    const dataPollId = setInterval(() => {
      fetchDoctorData();
    }, 10000);

    return () => {
      clearInterval(pollId);
      clearInterval(dataPollId);
    };
  }, [fetchDoctorData, refreshUnreadPatientReplies]);

  useEffect(() => {
    if (!selectedPatient?.id) return undefined;

    const token = localStorage.getItem('token');
    if (!token) return undefined;

    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const host = window.location.hostname || '127.0.0.1';
    const wsUrl = `${protocol}://${host}:8000/ws/chat/${selectedPatient.id}/?token=${encodeURIComponent(token)}`;

    try {
      const ws = new WebSocket(wsUrl);
      socketRef.current = ws;

      ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data || '{}');
          appendRealtimeMessage(payload);
        } catch {
          // Ignore malformed websocket payloads.
        }
      };

      ws.onerror = () => {
        // Keep UI functional even when websocket has transient issues.
      };
      return () => {
        ws.close();
        if (socketRef.current === ws) {
          socketRef.current = null;
        }
      };
    } catch {
      // Ignore websocket construction errors; REST remains fallback.
    }

    return undefined;
  }, [selectedPatient?.id, appendRealtimeMessage]);

  const loadMessages = (patient) => {
    const requestId = ++conversationRequestCounterRef.current;
    latestConversationRequestRef.current = requestId;

    const isDifferentPatient = selectedPatient?.id !== patient?.id;
    setSelectedPatient(patient);
    if (isDifferentPatient) {
      setMessages([]);
      setPatientAnswers([]);
    }
    setClueSummaryView(null);
    setInput('');
    setSelectedFiles([]);
    setUploadStatus('');

    const conversationStartTs = ensureConversationStartTimestamp(patient.id);
    const conversationStartMs = toTimeMs(conversationStartTs);
    const token = localStorage.getItem('token');

    const unreadInfo = patientUnreadMeta[patient.id];
    if (unreadInfo?.latestTimestamp) {
      const seenMap = getSeenReplyMap();
      seenMap[String(patient.id)] = unreadInfo.latestTimestamp;
      saveSeenReplyMap(seenMap);
      setPatientUnreadMeta(prev => ({
        ...prev,
        [String(patient.id)]: {
          ...(prev[String(patient.id)] || {}),
          hasUnread: false,
          unreadCount: 0,
        }
      }));
    }

    Promise.all([
      fetch(`http://127.0.0.1:8000/api/doctormessages/?patient=${patient.id}`, {
        headers: { 'Authorization': `Token ${token}` }
      }),
      fetch(`http://127.0.0.1:8000/api/messages/?patient=${patient.id}`, {
        headers: { 'Authorization': `Token ${token}` }
      }),
      fetch(`http://127.0.0.1:8000/api/scans/?patient=${patient.id}`, {
        headers: { 'Authorization': `Token ${token}` }
      })
    ])
      .then(async ([doctorMsgRes, patientMsgRes, scanRes]) => {
        if (!doctorMsgRes.ok || !patientMsgRes.ok || !scanRes.ok) {
          throw new Error('Failed to load complete conversation data.');
        }

        const [doctorMsgData, patientMsgData, scansData] = await Promise.all([
          doctorMsgRes.json(),
          patientMsgRes.json(),
          scanRes.json()
        ]);

        // Ignore stale responses from older requests to prevent flicker.
        if (latestConversationRequestRef.current !== requestId) {
          return;
        }

        const doctorMessagesList = Array.isArray(doctorMsgData) ? doctorMsgData : [];
        const patientMessagesList = Array.isArray(patientMsgData) ? patientMsgData : [];
        const scansList = Array.isArray(scansData) ? scansData : [];

        const answers = patientMessagesList.filter(msg => {
          if (msg.sender !== 'patient') return false;
          return toTimeMs(msg.timestamp) >= conversationStartMs;
        });
        setPatientAnswers(answers);

        const mappedPatientAnswers = answers.map(answer => ({
          id: `patient-answer-${answer.id}`,
          text: answer.text,
          timestamp: answer.timestamp,
          sender: { role: 'patient', username: 'Patient' },
          source: 'patient_answer'
        }));

        const mappedAttachments = scansList
          .filter(scan => toTimeMs(scan.uploaded_at) >= conversationStartMs)
          .map(mapScanToAttachmentMessage);

        const filteredDoctorMessages = doctorMessagesList.filter(msg => {
          const ts = msg.timestamp || msg.created_at;
          return toTimeMs(ts) >= conversationStartMs;
        });

        const mergedConversation = [...filteredDoctorMessages, ...mappedPatientAnswers, ...mappedAttachments];

        // If any message in the fetched conversation includes an area_of_concern,
        // update the selected patient topic in the UI so the 'Topic' label appears.
        try {
          const foundArea = mergedConversation.reduce((acc, item) => {
            return acc || (item && (item.area_of_concern || item.area || null));
          }, null);
          if (foundArea && String(foundArea) !== String(patient.area_of_concern)) {
            const normalized = String(foundArea).trim();
            // update the selectedPatient object in state
            setSelectedPatient((prev) => prev && prev.id === patient.id ? { ...prev, area_of_concern: normalized } : prev);
            setPatients(prev => (prev || []).map(p => (p.id === patient.id ? { ...p, area_of_concern: normalized } : p)));
            setPatientsWithSummaries(prev => (prev || []).map(p => (p.id === patient.id ? { ...p, area_of_concern: normalized } : p)));
          }
        } catch (e) {
          // ignore errors updating UI topic
        }

        setMessages((prev) => {
          // Keep already visible history when a transient fetch returns empty data
          // for non-manual conversations.
          if (mergedConversation.length === 0 && prev.length > 0 && conversationStartMs === 0) {
            return prev;
          }

          const previousScanAttachments = (prev || []).filter(item => item?.source === 'scan_attachment');
          const combined = [...mergedConversation];

          previousScanAttachments.forEach((item) => {
            if (!combined.some(existing => existing.id === item.id)) {
              combined.push(item);
            }
          });

          combined.sort((left, right) => toTimeMs(left.timestamp || left.created_at) - toTimeMs(right.timestamp || right.created_at));
          return combined;
        });

      })
      .then(() => {
        // finished loading doctor messages, patient messages and scans
      })
      .catch(err => console.error('Error loading conversation data', err));

    // now fetch diagnoses separately
    fetch(`http://127.0.0.1:8000/api/diagnoses/?patient=${patient.id}`, {
      headers: { 'Authorization': `Token ${token}` }
    })
      .then(res => res.json())
      .then(data => {
        const diagnosisList = Array.isArray(data) ? data : [];
        const latestDiagnosis = diagnosisList
          .slice()
          .sort((left, right) => {
            const leftTs = toTimeMs(left.created_at || left.timestamp);
            const rightTs = toTimeMs(right.created_at || right.timestamp);
            return rightTs - leftTs;
          })[0];

        if (latestDiagnosis) {
          setPatientClueSummaryById((prev) => ({
            ...prev,
            [String(patient.id)]: {
              createdAt: latestDiagnosis.created_at || latestDiagnosis.timestamp || '',
              summary: cleanClueSummaryText(latestDiagnosis.admin_notes || ''),
              summaryPdf: latestDiagnosis.summary_pdf || '',
            },
          }));
        }

        const sentReports = (data || []).filter(item => item.sent_to_doctor && item.summary_pdf);
        setSummaryPdfs(sentReports);

        // Ensure the patient's displayed diagnosis round is updated immediately
        try {
          const newRound = Array.isArray(diagnosisList) ? diagnosisList.length : 1;
          setPatients((prev) => (prev || []).map((p) => (p.id === patient.id ? { ...p, diagnosisRound: newRound } : p)));
          setPatientsWithSummaries((prev) => (prev || []).map((p) => (p.id === patient.id ? { ...p, diagnosisRound: newRound } : p)));
        } catch (err) {
          // Non-fatal: keep UI stable if updates fail
          console.error('Failed to update diagnosis round in state', err);
        }
      })
      .catch(err => console.error('Error loading summary PDFs', err));

  };

  const startNewConversationForPatient = () => {
    if (!selectedPatient?.id) return;
    const key = String(selectedPatient.id);
    const nowIso = new Date().toISOString();

    const startMap = getConversationStartMap();
    startMap[key] = nowIso;
    saveConversationStartMap(startMap);

    const manualStartMap = getManualStartMap();
    manualStartMap[key] = true;
    saveManualStartMap(manualStartMap);

    const seenMap = getSeenReplyMap();
    seenMap[key] = nowIso;
    saveSeenReplyMap(seenMap);

    setMessages([]);
    setPatientAnswers([]);
    setInput('');
    setSelectedFiles([]);
    setUploadStatus('Started a new conversation thread for this patient.');
    setPatientUnreadMeta(prev => ({
      ...prev,
      [key]: {
        ...(prev[key] || {}),
        hasUnread: false,
        unreadCount: 0,
        latestTimestamp: nowIso,
      }
    }));
  };

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || !selectedPatient) return;
    const token = localStorage.getItem('token');

    try {
      const response = await fetch('http://127.0.0.1:8000/api/doctormessages/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Token ${token}`,
        },
        body: JSON.stringify({
          patient: selectedPatient.id,
          text,
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData?.error || `Failed to send message (${response.status})`);
      }

      const createdMessage = await response.json();
      setInput('');

      // Doctor messages are posted via REST, so render immediately in UI.
      if (createdMessage && createdMessage.id) {
        setMessages((prev) => {
          if ((prev || []).some((item) => item.id === createdMessage.id)) {
            return prev;
          }
          const merged = [...(prev || []), createdMessage];
          merged.sort((left, right) => toTimeMs(left.timestamp || left.created_at) - toTimeMs(right.timestamp || right.created_at));
          return merged;
        });
      }

      // Keep server and client state aligned after send.
      loadMessages(selectedPatient);
    } catch (err) {
      console.error('Failed to send doctor message', err);
      alert(err.message || 'Failed to send message');
    }
  };

  const handleDoctorFileChange = (event) => {
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
      setUploadStatus('Some files were rejected. Allowed: images (including HEIC), PDF, DOC, DOCX, TXT under 10MB.');
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
      setUploadStatus(`Added ${validFiles.length} file(s). You can add more before sharing.`);
    }
    event.target.value = '';
  };

  const handleDoctorFileUpload = async () => {
    if (!selectedPatient?.id || selectedFiles.length === 0) return;

    const token = localStorage.getItem('token');
    setUploadStatus('Uploading files to patient...');

    try {
      const uploadedScans = await Promise.all(
        selectedFiles.map(async (file) => {
          const formData = new FormData();
          formData.append('patient', selectedPatient.id);
          formData.append('file', file);

          const res = await fetch('http://127.0.0.1:8000/api/scans/', {
            method: 'POST',
            headers: {
              'Authorization': `Token ${token}`,
            },
            body: formData,
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

          return await res.json();
        })
      );

      const uploadedAttachmentMessages = uploadedScans
        .filter(Boolean)
        .map((scan) => {
          const normalizedScan = {
            ...scan,
            uploaded_by: scan?.uploaded_by || user?.id,
            uploaded_by_role: scan?.uploaded_by_role || 'doctor',
          };
          return mapScanToAttachmentMessage(normalizedScan);
        });

      if (uploadedAttachmentMessages.length > 0) {
        setMessages(prev => {
          const merged = [...prev, ...uploadedAttachmentMessages];
          merged.sort((left, right) => new Date(left.timestamp || 0) - new Date(right.timestamp || 0));
          return merged;
        });
      }

      setSelectedFiles([]);
      setUploadStatus('Files uploaded and shared with patient successfully.');
      if (selectedPatient) {
        setTimeout(() => {
          loadMessages(selectedPatient);
        }, 1500);
      }
    } catch (err) {
      setUploadStatus(`Error: ${err.message}`);
    }
  };

  const getSenderType = (message) => {
    const senderRole = message.sender?.role;
    if (senderRole === 'doctor') return 'doctor';
    if (senderRole === 'patient') return 'patient';

    if (typeof message.sender === 'string') {
      return message.sender.toLowerCase().includes('doctor') ? 'doctor' : 'patient';
    }
    const username = message.sender?.username || '';
    return username.toLowerCase().includes('doctor') ? 'doctor' : 'patient';
  };

  const formatTime = (timestamp) => {
    if (!timestamp) return '';
    const value = new Date(timestamp);
    if (Number.isNaN(value.getTime())) return '';
    return value.toLocaleString();
  };

  const redirectToClueSummary = () => {
    if (!selectedPatient) return;

    const summaryEntry = patientClueSummaryById[String(selectedPatient.id)];
    const clueSummaryText = (summaryEntry?.summary || '').trim();
    if (!clueSummaryText) {
      alert('No clue summary is available for this patient yet.');
      return;
    }

    const summaryPdfUrl = summaryEntry?.summaryPdf
      ? buildPdfUrl(summaryEntry.summaryPdf, summaryEntry.createdAt)
      : '';

    setClueSummaryView({
      queue: selectedPatient.queue_number || 'N/A',
      patientName: selectedPatient.full_name || 'Patient',
      summaryText: clueSummaryText,
      summaryPdfUrl,
    });
  };

  const renderAttachmentBubble = (message) => {
    const fileUrl = message.file_url || '';
    const fileName = message.file_name || getFileName(fileUrl);
    const senderType = getSenderType(message);
    const senderLabel = senderType === 'doctor' ? 'Doctor shared a file' : 'Patient shared a file';

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

  return (
    <div className="doctor-container">
      <button className="btn-secondary back-btn doctor-home-btn" onClick={onBack}>← Home</button>
      <h2>Doctor Messaging</h2>
      <div className="doctor-content">
        <div className="patient-list">
          <h3>Patients</h3>
          {patientsWithSummaries.length > 0 && (
            <div className="patient-summary-banner">
              <strong>Summary PDFs Ready:</strong>{' '}
              <span className="summary-ready-list">
                {patientsWithSummaries.map((patient, index) => (
                  <React.Fragment key={`patient-${patient.id}`}>
                    <button
                      type="button"
                      className={[
                        'summary-ready-link',
                        patientUnreadMeta[String(patient.id)]?.hasUnread ? 'doctor-new-msg-item' : '',
                      ].filter(Boolean).join(' ')}
                      onClick={() => loadMessages(patient)}
                      aria-label={`Open summary for ${getPatientDisplayName(patient)}`}
                    >
                      {getPatientDisplayName(patient)}
                      <span className="summary-meta"> • Queue {patient.queue_number || 'N/A'}</span>
                      <span className="summary-meta"> • {getDiagnosisRoundLabel(patient)}</span>
                      {patientUnreadMeta[String(patient.id)]?.hasUnread && (
                        <span className="patient-message-badge inline-badge"> New Msg </span>
                      )}
                    </button>
                    {index < patientsWithSummaries.length - 1 ? <span>, </span> : null}
                  </React.Fragment>
                ))}
              </span>
            </div>
          )}
          {patients.length === 0 ? (
            <p>No patients found.</p>
          ) : (
            <ul className="doctor-patient-list">
              {patients.map(p => (
                <li
                  key={`patient-${p.id}`}
                  className={[
                    selectedPatient?.id === p.id ? 'selected' : '',
                    patientUnreadMeta[String(p.id)]?.hasUnread ? 'doctor-new-msg-item' : '',
                  ].filter(Boolean).join(' ')}
                >
                  <button
                    type="button"
                    className="patient-list-item-btn"
                    onClick={() => loadMessages(p)}
                    aria-current={selectedPatient?.id === p.id ? 'true' : undefined}
                    aria-label={`Open conversation with ${getPatientDisplayName(p)} queue ${p.queue_number || 'N/A'}`}
                  >
                    <span className="patient-row-label">{getPatientDisplayName(p)}</span>
                    <span className="patient-list-meta">Queue {p.queue_number || 'N/A'} • Diagnosis {getDiagnosisRoundLabel(p)}</span>
                    <div className="patient-list-badges">
                      {patientUnreadMeta[String(p.id)]?.hasUnread && (
                        <span className="patient-message-badge">
                          New Msg
                        </span>
                      )}
                      {p.hasSummaryReady && <span className="patient-summary-badge">Summary Ready</span>}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {selectedPatient && (
          <div className="chat-panel">
            {clueSummaryView ? (
              <div className="clue-summary-view">
                <div className="clue-summary-view-header">
                  <button type="button" className="btn-secondary" onClick={() => setClueSummaryView(null)}>
                    Back
                  </button>
                  <h3>Clue Summary</h3>
                </div>
                <p className="clue-summary-view-meta">
                  Queue {clueSummaryView.queue} • {clueSummaryView.patientName}
                </p>
                <div className="clue-summary-view-body">
                  {clueSummaryView.summaryText}
                </div>
                {clueSummaryView.summaryPdfUrl && (
                  <a
                    href={clueSummaryView.summaryPdfUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="summary-open-link"
                  >
                    Open Summary PDF
                  </a>
                )}
              </div>
            ) : (
              <>
                <div className="conversation-header">
                  <div className="conversation-header-main">
                    <h3>Conversation with {getPatientDisplayName(selectedPatient)}</h3>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginTop: 8 }}>
                      {/* area_of_concern displayed below as Topic badge */}
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <span style={{ color: '#888', fontSize: 13 }}>
                          Queue {selectedPatient.queue_number || 'N/A'}
                        </span>
                        {selectedPatient.area_of_concern && (
                          <span className="topic-badge" style={{ marginTop: 8 }}>
                            <span className="topic-dot" aria-hidden="true" />
                            {String(selectedPatient.area_of_concern).charAt(0).toUpperCase() + String(selectedPatient.area_of_concern).slice(1).toLowerCase()}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="conversation-header-actions">
                    <button type="button" className="btn-primary clue-summary-btn" onClick={redirectToClueSummary}>
                      Clue Summary
                    </button>
                    <button type="button" className="btn-secondary" onClick={startNewConversationForPatient}>
                      Start New Conversation
                    </button>
                  </div>
                </div>
                {/* single Topic badge shown in header only */}
                <div className="message-history conversation-history" style={{
                  height: '420px',
                  overflowY: 'auto',
                  background: '#f9fcff',
                  border: '1px solid #b3e0ff',
                  borderRadius: '12px',
                  marginBottom: '16px',
                  position: 'relative',
                }}>
                  {/* no duplicate area badge here; header shows Topic */}
                  {messages.length === 0 && (
                    <div className="conversation-empty">No conversation started yet.</div>
                  )}
                  {messages.map((m, index) => {
                    const senderType = getSenderType(m);
                    const messageKey = m.id ? `msg-${m.id}-${senderType || 'unknown'}` : `${m.timestamp || 'msg'}-${index}-${senderType || 'unknown'}`;
                    return (
                    <div key={messageKey} className={`conversation-item ${senderType}`}>
                      <div className="conversation-meta-row">
                        <span className={`conversation-sender-chip ${senderType}`}>
                          {senderType === 'doctor' ? 'Doctor' : 'Patient'}
                        </span>
                        <span className="conversation-time">{formatTime(m.timestamp)}</span>
                      </div>
                      <div className={`conversation-bubble ${senderType}`}>
                        {m.source === 'scan_attachment' ? renderAttachmentBubble(m) : m.text}
                      </div>
                    </div>
                    );
                  })}
                </div>
                <div className="message-input">
                  <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="Type a message..."
                  />
                  <button onClick={sendMessage} className="btn-primary">Send</button>
                </div>

                <div className="patient-file-upload">
                  <label htmlFor="doctor-scan-upload">��� Upload Files for Patient (JPG, JPEG, PNG, GIF, WEBP, HEIC, HEIF, PDF, DOC, DOCX, TXT)</label>
                  <input
                    id="doctor-scan-upload"
                    type="file"
                    multiple
                      accept="image/*,.jpg,.jpeg,.png,.heic,.heif,.pdf,.doc,.docx,.txt"
                    onChange={handleDoctorFileChange}
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
                    onClick={handleDoctorFileUpload}
                    disabled={selectedFiles.length === 0}
                  >
                    Share Files with Patient
                  </button>
                  {uploadStatus && (
                    <p className={`patient-response-status ${uploadStatus.includes('Error') ? 'error' : 'success'}`}>
                      {uploadStatus}
                    </p>
                  )}
                </div>

                <div className="patient-replies-list">
                  <h3>Patient Answers</h3>
                  {patientAnswers.length === 0 ? (
                    <p>No patient answers yet.</p>
                  ) : (
                    patientAnswers.map(answer => (
                      <div key={`answer-${answer.id}-${answer.question_id || 'na'}`} className="message patient">
                        <span className="sender">Patient</span>: {answer.text}
                      </div>
                    ))
                  )}
                </div>

                <div className="patient-replies-list">
                  <h3>Summary PDFs from System Admin</h3>
                  {summaryPdfs.length === 0 ? (
                    <p>No summary PDFs sent yet.</p>
                  ) : (
                    <table className="summary-table">
                      <thead>
                        <tr>
                          <th>ID</th>
                          <th>Generated At</th>
                          <th>PDF</th>
                        </tr>
                      </thead>
                      <tbody>
                        {summaryPdfs.map(report => (
                          <tr key={`report-${report.id}`}>
                            <td>{report.id}</td>
                            <td>{report.created_at ? new Date(report.created_at).toLocaleString() : 'N/A'}</td>
                            <td>
                              <a
                                href={buildPdfUrl(report.summary_pdf, report.created_at)}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={() => markSummaryAsRead(selectedPatient?.id, report.created_at || report.timestamp)}
                              >
                                Open Summary PDF
                              </a>
                              {' | '}
                              <a
                                href={buildPdfUrl(report.summary_pdf, report.created_at)}
                                download
                                onClick={() => markSummaryAsRead(selectedPatient?.id, report.created_at || report.timestamp)}
                              >
                                Download
                              </a>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, info: null };
  }

  static getDerivedStateFromError(err) {
    return { hasError: true, error: err };
  }

  componentDidCatch(error, info) {
    this.setState({ error, info });
    // Also log to console for developer
    console.error('DoctorChat caught error:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 20 }}>
          <h2>Something went wrong in DoctorChat</h2>
          <pre style={{ whiteSpace: 'pre-wrap' }}>{String(this.state.error && this.state.error.toString())}</pre>
          {this.state.info && <details style={{ whiteSpace: 'pre-wrap' }}>{this.state.info.componentStack}</details>}
          <div style={{ marginTop: 10 }}>
            <button onClick={() => window.location.reload()}>Reload</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const WrappedDoctorChat = (props) => (
  <ErrorBoundary>
    <DoctorChat {...props} />
  </ErrorBoundary>
);

export default WrappedDoctorChat;
