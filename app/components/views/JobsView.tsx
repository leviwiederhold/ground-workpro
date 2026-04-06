/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
'use client';

import { useCallback, useEffect, useState } from 'react';

const confirmDestructiveAction = (targetLabel) => window.confirm(`Delete ${targetLabel}? This cannot be undone.`);
export function JobsView({ jobs, jobsLoading, setJobs, equipment, setEquipment, employees, setEmployees, ui, moduleAccess = {} }) {
  const { SearchInput, Card, Button, Icon, Badge, AttachmentPanel, formatDate } = ui;
  const canEditJobs = String(moduleAccess?.jobs || 'none') === 'edit';
  const currency = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [selectedJobId, setSelectedJobId] = useState(null);
  const [jobForm, setJobForm] = useState({
    name: '',
    status: 'active',
    client: '',
    site_address: '',
    start_date: '',
    target_end_date: '',
    notes: '',
  });
  const [saveLoading, setSaveLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [jobActionError, setJobActionError] = useState('');
  const [jobEquipment, setJobEquipment] = useState([]);
  const [jobEquipmentLoading, setJobEquipmentLoading] = useState(false);
  const [equipmentToAssign, setEquipmentToAssign] = useState([]);
  const [jobEmployees, setJobEmployees] = useState([]);
  const [jobEmployeesLoading, setJobEmployeesLoading] = useState(false);
  const [employeeToAssign, setEmployeeToAssign] = useState([]);
  const [crewActionLoading, setCrewActionLoading] = useState(false);
  const [crewActionError, setCrewActionError] = useState('');
  const [equipmentActionLoading, setEquipmentActionLoading] = useState(false);
  const [equipmentActionError, setEquipmentActionError] = useState('');
  const [financialSummary, setFinancialSummary] = useState(null);
  const [financialLoading, setFinancialLoading] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [showMobileDetails, setShowMobileDetails] = useState(false);
  const refreshJobsState = useCallback(async () => {
    const response = await fetch('/api/jobs', { cache: 'no-store' });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.error || 'Failed to refresh jobs');
    }
    const nextJobs = payload?.jobs || payload?.items || [];
    setJobs(nextJobs);
    return nextJobs;
  }, [setJobs]);

  const refreshEquipmentState = useCallback(async () => {
    const response = await fetch('/api/equipment', { cache: 'no-store' });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.error || 'Failed to refresh equipment');
    }
    setEquipment(payload?.equipment || payload?.items || []);
  }, [setEquipment]);

  const refreshEmployeesState = useCallback(async () => {
    const response = await fetch('/api/employees', { cache: 'no-store' });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.error || 'Failed to refresh employees');
    }
    setEmployees(payload?.employees || []);
  }, [setEmployees]);

  const syncSelectedJobCounts = useCallback((crewCount, equipmentCount) => {
    if (!selectedJobId) return;
    setJobs((prev) =>
      prev.map((job) =>
        String(job.id) === String(selectedJobId)
          ? { ...job, crew_assigned_count: crewCount, equipment_assigned_count: equipmentCount }
          : job
      )
    );
  }, [selectedJobId, setJobs]);

  const handleCreateJob = async () => {
    if (!canEditJobs) return;
    const baseCount = jobs.length + 1;
    const tempId = `temp-job-${Date.now()}`;
    const optimisticJob = {
      id: tempId,
      name: `New Job ${baseCount}`,
      status: 'in_progress',
      client: '',
      site_address: '',
      start_date: '',
      target_end_date: '',
      notes: '',
      crew_assigned_count: 0,
      equipment_assigned_count: 0,
    };
    setJobs((prev) => [optimisticJob, ...prev]);
    setSelectedJobId(tempId);
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    try {
      const response = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: optimisticJob.name,
          status: 'in_progress',
          client: '',
          site_address: '',
          start_date: '',
          target_end_date: '',
          notes: '',
        }),
      });

      const raw = await response.text();
      let payload = null;
      try {
        payload = raw ? JSON.parse(raw) : null;
      } catch {
        payload = null;
      }

      if (!response.ok || !payload?.job) {
        setJobs((prev) => prev.filter((job) => String(job.id) !== tempId));
        setSelectedJobId((current) => (String(current) === tempId ? null : current));
        console.warn('Create job failed', payload?.error || raw || response.statusText);
        return;
      }

      setJobs((prev) => prev.map((job) => (String(job.id) === tempId ? payload.job : job)));
      setSelectedJobId(payload.job.id);
    } catch (error) {
      setJobs((prev) => prev.filter((job) => String(job.id) !== tempId));
      setSelectedJobId((current) => (String(current) === tempId ? null : current));
      console.warn('Create job failed', error);
    }
  };

  const normalizeJobStatus = useCallback((status) => {
    const value = String(status || '').trim().toLowerCase();
    if (['in_progress', 'active', 'open', 'approved'].includes(value)) return 'active';
    if (['completed', 'complete'].includes(value)) return 'completed';
    return 'other';
  }, []);

  const jobOrder = new Map(jobs.map((job, index) => [String(job.id), index]));
  const filteredJobs = jobs.filter(job => {
    const normalizedStatus = normalizeJobStatus(job.status);
    if (normalizedStatus === 'other') return false;
    if (filter !== 'all' && filter !== normalizedStatus) return false;
    const haystack = `${job.name || ''} ${job.client || job.client_name || ''} ${job.site_address || job.address || ''}`.toLowerCase();
    if (search && !haystack.includes(search.toLowerCase())) return false;
    return true;
  }).sort((a, b) => {
    const aStatus = normalizeJobStatus(a.status);
    const bStatus = normalizeJobStatus(b.status);
    if (aStatus !== bStatus) return aStatus === 'active' ? -1 : 1;
    return (jobOrder.get(String(a.id)) ?? 0) - (jobOrder.get(String(b.id)) ?? 0);
  });

  const selectedJob = jobs.find(j => j.id === selectedJobId);
  const availableEmployees = selectedJob
    ? employees.filter(
        (employee) => !jobEmployees.some((assigned) => String(assigned.id) === String(employee.id))
      )
    : [];
  const availableEquipment = selectedJob
    ? equipment.filter(
        (item) => !jobEquipment.some((assigned) => String(assigned.id) === String(item.id))
      )
    : [];
  const getAssignedJobName = useCallback((jobId) => {
    if (jobId === null || jobId === undefined || jobId === '') return '';
    const match = jobs.find((job) => String(job.id) === String(jobId));
    return match?.name || 'Another job';
  }, [jobs]);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 1023px)');
    const update = () => setIsMobile(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (!isMobile) setShowMobileDetails(false);
  }, [isMobile]);

  useEffect(() => {
    if (!selectedJob) setShowMobileDetails(false);
  }, [selectedJob]);

  useEffect(() => {
    if (!showMobileDetails || typeof document === 'undefined') return undefined;
    document.body.classList.add('modal-open');
    const appScrollContainer = document.querySelector('.mobile-app-shell__content');
    const priorOverflow = appScrollContainer instanceof HTMLElement ? appScrollContainer.style.overflow : '';
    const priorOverscroll = appScrollContainer instanceof HTMLElement ? appScrollContainer.style.overscrollBehavior : '';
    if (appScrollContainer instanceof HTMLElement) {
      appScrollContainer.style.overflow = 'hidden';
      appScrollContainer.style.overscrollBehavior = 'none';
    }
    return () => {
      document.body.classList.remove('modal-open');
      if (appScrollContainer instanceof HTMLElement) {
        appScrollContainer.style.overflow = priorOverflow;
        appScrollContainer.style.overscrollBehavior = priorOverscroll;
      }
    };
  }, [showMobileDetails]);

  useEffect(() => {
    if (!selectedJob) return;
    setJobForm({
      name: selectedJob.name || '',
      status: normalizeJobStatus(selectedJob.status),
      client: selectedJob.client || selectedJob.client_name || '',
      site_address: selectedJob.site_address || selectedJob.address || '',
      start_date: selectedJob.start_date || selectedJob.startDate || '',
      target_end_date: selectedJob.target_end_date || selectedJob.targetEndDate || selectedJob.endDate || '',
      notes: selectedJob.notes || '',
    });
    setJobActionError('');
  }, [normalizeJobStatus, selectedJob]);

  const getJobCrewCount = useCallback((job) => {
    if (String(selectedJobId ?? '') === String(job.id)) {
      return jobEmployees.length;
    }
    const explicit = Number(job.crew_assigned_count ?? job.crewAssigned ?? job.crewCount);
    if (Number.isFinite(explicit) && explicit >= 0) return explicit;
    return employees.filter((employee) => String(employee.jobId ?? '') === String(job.id)).length;
  }, [employees, jobEmployees.length, selectedJobId]);

  const getJobEquipmentCount = useCallback((job) => {
    if (String(selectedJobId ?? '') === String(job.id)) {
      return jobEquipment.length;
    }
    const explicit = Number(job.equipment_assigned_count ?? job.equipmentAssigned ?? job.equipmentCount);
    if (Number.isFinite(explicit) && explicit >= 0) return explicit;
    return equipment.filter((item) => String(item.jobId ?? '') === String(job.id)).length;
  }, [equipment, jobEquipment.length, selectedJobId]);

  const refreshSelectedAssignments = useCallback(async () => {
    if (!selectedJobId) return;
    const [employeesResponse, equipmentResponse] = await Promise.all([
      fetch(`/api/jobs/${selectedJobId}/employees`, { cache: 'no-store' }),
      fetch(`/api/jobs/${selectedJobId}/equipment`, { cache: 'no-store' }),
    ]);
    const employeesPayload = await employeesResponse.json().catch(() => ({}));
    const equipmentPayload = await equipmentResponse.json().catch(() => ({}));
    const nextEmployees = employeesResponse.ok ? (employeesPayload?.employees || []) : [];
    const nextEquipment = equipmentResponse.ok ? (equipmentPayload?.equipment || []) : [];
    setJobEmployees(nextEmployees);
    setJobEquipment(nextEquipment);
    syncSelectedJobCounts(nextEmployees.length, nextEquipment.length);
  }, [selectedJobId, syncSelectedJobCounts]);
  const refreshAssignmentState = useCallback(async () => {
    await Promise.all([
      refreshSelectedAssignments(),
      refreshJobsState(),
      refreshEquipmentState(),
      refreshEmployeesState(),
    ]);
  }, [refreshEmployeesState, refreshEquipmentState, refreshJobsState, refreshSelectedAssignments]);

  useEffect(() => {
    let isMounted = true;

    const loadJobEquipment = async () => {
      if (!selectedJob) {
        if (isMounted) {
          setJobEquipment([]);
          setEquipmentToAssign([]);
          setEquipmentActionError('');
        }
        return;
      }

      try {
        setJobEquipmentLoading(true);
        const response = await fetch(`/api/jobs/${selectedJob.id}/equipment`, { cache: 'no-store' });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload?.error || 'Failed to load assigned equipment');
        }
        if (isMounted) {
          setJobEquipment(payload.equipment || []);
        }
      } catch {
        if (isMounted) {
          setJobEquipment([]);
        }
      } finally {
        if (isMounted) {
          setJobEquipmentLoading(false);
        }
      }
    };

    const loadJobEmployees = async () => {
      if (!selectedJob) {
        if (isMounted) {
          setJobEmployees([]);
          setEmployeeToAssign([]);
          setCrewActionError('');
        }
        return;
      }

      try {
        setJobEmployeesLoading(true);
        const response = await fetch(`/api/jobs/${selectedJob.id}/employees`, { cache: 'no-store' });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload?.error || 'Failed to load assigned crew');
        }
        if (isMounted) {
          setJobEmployees(payload.employees || []);
        }
      } catch {
        if (isMounted) {
          setJobEmployees([]);
        }
      } finally {
        if (isMounted) {
          setJobEmployeesLoading(false);
        }
      }
    };

    loadJobEquipment();
    loadJobEmployees();
    return () => {
      isMounted = false;
    };
  }, [selectedJob]);

  useEffect(() => {
    if (!selectedJobId) return;
    syncSelectedJobCounts(jobEmployees.length, jobEquipment.length);
  }, [jobEmployees.length, jobEquipment.length, selectedJobId, syncSelectedJobCounts]);

  useEffect(() => {
    let active = true;
    const loadFinancialSummary = async () => {
      if (!selectedJob) {
        if (active) setFinancialSummary(null);
        return;
      }
      try {
        setFinancialLoading(true);
        const response = await fetch(`/api/jobs/${selectedJob.id}/financial-summary`, { cache: 'no-store' });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          if (active) setFinancialSummary(null);
          return;
        }
        if (active) {
          setFinancialSummary(payload?.item || null);
        }
      } catch {
        if (active) setFinancialSummary(null);
      } finally {
        if (active) setFinancialLoading(false);
      }
    };

    loadFinancialSummary();
    return () => {
      active = false;
    };
  }, [selectedJob]);

  const handleAssignEmployee = async () => {
    if (!canEditJobs) return;
    if (!selectedJob || employeeToAssign.length === 0) return;
    setCrewActionLoading(true);
    setCrewActionError('');
    try {
      for (const employeeId of employeeToAssign) {
        const response = await fetch(`/api/jobs/${selectedJob.id}/employees`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ employee_id: employeeId }),
        });
        const raw = await response.text();
        let payload = null;
        try {
          payload = raw ? JSON.parse(raw) : null;
        } catch {
          payload = null;
        }

        if (!response.ok || !payload?.employee) {
          setCrewActionError(payload?.error || raw || 'Failed to assign employee');
          setCrewActionLoading(false);
          return;
        }
      }

      setEmployeeToAssign([]);
      await refreshAssignmentState();
    } catch {
      setCrewActionError('Failed to assign employee');
    } finally {
      setCrewActionLoading(false);
    }
  };

  const handleUnassignEmployee = async (employeeId) => {
    if (!canEditJobs) return;
    if (!selectedJob) return;
    const confirmed = confirmDestructiveAction('this crew assignment');
    if (!confirmed) return;
    setCrewActionLoading(true);
    setCrewActionError('');
    try {
      const response = await fetch(`/api/jobs/${selectedJob.id}/employees/${employeeId}`, {
        method: 'DELETE',
      });
      const raw = await response.text();
      let payload = null;
      try {
        payload = raw ? JSON.parse(raw) : null;
      } catch {
        payload = null;
      }

      if (!response.ok || !payload?.success) {
        setCrewActionError(payload?.error || raw || 'Failed to remove employee');
        setCrewActionLoading(false);
        return;
      }

      await refreshAssignmentState();
    } catch {
      setCrewActionError('Failed to remove employee');
    } finally {
      setCrewActionLoading(false);
    }
  };

  const handleAssignEquipment = async () => {
    if (!canEditJobs) return;
    if (!selectedJob || equipmentToAssign.length === 0) return;
    setEquipmentActionLoading(true);
    setEquipmentActionError('');
    try {
      for (const equipmentId of equipmentToAssign) {
        const response = await fetch(`/api/jobs/${selectedJob.id}/equipment`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ equipment_id: equipmentId }),
        });
        const raw = await response.text();
        let payload = null;
        try {
          payload = raw ? JSON.parse(raw) : null;
        } catch {
          payload = null;
        }

        if (!response.ok || !payload?.equipment) {
          setEquipmentActionError(payload?.error || raw || 'Failed to assign equipment');
          setEquipmentActionLoading(false);
          return;
        }
      }

      setEquipmentToAssign([]);
      await refreshAssignmentState();
    } catch {
      setEquipmentActionError('Failed to assign equipment');
    } finally {
      setEquipmentActionLoading(false);
    }
  };

  const handleUnassignEquipment = async (equipmentId) => {
    if (!canEditJobs) return;
    if (!selectedJob) return;
    const confirmed = confirmDestructiveAction('this equipment assignment');
    if (!confirmed) return;
    setEquipmentActionLoading(true);
    setEquipmentActionError('');
    try {
      const response = await fetch(`/api/jobs/${selectedJob.id}/equipment/${equipmentId}`, {
        method: 'DELETE',
      });
      const raw = await response.text();
      let payload = null;
      try {
        payload = raw ? JSON.parse(raw) : null;
      } catch {
        payload = null;
      }

      if (!response.ok || !payload?.success) {
        setEquipmentActionError(payload?.error || raw || 'Failed to remove equipment');
        setEquipmentActionLoading(false);
        return;
      }

      await refreshAssignmentState();
    } catch {
      setEquipmentActionError('Failed to remove equipment');
    } finally {
      setEquipmentActionLoading(false);
    }
  };

  const handleSaveJob = async () => {
    if (!canEditJobs) return;
    if (!selectedJob) return;
    setSaveLoading(true);
    setJobActionError('');

    try {
      const updates = {};
      if (jobForm.name !== (selectedJob.name || '')) updates.name = jobForm.name;
      const selectedStatus = normalizeJobStatus(selectedJob.status);
      if (jobForm.status !== selectedStatus) {
        updates.status = jobForm.status === 'completed' ? 'completed' : 'in_progress';
      }
      if (jobForm.client !== (selectedJob.client || selectedJob.client_name || '')) updates.client = jobForm.client;
      if (jobForm.site_address !== (selectedJob.site_address || selectedJob.address || '')) updates.site_address = jobForm.site_address;
      if (jobForm.start_date !== (selectedJob.start_date || selectedJob.startDate || '')) updates.start_date = jobForm.start_date;
      if (jobForm.target_end_date !== (selectedJob.target_end_date || selectedJob.targetEndDate || selectedJob.endDate || '')) updates.target_end_date = jobForm.target_end_date;
      if (jobForm.notes !== (selectedJob.notes || '')) updates.notes = jobForm.notes;

      if (Object.keys(updates).length === 0) {
        setSaveLoading(false);
        return;
      }

      const response = await fetch(`/api/jobs/${selectedJob.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });

      const payload = await response.json();
      if (!response.ok || !payload?.job) {
        setJobActionError(payload?.error || 'Failed to save job');
        setSaveLoading(false);
        return;
      }

      setJobs((prev) =>
        prev.map((job) => (String(job.id) === String(selectedJob.id) ? payload.job : job))
      );
    } catch {
      setJobActionError('Failed to save job');
    } finally {
      setSaveLoading(false);
    }
  };

  const handleDeleteJob = async () => {
    if (!canEditJobs) return;
    if (!selectedJob) return;
    const confirmed = confirmDestructiveAction('this job');
    if (!confirmed) return;

    setDeleteLoading(true);
    setJobActionError('');

    try {
      const response = await fetch(`/api/jobs/${selectedJob.id}`, {
        method: 'DELETE',
      });
      const payload = await response.json();
      if (!response.ok || !payload?.success) {
        setJobActionError(payload?.error || 'Failed to delete job');
        setDeleteLoading(false);
        return;
      }

      setJobs((prev) => prev.filter((job) => String(job.id) !== String(selectedJob.id)));
      setSelectedJobId(null);
    } catch {
      setJobActionError('Failed to delete job');
    } finally {
      setDeleteLoading(false);
    }
  };

  const renderEquipmentAssignmentSection = () => (
    <div>
      <p className="text-xs text-gray-500 mb-2">Assigned Equipment ({jobEquipment.length})</p>
      <div className="mb-2 border border-gray-300 rounded-lg p-2 max-h-40 overflow-y-auto overscroll-contain">
        {availableEquipment.length > 0 ? (
          <div className="space-y-1">
            {availableEquipment.map((item) => {
              const checked = equipmentToAssign.includes(String(item.id));
              const assignedElsewhere = item.jobId !== null && String(item.jobId) !== String(selectedJob?.id);
              return (
                <label key={item.id} className="flex items-start gap-2 rounded-md px-1 py-1 text-sm cursor-pointer hover:bg-gray-50">
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={!canEditJobs}
                    onChange={(e) => {
                      const id = String(item.id);
                      setEquipmentToAssign((prev) => {
                        if (e.target.checked) return [...prev, id];
                        return prev.filter((value) => String(value) !== id);
                      });
                    }}
                    className="mt-1"
                  />
                  <span className="min-w-0">
                    <span className="block font-medium text-gray-900">{item.name}</span>
                    <span className="block text-xs text-gray-500">
                      {item.type}
                      {assignedElsewhere ? ` • Reassign from ${getAssignedJobName(item.jobId)}` : ' • Unassigned'}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-gray-400">No available equipment</p>
        )}
      </div>
      <div className="flex items-center gap-2 mb-2">
        <Button variant="secondary" size="sm" onClick={handleAssignEquipment} disabled={!canEditJobs || equipmentActionLoading || equipmentToAssign.length === 0}>
          {equipmentActionLoading ? 'Updating...' : `Add Selected (${equipmentToAssign.length})`}
        </Button>
      </div>
      <div className="space-y-1">
        {jobEquipmentLoading ? (
          <p className="text-sm text-gray-400">Loading equipment...</p>
        ) : jobEquipment.map(eq => (
          <div key={eq.id} className="flex items-center justify-between text-sm p-2 bg-gray-50 rounded">
            <span className="min-w-0 truncate">{eq.name}</span>
            <div className="flex items-center gap-2">
              <Badge variant="success" className="text-xs">Active</Badge>
              <button
                type="button"
                onClick={() => handleUnassignEquipment(eq.id)}
                className="text-xs text-red-600 hover:text-red-700"
                disabled={!canEditJobs || equipmentActionLoading}
              >
                Remove
              </button>
            </div>
          </div>
        ))}
        {!jobEquipmentLoading && jobEquipment.length === 0 && <p className="text-sm text-gray-400">No equipment assigned</p>}
      </div>
      {equipmentActionError && <p className="text-sm text-red-600 mt-2">{equipmentActionError}</p>}
    </div>
  );

  const renderCrewAssignmentSection = () => (
    <div>
      <p className="text-xs text-gray-500 mb-2">Assigned Crew ({jobEmployees.length})</p>
      <div className="mb-2 border border-gray-300 rounded-lg p-2 max-h-40 overflow-y-auto overscroll-contain">
        {availableEmployees.length > 0 ? (
          <div className="space-y-1">
            {availableEmployees.map((employee) => {
              const checked = employeeToAssign.includes(String(employee.id));
              return (
                <label key={employee.id} className="flex items-center gap-2 text-sm cursor-pointer rounded-md px-1 py-1 hover:bg-gray-50">
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={!canEditJobs}
                    onChange={(e) => {
                      const id = String(employee.id);
                      setEmployeeToAssign((prev) => {
                        if (e.target.checked) return [...prev, id];
                        return prev.filter((value) => String(value) !== id);
                      });
                    }}
                  />
                  <span>{employee.name} - {employee.role}</span>
                </label>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-gray-400">No available crew</p>
        )}
      </div>
      <div className="flex items-center gap-2 mb-2">
        <Button variant="secondary" size="sm" onClick={handleAssignEmployee} disabled={!canEditJobs || crewActionLoading || employeeToAssign.length === 0}>
          {crewActionLoading ? 'Updating...' : `Add Selected (${employeeToAssign.length})`}
        </Button>
      </div>
      <div className="space-y-1">
        {jobEmployeesLoading ? (
          <p className="text-sm text-gray-400">Loading crew...</p>
        ) : jobEmployees.map(emp => (
          <div key={emp.id} className="flex items-center justify-between text-sm p-2 bg-gray-50 rounded">
            <span>{emp.name}</span>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">{emp.role}</span>
              <button
                type="button"
                onClick={() => handleUnassignEmployee(emp.id)}
                className="text-xs text-red-600 hover:text-red-700"
                disabled={!canEditJobs || crewActionLoading}
              >
                Remove
              </button>
            </div>
          </div>
        ))}
        {!jobEmployeesLoading && jobEmployees.length === 0 && <p className="text-sm text-gray-400">No crew assigned</p>}
      </div>
      {crewActionError && <p className="text-sm text-red-600 mt-2">{crewActionError}</p>}
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4 min-w-0">
          <div className="flex bg-gray-100 rounded-lg p-1 overflow-x-auto">
            {['all', 'active', 'completed'].map(status => (
              <button
                key={status}
                onClick={() => setFilter(status)}
                className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors whitespace-nowrap ${
                  filter === status ? 'bg-white shadow text-gray-900' : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                {status.charAt(0).toUpperCase() + status.slice(1)}
              </button>
            ))}
          </div>
          <div className="w-full sm:w-72 lg:w-80">
            <SearchInput value={search} onChange={setSearch} placeholder="Search jobs..." />
          </div>
        </div>
        <Button
          variant="brand"
          className="w-full sm:w-auto whitespace-nowrap"
          onClick={handleCreateJob}
          disabled={!canEditJobs}
          data-testid="jobs-create"
        >
          <Icon name="plus" className="mr-2" /> New Job
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Jobs List */}
        <div className="lg:col-span-2 space-y-4">
          {jobsLoading ? (
            <Card className="p-4">
              <p className="text-sm text-gray-500">Loading jobs...</p>
            </Card>
          ) : filteredJobs.length === 0 ? (
            <Card className="p-4">
              <p className="text-sm text-gray-500">No jobs found.</p>
            </Card>
          ) : (
            filteredJobs.map(job => (
              <Card
                key={job.id}
                data-testid={`job-row-${job.id}`}
                className={`p-4 cursor-pointer transition-all ${selectedJobId === job.id ? 'ring-2 ring-brand-500' : 'hover:shadow-md'}`}
                onClick={() => {
                  setSelectedJobId(job.id);
                  if (isMobile) setShowMobileDetails(true);
                }}
              >
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="font-semibold text-gray-900">{job.name}</h3>
                    <p className="text-sm text-gray-500">{job.client || job.client_name || 'No client set'}</p>
                  </div>
                  <Badge className={normalizeJobStatus(job.status) === 'completed' ? 'bg-gray-100 text-gray-700' : 'bg-emerald-100 text-emerald-700'}>
                    {normalizeJobStatus(job.status) === 'completed' ? 'completed' : 'active'}
                  </Badge>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-3">
                  <div>
                    <p className="text-xs text-gray-500">Client</p>
                    <p className="font-medium text-gray-900 truncate">{job.client || job.client_name || '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Site</p>
                    <p className="font-medium text-gray-900 truncate">{job.site_address || job.address || '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Start Date</p>
                    <p className="font-medium text-gray-900">{formatDate(job.startDate || job.start_date)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Crew</p>
                    <p className="font-medium text-gray-900">{getJobCrewCount(job)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Equipment</p>
                    <p className="font-medium text-gray-900">{getJobEquipmentCount(job)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">End Date</p>
                    <p className="font-medium text-gray-900">{formatDate(job.targetEndDate || job.target_end_date || job.endDate || job.end_date)}</p>
                  </div>
                </div>
              </Card>
            ))
          )}
        </div>

        {/* Job Detail Panel */}
        {!isMobile && (selectedJob ? (
          <Card className="p-4 h-fit sticky top-4 max-h-[calc(100vh-140px)] overflow-y-auto">
            <h3 className="font-semibold text-gray-900 mb-4">{selectedJob.name}</h3>

            <div className="space-y-4">
              <div>
                <p className="text-xs text-gray-500 mb-1">Name</p>
                <input
                  type="text"
                  value={jobForm.name}
                  onChange={(e) => setJobForm({ ...jobForm, name: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  disabled={!canEditJobs}
                />
              </div>

              <div>
                <p className="text-xs text-gray-500 mb-1">Status</p>
                <select
                  value={jobForm.status}
                  onChange={(e) => setJobForm({ ...jobForm, status: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  disabled={!canEditJobs}
                >
                  <option value="active">active</option>
                  <option value="completed">completed</option>
                </select>
              </div>

              <div>
                <p className="text-xs text-gray-500 mb-1">Client</p>
                <input
                  type="text"
                  value={jobForm.client}
                  onChange={(e) => setJobForm({ ...jobForm, client: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  disabled={!canEditJobs}
                />
              </div>

              <div>
                <p className="text-xs text-gray-500 mb-1">Address</p>
                <input
                  type="text"
                  value={jobForm.site_address}
                  onChange={(e) => setJobForm({ ...jobForm, site_address: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  disabled={!canEditJobs}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <p className="text-xs text-gray-500 mb-1">Start Date</p>
                  <input
                    type="date"
                    value={jobForm.start_date}
                    onChange={(e) => setJobForm({ ...jobForm, start_date: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    disabled={!canEditJobs}
                  />
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-1">Target End Date</p>
                  <input
                    type="date"
                    value={jobForm.target_end_date}
                    onChange={(e) => setJobForm({ ...jobForm, target_end_date: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    disabled={!canEditJobs}
                  />
                </div>
              </div>

              <div>
                <p className="text-xs text-gray-500 mb-1">Notes</p>
                <textarea
                  value={jobForm.notes}
                  onChange={(e) => setJobForm({ ...jobForm, notes: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm h-24"
                  disabled={!canEditJobs}
                />
              </div>

              <div>
                <p className="text-xs text-gray-500 mb-2">Job Record Snapshot</p>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between"><span className="text-gray-500">Client</span><span className="font-medium">{selectedJob.client || selectedJob.client_name || '—'}</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">Start Date</span><span className="font-medium">{formatDate(selectedJob.startDate || selectedJob.start_date)}</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">Target End</span><span className="font-medium">{formatDate(selectedJob.targetEndDate || selectedJob.target_end_date || selectedJob.endDate || selectedJob.end_date)}</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">Crew Assigned</span><span className="font-medium">{jobEmployees.length}</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">Equipment Assigned</span><span className="font-medium">{jobEquipment.length}</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">End Date</span><span className="font-medium">{formatDate(selectedJob.targetEndDate || selectedJob.target_end_date || selectedJob.endDate || selectedJob.end_date)}</span></div>
                </div>
              </div>

              <div>
                <p className="text-xs text-gray-500 mb-2">Profitability</p>
                {financialLoading ? (
                  <p className="text-sm text-gray-400">Loading financial summary...</p>
                ) : financialSummary?.visible === false ? (
                  <div data-testid="job-financial-hidden" className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600">
                    Financial data is hidden for your role.
                  </div>
                ) : (
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between"><span className="text-gray-500">Contract</span><span className="font-medium">{currency.format(Number(financialSummary?.contractValue || 0))}</span></div>
                    <div className="flex justify-between"><span className="text-gray-500">Revenue</span><span className="font-medium">{currency.format(Number(financialSummary?.revenueTotal || 0))}</span></div>
                    <div className="flex justify-between"><span className="text-gray-500">Cost</span><span className="font-medium">{currency.format(Number(financialSummary?.spentCost || 0))}</span></div>
                    <div className="flex justify-between"><span className="text-gray-500">Profit</span><span className="font-medium">{currency.format(Number(financialSummary?.profit || 0))}</span></div>
                    <div className="flex justify-between"><span className="text-gray-500">Margin</span><span className="font-medium">{Number(financialSummary?.marginPct || 0).toFixed(2)}%</span></div>
                  </div>
                )}
              </div>

              {renderEquipmentAssignmentSection()}

              {renderCrewAssignmentSection()}

              <AttachmentPanel entityType="job" entityId={selectedJob.id} />

              {jobActionError && (
                <p className="text-sm text-red-600">{jobActionError}</p>
              )}

              <div className="flex items-center gap-2 pt-2">
                <Button
                  variant="brand"
                  size="sm"
                  onClick={handleSaveJob}
                  disabled={!canEditJobs || saveLoading || deleteLoading}
                  data-testid="jobs-save"
                >
                  {saveLoading ? 'Saving...' : 'Save'}
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={handleDeleteJob}
                  disabled={!canEditJobs || saveLoading || deleteLoading}
                  data-testid="jobs-delete"
                >
                  {deleteLoading ? 'Deleting...' : 'Delete'}
                </Button>
              </div>
            </div>
          </Card>
        ) : (
          <Card className="rounded-2xl border border-dashed border-gray-200 bg-gray-50/70 p-8 text-center text-gray-500 shadow-sm">
            <Icon name="hand-pointer" className="mb-3 text-4xl text-gray-300" />
            <p className="font-medium text-gray-600">Job details stay here.</p>
            <p className="mt-1 text-sm text-gray-500">Open a job to review timeline, client info, crew, and notes.</p>
          </Card>
        ))}
      </div>

      {isMobile && showMobileDetails && selectedJob && (
        <>
          <button
            type="button"
            aria-label="Close job details"
            className="fixed inset-0 z-40 bg-black/50"
            onClick={() => setShowMobileDetails(false)}
          />
          <Card className="mobile-sheet-backdrop fixed inset-0 z-50 flex items-end justify-center overflow-hidden rounded-none p-0 sm:items-center sm:justify-center sm:bg-black/0 sm:p-4">
            <div className="mobile-sheet-panel flex min-h-0 max-h-full w-full flex-1 flex-col overflow-hidden bg-white shadow-2xl sm:max-h-[min(90dvh,56rem)] sm:max-w-3xl">
            <div className="mobile-sheet-header mb-0 flex items-start justify-between gap-3 border-b border-gray-200 px-4 pb-4 sm:items-center sm:px-5">
              <h3 className="min-w-0 truncate font-semibold text-gray-900">{selectedJob.name}</h3>
              <button
                type="button"
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-gray-300 text-gray-700"
                onClick={() => setShowMobileDetails(false)}
              >
                <Icon name="xmark" />
              </button>
            </div>
            <div className="mobile-sheet-body min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-4 pb-[max(1rem,var(--safe-area-bottom))] pt-4 sm:px-5 sm:pb-5">
            <div className="min-w-0 space-y-4">
              <div>
                <p className="text-xs text-gray-500 mb-1">Name</p>
                <input type="text" value={jobForm.name} onChange={(e) => setJobForm({ ...jobForm, name: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" disabled={!canEditJobs} />
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">Status</p>
                <select value={jobForm.status} onChange={(e) => setJobForm({ ...jobForm, status: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" disabled={!canEditJobs}>
                  <option value="active">active</option>
                  <option value="completed">completed</option>
                </select>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">Client</p>
                <input type="text" value={jobForm.client} onChange={(e) => setJobForm({ ...jobForm, client: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" disabled={!canEditJobs} />
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">Address</p>
                <input type="text" value={jobForm.site_address} onChange={(e) => setJobForm({ ...jobForm, site_address: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" disabled={!canEditJobs} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <p className="text-xs text-gray-500 mb-1">Start Date</p>
                  <input type="date" value={jobForm.start_date} onChange={(e) => setJobForm({ ...jobForm, start_date: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" disabled={!canEditJobs} />
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-1">Target End Date</p>
                  <input type="date" value={jobForm.target_end_date} onChange={(e) => setJobForm({ ...jobForm, target_end_date: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" disabled={!canEditJobs} />
                </div>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">Notes</p>
                <textarea value={jobForm.notes} onChange={(e) => setJobForm({ ...jobForm, notes: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm h-24" disabled={!canEditJobs} />
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-2">Job Record Snapshot</p>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between"><span className="text-gray-500">Crew Assigned</span><span className="font-medium">{jobEmployees.length}</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">Equipment Assigned</span><span className="font-medium">{jobEquipment.length}</span></div>
                </div>
              </div>
              {renderEquipmentAssignmentSection()}
              {renderCrewAssignmentSection()}
              <AttachmentPanel entityType="job" entityId={selectedJob.id} />
              {jobActionError && <p className="text-sm text-red-600">{jobActionError}</p>}
              <div className="flex items-center gap-2 pt-2">
                <Button variant="brand" size="sm" onClick={handleSaveJob} disabled={!canEditJobs || saveLoading || deleteLoading} data-testid="jobs-save-mobile">
                  {saveLoading ? 'Saving...' : 'Save'}
                </Button>
                <Button variant="danger" size="sm" onClick={handleDeleteJob} disabled={!canEditJobs || saveLoading || deleteLoading} data-testid="jobs-delete-mobile">
                  {deleteLoading ? 'Deleting...' : 'Delete'}
                </Button>
              </div>
            </div>
            </div>
            </div>
          </Card>
        </>
      )}
    </div>
  );
};
