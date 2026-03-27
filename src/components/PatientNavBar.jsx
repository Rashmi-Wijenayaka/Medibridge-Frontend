import React from 'react';
import './PatientNavBar.css';

const PatientNavBar = ({ onHome, onForm, onDoctorMessages, onDiagnosis, view, areaOfConcern }) => {
  const handleDoctorMessages = () => {
    // Delegate patient-info gating and UI to the App-level handlers so behavior is consistent
    onDoctorMessages?.();
  };

  return (
    <div className="patient-navbar">
      <button className="nav-btn" onClick={onHome}>Home</button>
      <button className="nav-btn" onClick={onForm}>Diagnosis Form</button>
      <button className="nav-btn" onClick={handleDoctorMessages}>Doctor Messages</button>
      <button className="nav-btn" onClick={onDiagnosis}>Sys Admin Diagnosis</button>
    </div>
  );
};

export default PatientNavBar;