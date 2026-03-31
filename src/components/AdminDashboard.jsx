import React, { useCallback, useEffect, useMemo, useState } from 'react';
import './AdminDoctor.css';
import { apiUrl, assetUrl } from '../api';




// simple admin dashboard that lists patients and allows concluding diagnosis
const AdminDashboard = ({ onBack }) => {
  const [patients, setPatients] = useState([]);
  const [patientsWithDiagnosisRecords, setPatientsWithDiagnosisRecords] = useState(new Set());
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [diagnosis, setDiagnosis] = useState('');
  const [diagnosisDraftMeta, setDiagnosisDraftMeta] = useState('');
  const [patientScans, setPatientScans] = useState([]);
  const [patientQA, setPatientQA] = useState([]);
  const [summaryStatus, setSummaryStatus] = useState('');
  const [latestSummaryDiagnosisId, setLatestSummaryDiagnosisId] = useState(null);
  const [summaryReports, setSummaryReports] = useState([]);
  const [diagnosisAssistStatus, setDiagnosisAssistStatus] = useState('');
  const [aiDiagnosisStatus, setAiDiagnosisStatus] = useState('');
  const [aiPrimaryClue, setAiPrimaryClue] = useState('');
  const [aiSecondaryClue, setAiSecondaryClue] = useState('');
  const [aiScanSummary, setAiScanSummary] = useState(null);
  const [aiPatientSuggestion, setAiPatientSuggestion] = useState('');
  const [aiWhyThisClue, setAiWhyThisClue] = useState([]);
  const [patientSearch, setPatientSearch] = useState('');
  const [selectedAreaFilter, setSelectedAreaFilter] = useState('all');
  const [isLoadingPatients, setIsLoadingPatients] = useState(false);
  const [isSubmittingDiagnosis, setIsSubmittingDiagnosis] = useState(false);
  const [diagnosisClueClicked, setDiagnosisClueClicked] = useState(false);
  const [suggestedDiagnosisClicked, setSuggestedDiagnosisClicked] = useState(false);
  const [submitDiagnosisClicked, setSubmitDiagnosisClicked] = useState(false);
  const [missingScanIds, setMissingScanIds] = useState(() => new Set());


  // Track which patients have been clicked (persisted in localStorage) to hide the badge for them
  const CLICKED_PATIENTS_KEY = 'adminDashboardClickedPatients';
  const [clickedPatients, setClickedPatients] = useState(() => {
    const stored = localStorage.getItem(CLICKED_PATIENTS_KEY);
    if (stored) {
      try {
        return new Set(JSON.parse(stored));
      } catch {
        return new Set();
      }
    }
    return new Set();
  });

  // Persist clickedPatients to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem(CLICKED_PATIENTS_KEY, JSON.stringify(Array.from(clickedPatients)));
  }, [clickedPatients]);

  const buildPatientDisplayKey = useCallback((patient) => {
    // Key patients primarily by normalized name so different records for
    // the same person (one with queue and one without) collapse into a
    // single display item. If name is missing, fall back to id.
    const name = (
      (patient?.full_name && patient.full_name.toString()) ||
      (patient?.fullName && patient.fullName.toString()) ||
      ''
    ).trim().toLowerCase();
    if (name) return name;
    return patient?.id ? `id:${patient.id}` : `unknown:${(patient?.queue_number || patient?.queueNumber || '').toString().trim()}`;
  }, []);

  const dedupePatientsByDisplay = useCallback((items) => {
    const byDisplayKey = new Map();

    (items || []).forEach((patient) => {
      const key = buildPatientDisplayKey(patient);
      const existing = byDisplayKey.get(key);
      const hasValidQueue = !!(patient.queue_number || patient.queueNumber);
      const existingHasValidQueue = !!(existing?.queue_number || existing?.queueNumber);

      if (!existing) {
        byDisplayKey.set(key, patient);
        return;
      }

      // Always prefer a patient with a valid queue number over one with N/A
      if (hasValidQueue && !existingHasValidQueue) {
        byDisplayKey.set(key, patient);
        return;
      }
      if (!hasValidQueue && existingHasValidQueue) {
        // keep existing
        return;
      }

      // Prefer records that still need admin action, then newer id.
      if (patient.needsAdminAttention && !existing.needsAdminAttention) {
        byDisplayKey.set(key, patient);
        return;
      }
      if (patient.needsAdminAttention === existing.needsAdminAttention && (patient.id || 0) > (existing.id || 0)) {
        byDisplayKey.set(key, patient);
      }
    });

    return Array.from(byDisplayKey.values());
  }, [buildPatientDisplayKey]);

  const draftStorageKey = selectedPatient?.id ? `adminDiagnosisDraft:${selectedPatient.id}` : null;

  const areaFilters = useMemo(() => {
    const uniqueAreas = Array.from(new Set((patients || []).map(item => item.area_of_concern).filter(Boolean)));
    return uniqueAreas.sort((a, b) => a.localeCompare(b));
  }, [patients]);

  const filteredPatients = useMemo(() => {
    const search = patientSearch.trim().toLowerCase();
    return (patients || [])
      .filter((patient) => {
        // Include patients even if queue number is missing (show as N/A)
        const queueVal = ((patient.queue_number || patient.queueNumber) || '').toString().trim();
        const matchesArea = selectedAreaFilter === 'all' || patient.area_of_concern === selectedAreaFilter;
        const matchesSearch =
          !search ||
          (patient.full_name || '').toLowerCase().includes(search) ||
          queueVal.toLowerCase().includes(search) ||
          String(patient.id || '').includes(search);
        return matchesArea && matchesSearch;
      });
  }, [patients, patientSearch, selectedAreaFilter]);

  const conclusionNeededPatients = useMemo(() => {
    return (patients || []).filter(patient => patient.needsAdminAttention);
  }, [patients]);

  const getVisitLabel = (patient) => {
    const visitCount = Number(patient?.visit_display || patient?.visit_count || 1);
    return visitCount > 1 ? `Returning Patient (Visit #${visitCount})` : 'First Visit';
  };

  const buildPdfUrl = (pdfPath, createdAt) => {
    if (!pdfPath) return '#';
    const base = assetUrl(pdfPath);
    const stamp = createdAt ? new Date(createdAt).getTime() : Date.now();
    return `${base}?v=${stamp}`;
  };

  const isPdfFile = (fileUrl = '') => /\.pdf(\?|$)/i.test(fileUrl);
  const isImageFile = (fileUrl = '') => /\.(jpe?g|png|gif|webp|bmp|heic|heif)(\?|$)/i.test(fileUrl);
  const getFileExtension = (fileUrl = '') => {
    const clean = fileUrl.split('?')[0];
    const idx = clean.lastIndexOf('.');
    return idx >= 0 ? clean.slice(idx + 1).toUpperCase() : 'FILE';
  };

  useEffect(() => {
    // Reset missing-file markers when scan list changes (e.g. after re-upload).
    setMissingScanIds(new Set());
  }, [selectedPatient?.id, patientScans]);

  const markScanMissing = (scanId) => {
    setMissingScanIds(prev => {
      if (prev.has(scanId)) return prev;
      const next = new Set(prev);
      next.add(scanId);
      return next;
    });
  };

  const evaluateAdminWorkflowStatus = (latestDiag, diagnosisCount, expectedVisitCount) => {
    // If patient has started a newer visit without a matching diagnosis record yet,
    // keep them highlighted for admin action.
    if ((diagnosisCount || 0) < (expectedVisitCount || 1)) {
      return {
        needsAttention: true,
        label: 'Diagnosis Needed',
        statusKind: 'diagnosis-needed'
      };
    }

    if (!latestDiag) {
      return {
        needsAttention: true,
        label: 'Diagnosis Needed',
        statusKind: 'diagnosis-needed'
      };
    }

    if (!latestDiag.summary_pdf) {
      return {
        needsAttention: true,
        label: 'Summary PDF Needed',
        statusKind: 'summary-needed'
      };
    }

    if (!latestDiag.sent_to_doctor) {
      return {
        needsAttention: true,
        label: 'Send PDF to Doctor',
        statusKind: 'send-needed'
      };
    }

    return {
      needsAttention: false,
      label: 'Completed',
      statusKind: 'completed'
    };
  };

  const getPatientActionStatus = (patient, diagnosisRecords, messageRecords) => {
    // Select diagnosis records for this patient.
    const patientDiagnoses = (diagnosisRecords || [])
      .filter(item => item.patient === patient.id)
      .slice();

    const diagnosisCount = patientDiagnoses.length || 0;
    const latestDiag = patientDiagnoses.reduce((latest, current) => {
      if (!latest) return current;
      const currentTs = new Date(current.created_at || current.createdAt || 0).getTime() || 0;
      const latestTs = new Date(latest.created_at || latest.createdAt || 0).getTime() || 0;
      if (currentTs > latestTs) return current;
      if (currentTs < latestTs) return latest;
      const currentId = Number(current.id || 0);
      const latestId = Number(latest.id || 0);
      return currentId > latestId ? current : latest;
    }, null);

    // Keep parameter for compatibility with existing call sites.
    void messageRecords;

    const expectedVisitCount = Math.max(Number(patient?.visit_count || 0), 1);

    const {
      needsAttention,
      label,
      statusKind
    } = evaluateAdminWorkflowStatus(latestDiag, diagnosisCount, expectedVisitCount);

    // Derive a display visit count from diagnoses if available, otherwise fall back to stored value
    const visit_display = Math.max(Number(patient?.visit_count || 0), diagnosisCount || 0) || 1;

    return {
      needsAttention,
      label,
      statusKind,
      visit_display,
      diagnosisCount,
      latestDiag
    };
  };

  const loadPatients = useCallback(() => {
    const token = localStorage.getItem('token');
    setIsLoadingPatients(true);
    
    // Build request headers - only include Authorization if token exists
    const headers = token ? { 'Authorization': `Token ${token}` } : {};
    
    Promise.all([
      fetch(apiUrl('/api/patients/'), {
        headers: headers
      }),
      fetch(apiUrl('/api/diagnoses/'), {
        headers: headers
      }),
      fetch(apiUrl('/api/messages/'), {
        headers: headers
      })
    ])
      .then(async ([patientsRes, diagnosesRes, messagesRes]) => {
        const [patientData, diagnosisData, messagesData] = await Promise.all([
          patientsRes.json(),
          diagnosesRes.json(),
          messagesRes.json()
        ]);

        // Only consider patients who have at least one diagnosis record
        const diagnosisPatientIds = new Set(
          (diagnosisData || [])
            .filter(item => item.patient)
            .map(item => item.patient)
        );
        setPatientsWithDiagnosisRecords(diagnosisPatientIds);

        const normalizedPatients = (patientData || [])
          .map(patient => {
            const actionStatus = getPatientActionStatus(patient, diagnosisData || [], messagesData || []);
            const userMsgs = (messagesData || []).filter(
              m => m.patient === patient.id && (m.sender === 'user' || m.sender === 'patient') && m.timestamp
            );
            const lastAnsweredAt = userMsgs.length > 0
              ? new Date(Math.max(...userMsgs.map(m => new Date(m.timestamp).getTime()))).toLocaleString()
              : null;
            return {
              ...patient,
              needsAdminAttention: actionStatus.needsAttention,
              adminAttentionLabel: actionStatus.label,
              patientStatusKind: actionStatus.statusKind,
              patientStatusLabel: actionStatus.label,
              hasQuickCompleteSymbol:
                !actionStatus.needsAttention &&
                Boolean(actionStatus.latestDiag?.summary_pdf) &&
                Boolean(actionStatus.latestDiag?.sent_to_doctor),
              visit_display: actionStatus.visit_display,
              lastAnsweredAt,
            };
          });
        const dedupedPatients = dedupePatientsByDisplay(normalizedPatients);

        dedupedPatients.sort((left, right) => {
          if (left.needsAdminAttention === right.needsAdminAttention) {
            return (right.id || 0) - (left.id || 0);
          }
          return left.needsAdminAttention ? -1 : 1;
        });

        setPatients(dedupedPatients);
      })
      .catch(err => console.error('Error loading patients', err))
      .finally(() => setIsLoadingPatients(false));
  }, [dedupePatientsByDisplay]);

  useEffect(() => {
    loadPatients();
  }, [loadPatients]);

  // Periodically refresh the patient list so admin sees live updates
  // (new Q/A completions, summary availability, etc.). Interval set to 15s.
  useEffect(() => {
    const intervalMs = 15000; // 15 seconds
    const id = setInterval(() => {
      loadPatients();
    }, intervalMs);
    return () => clearInterval(id);
  }, [loadPatients]);

  useEffect(() => {
    if (!draftStorageKey) return;
    if (!diagnosis.trim()) return;
    const payload = {
      diagnosis,
      updatedAt: new Date().toISOString(),
    };
    localStorage.setItem(draftStorageKey, JSON.stringify(payload));
  }, [diagnosis, draftStorageKey]);

  const handleSelect = (patient) => {
    setSelectedPatient(patient);
    setDiagnosisDraftMeta('');
    const draftKey = `adminDiagnosisDraft:${patient.id}`;
    const savedDraftRaw = localStorage.getItem(draftKey);
    if (savedDraftRaw) {
      try {
        const savedDraft = JSON.parse(savedDraftRaw);
        setDiagnosis(savedDraft?.diagnosis || '');
        if (savedDraft?.updatedAt) {
          setDiagnosisDraftMeta(`Loaded saved draft from ${new Date(savedDraft.updatedAt).toLocaleString()}`);
        }
      } catch {
        setDiagnosis('');
      }
    } else {
      setDiagnosis('');
    }
    setSummaryStatus('');
    setDiagnosisAssistStatus('');
    setAiDiagnosisStatus('');
    setAiPrimaryClue('');
    setAiSecondaryClue('');
    setAiScanSummary(null);
    setAiPatientSuggestion('');
    setAiWhyThisClue([]);
    setLatestSummaryDiagnosisId(null);
    const token = localStorage.getItem('token');
    const headers = token ? { 'Authorization': `Token ${token}` } : {};
    
    // load scans for this patient
    fetch(apiUrl(`/api/scans/?patient=${patient.id}`), {
      headers: headers
    })
      .then(res => res.json())
      .then(data => setPatientScans(data))
      .catch(err => console.error('Failed to load scans', err));

    fetch(apiUrl(`/api/patient-qa/${patient.id}/`), {
      headers: headers
    })
      .then(res => res.json())
      .then(data => setPatientQA(data?.qa_pairs || []))
      .catch(err => console.error('Failed to load patient Q/A', err));

    fetch(apiUrl(`/api/diagnoses/?patient=${patient.id}`), {
      headers: headers
    })
      .then(res => res.json())
      .then(data => {
        const reports = (data || []).filter(item => item.summary_pdf);
        setSummaryReports(reports);
      })
      .catch(err => console.error('Failed to load summary reports', err));

    // Refresh patient list so the left-hand notifications reflect any
    // newly-received messages or completion events for this patient.
    // This keeps the 'Conclusion Needed' badge in sync after viewing.
    loadPatients();
  };

  const generateSummaryPdf = async () => {
    if (!selectedPatient) return;
    const token = localStorage.getItem('token');
    const headers = token ? { 'Authorization': `Token ${token}` } : {};
    setSummaryStatus('Generating summary PDF...');

    try {
      const res = await fetch(apiUrl(`/api/generate-summary-pdf/${selectedPatient.id}/`), {
        method: 'POST',
        headers: headers
      });
      let data;
      const ct = res.headers.get('content-type') || '';
      if (ct.includes('application/json')) {
        data = await res.json();
      } else {
        const text = await res.text();
        throw new Error(`Server error: ${res.status}. ${text.slice(0, 200)}`);
      }
      if (!res.ok) {
        throw new Error((data && data.error) || 'Failed to generate summary PDF');
      }
      setLatestSummaryDiagnosisId(data.diagnosis_id);
      setSummaryStatus('Summary PDF generated successfully.');

      // Refresh report list so newly generated file appears immediately.
      const reportRes = await fetch(apiUrl(`/api/diagnoses/?patient=${selectedPatient.id}`), {
        headers: headers
      });
      const reportData = await reportRes.json();
      setSummaryReports((reportData || []).filter(item => item.summary_pdf));
      loadPatients();
    } catch (err) {
      setSummaryStatus(`Error: ${err.message}`);
    }
  };

  const sendSummaryToDoctor = async () => {
    if (!latestSummaryDiagnosisId) {
      setSummaryStatus('Generate the summary PDF first.');
      return;
    }
    const token = localStorage.getItem('token');
    const headers = token ? { 'Authorization': `Token ${token}` } : {};
    setSummaryStatus('Sending summary PDF to doctor section...');

    try {
      const res = await fetch(apiUrl(`/api/send-summary-to-doctor/${latestSummaryDiagnosisId}/`), {
        method: 'POST',
        headers: headers
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to send summary PDF');
      }
      setSummaryStatus('Summary PDF sent to doctor section.');

      // Update report statuses after sending.
      const reportRes = await fetch(apiUrl(`/api/diagnoses/?patient=${selectedPatient.id}`), {
        headers: headers
      });
      const reportData = await reportRes.json();
      setSummaryReports((reportData || []).filter(item => item.summary_pdf));
    } catch (err) {
      setSummaryStatus(`Error: ${err.message}`);
    }
  };

  const submitDiagnosis = async () => {
    setSubmitDiagnosisClicked(true);
    if (!diagnosis.trim() || !selectedPatient) return;
    const token = localStorage.getItem('token');
    const headers = token ? { 'Authorization': `Token ${token}` } : {};
    setIsSubmittingDiagnosis(true);
    // send diagnosis record to backend
    const payload = {
      patient: selectedPatient.id,
      admin_notes: diagnosis
    };
    try {
      const saveRes = await fetch(apiUrl('/api/diagnoses/'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...headers
        },
        body: JSON.stringify(payload)
      });

      const saveData = await saveRes.json().catch(() => ({}));
      if (!saveRes.ok) {
        throw new Error(saveData.error || 'Failed to save diagnosis');
      }
      console.log('Diagnosis saved', saveData);

      const pdfRes = await fetch(apiUrl(`/api/generate-pdf/${saveData.id}/`), {
        method: 'POST',
        headers: headers
      });
      if (!pdfRes.ok) {
        const pdfErr = await pdfRes.json().catch(() => ({}));
        throw new Error(pdfErr.error || 'Diagnosis saved, but PDF generation failed');
      }

      const emailRes = await fetch(apiUrl(`/api/send-email/${saveData.id}/`), {
        method: 'POST',
        headers: headers
      });
      if (!emailRes.ok) {
        const emailErr = await emailRes.json().catch(() => ({}));
        throw new Error(emailErr.error || 'Diagnosis saved, but email sending failed');
      }

      alert('Diagnosis saved, PDF generated, and email notification sent to patient.');

      if (draftStorageKey) {
        localStorage.removeItem(draftStorageKey);
      }
      setDiagnosisDraftMeta('');
      setDiagnosis('');
      setAiPrimaryClue('');
      setAiSecondaryClue('');
      setAiScanSummary(null);
      setAiPatientSuggestion('');
      setAiWhyThisClue([]);
      // Refresh immediately so this patient drops from the "Conclusion Needed" list
      // until new questionnaire answers are submitted.
      loadPatients();
    } catch (err) {
      console.error(err);
      alert(err.message || 'Error saving diagnosis');
    } finally {
      setIsSubmittingDiagnosis(false);
    }
  };

  const copyDiagnosis = async () => {
    if (!diagnosis.trim()) return;
    try {
      await navigator.clipboard.writeText(diagnosis);
      setDiagnosisAssistStatus('Diagnosis text copied to clipboard.');
    } catch (err) {
      console.error('Clipboard copy failed', err);
      setDiagnosisAssistStatus('Could not copy diagnosis text.');
    }
  };

  const clearDraft = () => {
    setDiagnosis('');
    setAiPrimaryClue('');
    setAiSecondaryClue('');
    setAiScanSummary(null);
    setAiPatientSuggestion('');
    setAiWhyThisClue([]);
    if (draftStorageKey) {
      localStorage.removeItem(draftStorageKey);
    }
    setDiagnosisDraftMeta('Draft cleared.');
  };

  const getAIDiagnosis = async () => {
    setSuggestedDiagnosisClicked(true);
    if (!selectedPatient) {
      setAiDiagnosisStatus('Select a patient first.');
      return;
    }
    const token = localStorage.getItem('token');
    const headers = token ? { 'Authorization': `Token ${token}` } : {};
    setAiDiagnosisStatus('Preparing suggested diagnosis...');
    try {
      const res = await fetch(
        apiUrl(`/api/lgbm-diagnose/${selectedPatient.id}/`),
        { headers: headers }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Automated analysis failed');
      setDiagnosis(data.diagnosis_text || '');
      setAiPrimaryClue(data.primary_clue || data.top_conditions?.[0]?.condition || '');
      setAiSecondaryClue(data.secondary_clue || data.top_conditions?.[1]?.condition || '');
      setAiScanSummary(data.scan_summary || null);
      setAiPatientSuggestion(data.patient_suggestion || '');
      setAiWhyThisClue(Array.isArray(data.why_this_clue) ? data.why_this_clue : []);
      setAiDiagnosisStatus('');
    } catch (err) {
      setAiDiagnosisStatus(`Error: ${err.message}`);
    }
  };

  const generateDiagnosisDraftFromQA = () => {
    setDiagnosisClueClicked(true);
    setDiagnosisAssistStatus('');
    getAIDiagnosis();
  };

  return (
    <div className="admin-container">
      <button className="btn-secondary back-btn admin-home-btn" onClick={onBack}>← Home</button>
      <h2>Administrator Dashboard</h2>
      <div className="admin-content">
        <div className="patient-list">
          <h3>Patients</h3>
          {patients.some(patient => patient.needsAdminAttention) && (
            <p className="patient-list-new-meta">
              Highlighted patients still need admin conclusion, summary PDF generation, or doctor delivery.
            </p>
          )}
          <div className="patient-list-controls">
            <input
              type="text"
              className="patient-search-input"
              value={patientSearch}
              onChange={(e) => setPatientSearch(e.target.value)}
              placeholder="Search by name or queue"
            />
            <select
              className="patient-filter-select"
              value={selectedAreaFilter}
              onChange={(e) => setSelectedAreaFilter(e.target.value)}
            >
              <option value="all">All areas</option>
              {areaFilters.map(area => (
                <option key={`area-${area}`} value={area}>{area}</option>
              ))}
            </select>
            <button className="btn-secondary" onClick={loadPatients} disabled={isLoadingPatients}>
              {isLoadingPatients ? 'Refreshing...' : 'Refresh List'}
            </button>
            <p className="patient-list-meta">Showing {filteredPatients.length} of {patients.length} patients</p>
          </div>
          {filteredPatients.length === 0 ? (
            <p>No patients yet.</p>
          ) : (
            <ul>
              {filteredPatients.map(p => {
                // Hide badge for this patient if they have been clicked in this session or if they have no diagnosis activity
                const hasBadge = p.needsAdminAttention && p.patientStatusKind === 'diagnosis-needed' && !clickedPatients.has(p.id) && patientsWithDiagnosisRecords.has(p.id);
                return (
                  <li
                    key={`patient-${p.id}`}
                    className={`${selectedPatient?.id === p.id ? 'selected' : ''} ${p.needsAdminAttention ? 'new-patient-item' : ''} ${p.patientStatusKind === 'completed' ? 'completed-patient-item' : ''}`.trim()}
                  >
                    <button
                      type="button"
                      className="patient-select-btn"
                      onClick={() => {
                        setClickedPatients(prev => {
                          if (prev.has(p.id)) return prev;
                          const next = new Set(prev);
                          next.add(p.id);
                          return next;
                        });
                        handleSelect(p);
                      }}
                      aria-current={selectedPatient?.id === p.id ? 'true' : undefined}
                      aria-label={`Open patient details for Queue ${p.queue_number || p.queueNumber || 'N/A'}`}
                    >
                      <span className="patient-row-label">Queue {p.queue_number || p.queueNumber || 'N/A'}</span>
                      {p.lastAnsweredAt && (
                        <span className="patient-list-answered-at">Answered: {p.lastAnsweredAt}</span>
                      )}
                      {hasBadge && (
                        <span className={`new-patient-badge status-${p.patientStatusKind || 'diagnosis-needed'}`}>{p.adminAttentionLabel}</span>
                      )}
                      {p.hasQuickCompleteSymbol && (
                        <span
                          className="patient-status-check"
                          title="Diagnosis submitted and summary sent to doctor"
                          aria-label="Completed"
                        >
                          ✓
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        {selectedPatient && (
          <div className="patient-detail-panel">
            <h3>Patient Details</h3>
              <p><strong>Queue Number:</strong> {selectedPatient.queue_number || selectedPatient.queueNumber || 'N/A'}</p>
            <p><strong>Visit Status:</strong> {getVisitLabel(selectedPatient)}</p>
            <p><strong>Area:</strong> {selectedPatient.area_of_concern}</p>
            <p><strong>Age:</strong> {selectedPatient.age || 'N/A'}</p>
            <p><strong>Answers Submitted:</strong> {(() => {
              const timestamps = patientQA.map(q => q.answered_at).filter(Boolean);
              if (timestamps.length === 0) return 'N/A';
              const latest = new Date(Math.max(...timestamps.map(t => new Date(t).getTime())));
              return latest.toLocaleString();
            })()}</p>

            {diagnosisDraftMeta && <p className="patient-response-status">{diagnosisDraftMeta}</p>}
            <div className="patient-replies-list">
              <h4>Patient Questions and Answers</h4>
              {patientQA.length === 0 ? (
                <p>No patient Q/A found yet.</p>
              ) : (
                <table className="summary-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Question</th>
                      <th>Patient Answer</th>
                    </tr>
                  </thead>
                  <tbody>
                    {patientQA.map(item => (
                      <tr key={`patientQA-${item.index}-${item.question || 'q'}`}>
                        <td>{item.index}</td>
                        <td>{item.question}</td>
                        <td>{item.answer || 'Not answered yet'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="summary-actions">
              <button className="btn-primary" onClick={generateSummaryPdf}>
                Generate Summary PDF
              </button>
              <button className="btn-secondary" onClick={sendSummaryToDoctor}>
                Send Summary PDF to Doctor
              </button>
              {summaryStatus && <p className="patient-response-status">{summaryStatus}</p>}
            </div>

            <div className="patient-replies-list">
              <h4>Summary Reports</h4>
              {summaryReports.length === 0 ? (
                <p>No summary reports generated yet.</p>
              ) : (
                <table className="summary-table">
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Created</th>
                      <th>Status</th>
                      <th>PDF</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summaryReports.map(report => (
                      <tr key={`report-${report.id}`}>
                        <td>{report.id}</td>
                        <td>{report.created_at ? new Date(report.created_at).toLocaleString() : 'N/A'}</td>
                        <td>{report.sent_to_doctor ? 'Sent to Doctor' : 'Generated'}</td>
                        <td>
                          <a
                            href={buildPdfUrl(report.summary_pdf, report.created_at)}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            Open PDF
                          </a>
                          {' | '}
                          <a
                            href={buildPdfUrl(report.summary_pdf, report.created_at)}
                            download
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

            {/* more fields as needed */}
            {patientScans.length > 0 && (
              <div className="scan-gallery">
                <h4>Uploaded Scans</h4>
                <div className="scan-thumbnails">
                  {patientScans.map(scan => {
                    const fileUrl = scan.file ? assetUrl(scan.file) : '';
                    const imageFile = isImageFile(scan.file || '');
                    const missingFile = missingScanIds.has(scan.id);

                    return (
                      <div key={`scan-${scan.id}`} className="scan-thumb">
                        {!scan.file ? (
                          <div className="scan-missing" title="Scan file is missing">Missing file</div>
                        ) : missingFile ? (
                          <div className="scan-missing" title="File not found. Please re-upload this scan.">Missing file</div>
                        ) : imageFile ? (
                          <img
                            src={fileUrl}
                            alt="scan"
                            onError={() => markScanMissing(scan.id)}
                          />
                        ) : (
                          <a href={fileUrl} target="_blank" rel="noopener noreferrer">
                            {isPdfFile(scan.file) ? (
                              <div className="pdf-icon">📄</div>
                            ) : (
                              <div className="pdf-icon">{getFileExtension(scan.file)}</div>
                            )}
                          </a>
                        )}
                      </div>
                    );
                  })}
                </div>
                {missingScanIds.size > 0 && (
                  <p className="scan-missing-hint">Some scans are unavailable on the server. Please re-upload those files.</p>
                )}
              </div>
            )}
            <div className="diagnosis-section">
              <h4>Conclude Diagnosis</h4>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '8px' }}>
                <button className={`nav-btn-style ${suggestedDiagnosisClicked ? 'btn-clicked-blue' : ''}`} onClick={getAIDiagnosis}>
                  Suggested Diagnosis
                </button>
              </div>
              {diagnosisAssistStatus && <p className="patient-response-status">{diagnosisAssistStatus}</p>}
              {aiDiagnosisStatus && <p className="patient-response-status">{aiDiagnosisStatus}</p>}
              {(aiPrimaryClue || aiSecondaryClue || aiScanSummary || aiPatientSuggestion || aiWhyThisClue.length > 0) && (
                <div className="ai-clue-box">
                  <h5>Clue Summary</h5>
                  {aiPatientSuggestion && (
                    <p><strong>Patient suggestion:</strong> {aiPatientSuggestion}</p>
                  )}
                  {aiWhyThisClue.length > 0 && (
                    <p><strong>Why this clue:</strong> {aiWhyThisClue.join(', ')}</p>
                  )}
                  {aiPrimaryClue && (
                    <p>
                      <strong>Primary clue:</strong>{' '}
                      {aiPrimaryClue}
                    </p>
                  )}
                  {aiSecondaryClue && (
                    <p><strong>Secondary clue:</strong> {aiSecondaryClue}</p>
                  )}
                </div>
              )}
              {(() => {
                const hasClue = aiPrimaryClue || aiSecondaryClue || aiScanSummary || aiPatientSuggestion || aiWhyThisClue.length > 0;
                return (
                  <div className="diagnosis-action-row">
                    <button className="btn-secondary" onClick={copyDiagnosis} disabled={!hasClue}>
                      Copy Text
                    </button>
                    <button className="btn-secondary" onClick={hasClue ? clearDraft : generateDiagnosisDraftFromQA}>
                      {hasClue ? 'Hide Clue' : 'Show Clue'}
                      </button>
                  </div>
                );
              })()}
              <button className={`btn-primary ${submitDiagnosisClicked ? 'btn-clicked-blue' : ''}`} onClick={submitDiagnosis} disabled={isSubmittingDiagnosis || !diagnosis.trim()}>
                {isSubmittingDiagnosis ? 'Submitting...' : 'Submit Diagnosis'}
              </button>
              <p className="patient-list-meta">Character count: {diagnosis.length}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};


export default AdminDashboard;