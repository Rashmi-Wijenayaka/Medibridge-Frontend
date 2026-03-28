import React, { useEffect, useState } from 'react';
import './AdminDoctor.css';
import { apiUrl } from '../api';

const PatientDiagnosis = ({ patientData }) => {
  const [latestDiagnosis, setLatestDiagnosis] = useState(null);
  const [patientProfile, setPatientProfile] = useState(null);
  const [error, setError] = useState('');

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

  useEffect(() => {
    if (!activePatientId) return;

    Promise.all([
      fetch(apiUrl(`/api/diagnoses/?patient=${activePatientId}`)),
      fetch(apiUrl(`/api/patients/${activePatientId}/`)),
    ])
      .then(async ([diagnosisRes, patientRes]) => {
        const data = await diagnosisRes.json();
        const patient = patientRes.ok ? await patientRes.json() : null;
        setPatientProfile(patient);

        const list = data || [];
        if (list.length === 0) {
          setLatestDiagnosis(null);
          return;
        }

        const latest = [...list].sort((a, b) => {
          const ta = new Date(a.created_at || a.timestamp || 0).getTime();
          const tb = new Date(b.created_at || b.timestamp || 0).getTime();
          return tb - ta;
        })[0];

        setLatestDiagnosis(latest);

        const seenKey = `patientSeenAdminDiagnosisTimestamp_${activePatientId}`;
        const seenValue = latest?.created_at || latest?.timestamp || new Date().toISOString();
        localStorage.setItem(seenKey, seenValue);
      })
      .catch((err) => {
        console.error('Error loading diagnosis', err);
        setError(err.message);
      });
  }, [activePatientId]);

  return (
    <div className="doctor-container">
      <div className="page-header patient-messages-header">
        <h2>Your Diagnosis Update</h2>
        <p className="patient-list-meta">
          {(Number(patientProfile?.visit_count || patientData?.visitCount || 1) > 1)
            ? `Returning Patient (Visit #${Number(patientProfile?.visit_count || patientData?.visitCount || 1)})`
            : 'First Visit'}
        </p>
      </div>

      {!isPatientInfoComplete && (
        <div className="alert alert-warning">
          <strong>⚠️ Patient Information Required:</strong> You must complete your patient information form before accessing the diagnosis. Please navigate to the "Diagnosis Form" section and submit your information.
        </div>
      )}

      <div className="patient-replies-list">
        {error && <p className="login-error">{error}</p>}
        {!latestDiagnosis ? (
          <p>No diagnosis conclusion from system admin yet.</p>
        ) : (
          <div className="message patient">
            <p><strong>Admin Conclusion:</strong> {latestDiagnosis.admin_notes}</p>
            <p><small>{new Date(latestDiagnosis.created_at).toLocaleString()}</small></p>
          </div>
        )}
      </div>
    </div>
  );
};

export default PatientDiagnosis;