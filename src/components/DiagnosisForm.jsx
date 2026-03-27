import React, { useState, useEffect, useMemo } from 'react';
import './DiagnosisForm.css';

const DiagnosisForm = ({ onStart, onPatientInfoSubmit, patientData }) => {
  const [formData, setFormData] = useState({
    fullName: '', email: '', age: '', weight: '', height: '', phoneNumber: '', queueNumber: '', areaOfConcern: ''
  });
  const [dataset, setDataset] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [patientId, setPatientId] = useState(null);
  const [infoSubmitted, setInfoSubmitted] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');

  const storedContext = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem('latestPatientContext') || '{}');
    } catch {
      return {};
    }
  }, []);

  const activePatientId = patientData?.id || storedContext?.id || null;

  // Auto-generate queue number on component mount
  useEffect(() => {
    if (activePatientId) return;

    // Get current sequential number from localStorage
    const currentNumber = parseInt(localStorage.getItem('clinicQueueNumber') || '0');
    const nextNumber = currentNumber + 1;

    // Store the next number for future use
    localStorage.setItem('clinicQueueNumber', nextNumber.toString());

    // Format as a 3-digit queue number (like Q001, Q002, etc.)
    const queueNum = `Q${nextNumber.toString().padStart(3, '0')}`;
    setFormData(prev => ({ ...prev, queueNumber: prev.queueNumber || queueNum }));
  }, [activePatientId]);

  useEffect(() => {
    if (!activePatientId) return;

    const loadExistingPatientInfo = async () => {
      setLoading(true);
      setError('');
      setStatusMessage('');

      try {
        const response = await fetch(`http://127.0.0.1:8000/api/patients/${activePatientId}/`);
        if (!response.ok) {
          throw new Error('Unable to load your existing patient information.');
        }

        const patient = await response.json();

        // If the existing patient does not have a queue number, generate
        // a frontend-only queue value to show in the form (will be
        // persisted when the user submits the form).
        let queueToShow = patient.queue_number || '';
        if (!queueToShow) {
          const currentNumber = parseInt(localStorage.getItem('clinicQueueNumber') || '0');
          const nextNumber = currentNumber + 1;
          localStorage.setItem('clinicQueueNumber', nextNumber.toString());
          queueToShow = `Q${nextNumber.toString().padStart(3, '0')}`;
        }

        setFormData(prev => ({
          ...prev,
          fullName: patient.full_name || '',
          email: patient.email || '',
          age: patient.age ?? '',
          weight: patient.weight ?? '',
          height: patient.height ?? '',
          phoneNumber: patient.phone_number || '',
          queueNumber: queueToShow || prev.queueNumber,
          // Force explicit user choice each visit to avoid auto-selected area.
          areaOfConcern: '',
        }));
        setDataset(null);

        setPatientId(patient.id);
        // Do NOT auto-enable area selection for returning patients; require explicit (re-)submission.
        setStatusMessage('Returning patient detected. Please review and re-submit your details before starting diagnosis.');
      } catch (err) {
        setError(err.message || 'Unable to load patient details.');
      } finally {
        setLoading(false);
      }
    };

    loadExistingPatientInfo();
  }, [activePatientId]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const normalizeFullName = (name) => name.replace(/\s+/g, ' ').trim();

  const getValidatedFullName = () => {
    const normalized = normalizeFullName(formData.fullName || '');
    if (!normalized) {
      return { valid: false, message: 'Full name is required.' };
    }
    if (!/^[A-Za-z\s]+$/.test(normalized)) {
      return { valid: false, message: 'Full name can only contain English letters and spaces' };
    }
    return { valid: true, value: normalized };
  };

  const buildPatientPayload = (age, weight, height, validatedFullName) => {
    return {
      full_name: validatedFullName,
      email: formData.email || '',
      age,
      weight,
      height,
      phone_number: formData.phoneNumber || '',
      queue_number: formData.queueNumber || '',
      area_of_concern: formData.areaOfConcern
    };
  };

  const handleAreaChange = async (area) => {
    setFormData(prev => ({ ...prev, areaOfConcern: area }));
    await fetchDataset(area);
  };

  const validatePatientInfo = () => {
    const requiredFields = ['fullName', 'email', 'age', 'weight', 'height'];
    const missingFields = requiredFields.filter(field => !formData[field]?.toString().trim());

    if (missingFields.length > 0) {
      return { valid: false, message: `Please fill in all required fields: ${missingFields.join(', ')}` };
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(formData.email)) {
      return { valid: false, message: 'Please enter a valid email address' };
    }

    const fullNameValidation = getValidatedFullName();
    if (!fullNameValidation.valid) {
      return { valid: false, message: fullNameValidation.message };
    }

    const age = Number(formData.age);
    const weight = Number(formData.weight);
    const height = Number(formData.height);

    if (isNaN(age) || age <= 0 || age > 150) {
      return { valid: false, message: 'Please enter a valid age (1-150)' };
    }
    if (isNaN(weight) || weight <= 0 || weight > 500) {
      return { valid: false, message: 'Please enter a valid weight (1-500 kg)' };
    }
    if (isNaN(height) || height <= 0 || height > 250) {
      return { valid: false, message: 'Please enter a valid height (50-250 cm)' };
    }

    return {
      valid: true,
      values: {
        age,
        weight,
        height,
        fullName: fullNameValidation.value,
      }
    };
  };

  const handleSubmitPatientInfo = async () => {
    const validation = validatePatientInfo();
    if (!validation.valid) {
      setStatusMessage('');
      setError(validation.message);
      return;
    }

    setLoading(true);
    setError('');
    setStatusMessage('');

    try {
      // Ensure we have a queue number for this submission. For returning
      // patients who didn't have one, generate the next sequential value
      // using the same localStorage counter used on first visit.
      let generatedQueue = null;
      if (!formData.queueNumber) {
        const currentNumber = parseInt(localStorage.getItem('clinicQueueNumber') || '0');
        const nextNumber = currentNumber + 1;
        localStorage.setItem('clinicQueueNumber', nextNumber.toString());
        generatedQueue = `Q${nextNumber.toString().padStart(3, '0')}`;
        // update local state for UI
        setFormData(prev => ({ ...prev, queueNumber: generatedQueue }));
      }

      const payload = buildPatientPayload(
        validation.values.age,
        validation.values.weight,
        validation.values.height,
        validation.values.fullName
      );

      if (generatedQueue) {
        payload.queue_number = generatedQueue;
      }

      const isExistingPatient = Boolean(patientId || activePatientId);
      const targetPatientId = patientId || activePatientId;

      const response = await fetch(
        isExistingPatient
          ? `http://127.0.0.1:8000/api/patients/${targetPatientId}/`
          : 'http://127.0.0.1:8000/api/patients/',
        {
        method: isExistingPatient ? 'PATCH' : 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || errorData.error || 'Failed to save patient data');
      }

      const savedPatient = await response.json();
      console.log('Saved patient from backend:', savedPatient);

      // Ensure we actually received an id.
      const savedPatientId = savedPatient.id || savedPatient.pk || null;
      if (!savedPatientId) {
        throw new Error('Backend did not return patient id');
      }

      const savedPatientContext = {
        ...formData,
        fullName: validation.values.fullName,
        id: savedPatientId,
        visitCount: savedPatient.visit_count || 1,
      };

      setPatientId(savedPatientId);
      setInfoSubmitted(true);
      setStatusMessage(
        isExistingPatient
          ? 'Patient information updated successfully. You can start diagnosis again or continue messaging the doctor.'
          : 'Patient information submitted successfully. Now choose a body part to start diagnosis, or go to Doctor Messages.'
      );
      onPatientInfoSubmit?.(savedPatientContext);
      
    } catch (err) {
      setError('Error saving patient data: ' + err.message);
      console.error('Patient save error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleStartDiagnosis = async () => {
    if (!infoSubmitted || !patientId) {
      setStatusMessage('');
      setError('Please submit your patient information first, then choose a body part and start diagnosis.');
      return;
    }

    if (!dataset) {
      setStatusMessage('');
      setError('Please choose a body part first to load diagnosis questions.');
      return;
    }

    setLoading(true);
    setError('');
    setStatusMessage('');

    try {
      // Keep backend patient profile in sync so chatbot and admin Q/A can resolve the correct dataset.
      const updateResponse = await fetch(`http://127.0.0.1:8000/api/patients/${patientId}/`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          area_of_concern: formData.areaOfConcern,
        })
      });

      if (!updateResponse.ok) {
        const errorData = await updateResponse.json().catch(() => ({}));
        throw new Error(errorData?.detail || errorData?.error || 'Failed to update patient area of concern');
      }

      onStart(
        { ...formData, id: patientId },
        dataset
      );
    } catch (err) {
      setError(`Unable to start diagnosis: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const fetchDataset = async (area) => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`http://127.0.0.1:8000/api/dataset/?area=${encodeURIComponent(area)}`);
      if (!response.ok) {
        let backendMessage = '';
        try {
          const errorData = await response.json();
          backendMessage = errorData?.error || errorData?.detail || '';
        } catch {
          backendMessage = '';
        }
        throw new Error(
          backendMessage || `Failed to load questions (status ${response.status})`
        );
      }
      const data = await response.json();
      setDataset(data);
      console.log('Dataset loaded for area:', area, data);
      return data;
    } catch (err) {
      setError('Error loading questions: ' + err.message);
      console.error('Error fetching dataset:', err);
      setDataset(null);
      return null;
    } finally {
      setLoading(false);
    }
  };

  const areas = ['Head', 'Breasts', 'Pelvis', 'Urinary System', 'Skin', 'Hormonal'];

  return (
    <div className="form-page">
      <div className="cards-container">
        {/* Patient Info Card */}
        <div className="form-card">
          <h2>Patient Information</h2>
          <div className="patient-info-message">
            <p>
              <strong>ℹ️ Required</strong> for your health assessment and communication with your doctor, this information helps the doctor understand your medical history and provide personalized guidance. Please complete all fields marked with an asterisk (*). Returning patients can edit and resubmit the form anytime.
            </p>
          </div>
          <div className="input-grid">
            <div className="input-group required">
              <input type="text" name="fullName" placeholder="Full Name *" required pattern="[A-Za-z\s]+" title="Only English letters and spaces allowed" value={formData.fullName} onChange={handleChange} />
            </div>
            <div className="input-group required">
              <input type="email" name="email" placeholder="Email Address *" required value={formData.email} onChange={handleChange} />
            </div>
            <div className="input-group required">
              <input type="number" name="age" placeholder="Age *" required min="1" max="150" value={formData.age} onChange={handleChange} />
            </div>
            <div className="input-group required">
              <input type="number" name="weight" placeholder="Weight (kg) *" required min="1" max="500" step="0.1" value={formData.weight} onChange={handleChange} />
            </div>
            <div className="input-group required">
              <input type="number" name="height" placeholder="Height (cm) *" required min="50" max="250" step="0.1" value={formData.height} onChange={handleChange} />
            </div>
            <div className="input-group">
              <input type="tel" name="phoneNumber" placeholder="Phone Number (for notifications)" value={formData.phoneNumber} onChange={handleChange} />
            </div>
            <div className="input-group readonly span-2">
              <label htmlFor="queue-number">Queue Number</label>
              <input id="queue-number" type="text" name="queueNumber" placeholder="Queue Number" value={formData.queueNumber} readOnly />
            </div>
          </div>
          <p className="privacy-note">
            * Required fields. Queue number is auto-generated. By continuing, you acknowledge our notice of privacy practices...
          </p>
          <button className="btn-submit btn-submit-inline" onClick={handleSubmitPatientInfo} disabled={loading}>
            {loading ? 'Submitting...' : (patientId || activePatientId ? 'Update Patient Information' : 'Submit Patient Information')}
          </button>
        </div>

        {/* Area of Concern Card */}
        <div className="form-card">
          <h2>Area of Concern</h2>
          <p className="subtitle">Select the primary body part for diagnosis.</p>
          <div className="radio-group">
            {/* Area selection message removed per UI request */}
            {areas.map(area => (
              <label
                  key={`area-${area}`}
                className={`radio-row ${formData.areaOfConcern === area ? 'selected' : ''} ${!infoSubmitted ? 'disabled-row' : ''}`}
                tabIndex={!infoSubmitted ? -1 : 0}
                aria-disabled={!infoSubmitted}
                onClick={e => {
                  if (!infoSubmitted) {
                    alert('Please enter and submit your patient information first.');
                  }
                }}
                style={!infoSubmitted ? { cursor: 'not-allowed' } : {}}
              >
                <span>{area}</span>
                <input 
                  type="radio" 
                  name="areaOfConcern" 
                  value={area}
                  checked={formData.areaOfConcern === area}
                  onChange={e => {
                    if (!infoSubmitted) {
                      return;
                    }
                    handleAreaChange(e.target.value);
                  }}
                  disabled={!infoSubmitted}
                />
              </label>
            ))}
          </div>
          {loading && <p className="status-message">Loading questions...</p>}
          {error && <p className="error-message">{error}</p>}
          {statusMessage && <p className="success-message">{statusMessage}</p>}
          {dataset && <p className="success-message">✓ Questions loaded for {formData.areaOfConcern}</p>}
          <div className="info-note">
            <p>ℹ️ <strong>Note:</strong> If you have external symptoms or disease not covered by these body parts, you can contact a doctor directly for answers.</p>
            {/* 'Go to Doctor Messages' button removed per UI request */}
          </div>
        </div>
      </div>
      <button
        className="btn-submit"
        onClick={e => {
          if (!infoSubmitted) {
            alert('Please enter and submit your patient information first.');
            return;
          }
          handleStartDiagnosis(e);
        }}
        disabled={!dataset || loading}
      >
        {loading ? 'Starting Diagnosis...' : 'Start Diagnosis'}
      </button>
    </div>
  );
};

export default DiagnosisForm;
