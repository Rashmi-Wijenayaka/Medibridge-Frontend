import { useState, useEffect, useCallback } from "react";
import Home from "./components/Home";
import DiagnosisForm from "./components/DiagnosisForm"; 
import DiagnosticChat from "./components/DiagnosticChat";
import AdminLogin from "./components/AdminLogin";
import DoctorLogin from "./components/DoctorLogin";
import AdminDashboard from "./components/AdminDashboard";
import DoctorChat from "./components/DoctorChat";
import PatientMessages from "./components/PatientMessages"; 
import PatientDiagnosis from "./components/PatientDiagnosis";
import PatientNavBar from "./components/PatientNavBar";

function App() {
  const [view, setView] = useState("home");
  const [patientData, setPatientData] = useState(null);
    const [patientInfoSubmitted, setPatientInfoSubmitted] = useState(false);
  const [dataset, setDataset] = useState(null);
  const [questionnaireCompleted, setQuestionnaireCompleted] = useState(false);
  const [user, setUser] = useState(null);
  const [showInfoRequiredModal, setShowInfoRequiredModal] = useState(false);

  // Check if patient has submitted complete information
  const isPatientInfoComplete = useCallback(() => {
    // If we already have a patient id (from previous navigation or login), consider info complete.
    if (patientData?.id) return true;

    // If the form was submitted in this session, that's also sufficient.
    if (patientInfoSubmitted) return true;

    // If state isn't yet populated (race), fall back to last saved context in localStorage
    try {
      const ctx = JSON.parse(localStorage.getItem('latestPatientContext') || '{}');
      if (ctx && ctx.id) return true;
    } catch (e) {
      // ignore JSON errors
    }
    return false;
  }, [patientData?.id, patientInfoSubmitted]);

  const handleLogout = useCallback(() => {
    setUser(null);
    localStorage.removeItem('token');
    localStorage.removeItem('latestPatientContext');
    localStorage.removeItem('authUser');
    setView('home');
  }, []);

  const canEnterChat = Boolean(patientData?.id && dataset);

  useEffect(() => {
    // Guard chat route: patient must complete form and choose area/dataset first.
    if (view === 'chat' && !canEnterChat) {
      setView('form');
    }
  }, [view, canEnterChat]);

  const handleLogin = (userData, authToken) => {
    setUser(userData);
    localStorage.setItem('token', authToken);
    localStorage.setItem('authUser', JSON.stringify(userData));
    if (userData.role === 'admin') {
      setView('adminDashboard');
    } else if (userData.role === 'doctor') {
      setView('doctorChat');
    }
  };

  const handleStartDiagnosis = (formData, loadedDataset) => {
    setPatientData(formData);
    setQuestionnaireCompleted(false);
    localStorage.setItem('latestPatientContext', JSON.stringify({
      id: formData?.id,
      fullName: formData?.fullName,
      queueNumber: formData?.queueNumber,
      visitCount: formData?.visitCount,
    }));
    setDataset(loadedDataset);
    setView("chat");
  };

  const handlePatientInfoSubmitted = (formData) => {
    setPatientData((prev) => ({ ...(prev || {}), ...formData }));
    localStorage.setItem('latestPatientContext', JSON.stringify({
      id: formData?.id,
      fullName: formData?.fullName,
      queueNumber: formData?.queueNumber,
      visitCount: formData?.visitCount,
      email: formData?.email,
      age: formData?.age,
      weight: formData?.weight,
      height: formData?.height,
      phoneNumber: formData?.phoneNumber,
      areaOfConcern: formData?.areaOfConcern,
    }));
    // Keep user on form so they can either choose a body part or navigate to doctor messages.
    setView('form');
    setPatientInfoSubmitted(true);
  };

  const handlePatientLoginNavigation = (patientProfile = {}, destination = 'form') => {
    const normalizedPatient = {
      id: patientProfile?.id,
      fullName: patientProfile?.full_name || patientProfile?.fullName || '',
      queueNumber: patientProfile?.queue_number || patientProfile?.queueNumber || '',
      visitCount: patientProfile?.visit_count || patientProfile?.visitCount || 1,
    };

    if (normalizedPatient.id) {
      setPatientData((prev) => ({ ...(prev || {}), ...normalizedPatient }));
      localStorage.setItem('latestPatientContext', JSON.stringify(normalizedPatient));
    }

    // Enforce patient info submission before accessing doctor messages or diagnosis
    if ((destination === 'patientMessages' || destination === 'patientDiagnosis') && !normalizedPatient.id) {
      setShowInfoRequiredModal(true);
      setView('form');
      return;
    }

    if (destination === 'patientMessages') {
      setView('patientMessages');
      return;
    }
    if (destination === 'patientDiagnosis') {
      setView('patientDiagnosis');
      return;
    }
    setView('form');
  };

  const navigatePatientSection = (targetView) => {
    const tryingToLeaveChat = view === 'chat' && targetView !== 'chat';
    if (tryingToLeaveChat && !questionnaireCompleted) {
      alert('Please answer all questions before leaving the section');
      return;
    }
    // If user is already on the patient information form, allow navigating to patient-specific views
    // (so they don't see the modal overlay while already filling the form).
    if (view === 'form' && (targetView === 'patientMessages' || targetView === 'patientDiagnosis')) {
      setView(targetView);
      return;
    }

    // Enforce patient info submission before accessing doctor messages or diagnosis
    if ((targetView === 'patientMessages' || targetView === 'patientDiagnosis') && !isPatientInfoComplete()) {
      setShowInfoRequiredModal(true);
      return;
    }
    
    setView(targetView);
  };

  const patientNav = {
    onHome: () => navigatePatientSection('home'),
    onForm: () => navigatePatientSection('form'),
    onDoctorMessages: () => navigatePatientSection('patientMessages'),
    onDiagnosis: () => navigatePatientSection('patientDiagnosis')
  };

  const showPatientNavBar = ['form', 'chat', 'patientMessages', 'patientDiagnosis'].includes(view);

  return (
    <div className="App">
      {showInfoRequiredModal && (
        <div className="modal-overlay" onClick={() => setShowInfoRequiredModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Patient Information Required</h2>
              <button className="modal-close" onClick={() => setShowInfoRequiredModal(false)}>×</button>
            </div>
            <div className="modal-body">
              <p>To send messages to the doctor or access diagnosis tools, you must first submit your complete patient information.</p>
              <p>Please fill in all required fields in the Patient Information form and click "Submit Patient Information".</p>
            </div>
            <div className="modal-footer">
              <button className="btn-primary" onClick={() => { setShowInfoRequiredModal(false); setView('form'); }}>
                Go to Patient Form
              </button>
            </div>
          </div>
        </div>
      )}
      
      {showPatientNavBar && (
        <PatientNavBar
            onHome={patientNav.onHome}
            onForm={patientNav.onForm}
            onDoctorMessages={patientNav.onDoctorMessages}
            onDiagnosis={patientNav.onDiagnosis}
            patientInfoSubmitted={patientInfoSubmitted}
            view={view}
            areaOfConcern={patientData?.areaOfConcern || patientData?.area_of_concern}
        />
      )}

      {view === "home" && (
        <Home
          onPatientStart={() => navigatePatientSection("form")}
          onDoctorLogin={() => setView("doctorLogin")}
          onAdminLogin={() => setView("adminLogin")}
          onPatientLogin={handlePatientLoginNavigation}
        />
      )}

      {view === "form" && (
        <DiagnosisForm
          onStart={handleStartDiagnosis}
          onPatientInfoSubmit={handlePatientInfoSubmitted}
          patientData={patientData}
        />
      )}

      {view === "chat" && (
        <DiagnosticChat
          patientData={patientData}
          dataset={dataset}
          onCompletionChange={setQuestionnaireCompleted}
        />
      )}

      {view === "doctorLogin" && (
        <DoctorLogin onLogin={handleLogin} onBack={() => setView("home")} />
      )}

      {view === "adminLogin" && (
        <AdminLogin onLogin={handleLogin} onBack={() => setView("home")} />
      )}

      {view === "doctorChat" && (
        <DoctorChat onBack={handleLogout} user={user} />
      )}

      {view === "adminDashboard" && (
        <AdminDashboard onBack={handleLogout} />
      )}

      {view === "patientMessages" && (
        <PatientMessages
          patientData={patientData}
        />
      )}

      {view === "patientDiagnosis" && (
        <PatientDiagnosis
          patientData={patientData}
        />
      )}
    </div>
  );
}

export default App;