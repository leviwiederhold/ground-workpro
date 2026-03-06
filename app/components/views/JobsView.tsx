/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
'use client';

import { useCallback, useEffect, useState } from 'react';

const confirmDestructiveAction = (targetLabel) => window.confirm(`Delete ${targetLabel}? This cannot be undone.`);
export function JobsView({ jobs, jobsLoading, setJobs, equipment, employees, setEmployees, ui }) {
  const { SearchInput, Card, Button, Icon, Badge, AttachmentPanel, formatDate } = ui;
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

  const handleCreateJob = async () => {
    try {
      const baseCount = jobs.length + 1;
      const response = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `New Job ${baseCount}`,
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
        console.warn('Create job failed', payload?.error || raw || response.statusText);
        return;
      }

      setJobs((prev) => [...prev, payload.job]);
      setSelectedJobId(payload.job.id);
    } catch (error) {
      console.warn('Create job failed', error);
    }
  };

  const normalizeJobStatus = useCallback((status) => {
    const value = String(status || '').trim().toLowerCase();
    if (['in_progress', 'active', 'open', 'approved'].includes(value)) return 'active';
    if (['completed', 'complete'].includes(value)) return 'completed';
    return 'other';
  }, []);

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
    return String(a.name || '').localeCompare(String(b.name || ''));
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

  const getJobCrewCount = useCallback((job) =>
    employees.filter((employee) => String(employee.jobId ?? '') === String(job.id)).length
  , [employees]);

  const getJobEquipmentCount = useCallback((job) =>
    String(selectedJobId ?? '') === String(job.id)
      ? jobEquipment.length
      : equipment.filter((item) => String(item.jobId ?? '') === String(job.id)).length
  , [equipment, jobEquipment.length, selectedJobId]);

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

  const handleAssignEmployee = async () => {
    if (!selectedJob || employeeToAssign.length === 0) return;
    setCrewActionLoading(true);
    setCrewActionError('');
    try {
      const assignedEmployees = [];
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
        assignedEmployees.push(payload.employee);
      }

      setJobEmployees((prev) => [...assignedEmployees, ...prev]);
      setEmployees((prev) => {
        const updatesById = new Map(assignedEmployees.map((employee) => [String(employee.id), employee]));
        return prev.map((employee) => updatesById.get(String(employee.id)) || employee);
      });
      setEmployeeToAssign([]);
    } catch {
      setCrewActionError('Failed to assign employee');
    } finally {
      setCrewActionLoading(false);
    }
  };

  const handleUnassignEmployee = async (employeeId) => {
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

      setJobEmployees((prev) => prev.filter((employee) => String(employee.id) !== String(employeeId)));
      setEmployees((prev) =>
        prev.map((employee) =>
          String(employee.id) === String(employeeId) ? { ...employee, jobId: null } : employee
        )
      );
    } catch {
      setCrewActionError('Failed to remove employee');
    } finally {
      setCrewActionLoading(false);
    }
  };

  const handleAssignEquipment = async () => {
    if (!selectedJob || equipmentToAssign.length === 0) return;
    setEquipmentActionLoading(true);
    setEquipmentActionError('');
    try {
      const assignedEquipment = [];
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
        assignedEquipment.push(payload.equipment);
      }

      setJobEquipment((prev) => [...assignedEquipment, ...prev]);
      setEquipment((prev) => {
        const updatesById = new Set(assignedEquipment.map((item) => String(item.id)));
        return prev.map((item) =>
          updatesById.has(String(item.id)) ? { ...item, jobId: selectedJob.id } : item
        );
      });
      setEquipmentToAssign([]);
    } catch {
      setEquipmentActionError('Failed to assign equipment');
    } finally {
      setEquipmentActionLoading(false);
    }
  };

  const handleUnassignEquipment = async (equipmentId) => {
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

      setJobEquipment((prev) =>
        prev.filter((item) => String(item.id) !== String(equipmentId))
      );
      setEquipment((prev) =>
        prev.map((item) =>
          String(item.id) === String(equipmentId) ? { ...item, jobId: null } : item
        )
      );
    } catch {
      setEquipmentActionError('Failed to remove equipment');
    } finally {
      setEquipmentActionLoading(false);
    }
  };

  const handleSaveJob = async () => {
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

      setJobs((prev) => prev.map((job) => (job.id === selectedJob.id ? payload.job : job)));
    } catch {
      setJobActionError('Failed to save job');
    } finally {
      setSaveLoading(false);
    }
  };

  const handleDeleteJob = async () => {
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

      setJobs((prev) => prev.filter((job) => job.id !== selectedJob.id));
      setSelectedJobId(null);
    } catch {
      setJobActionError('Failed to delete job');
    } finally {
      setDeleteLoading(false);
    }
  };

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
                onClick={() => setSelectedJobId(job.id)}
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
        {selectedJob ? (
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
                />
              </div>

              <div>
                <p className="text-xs text-gray-500 mb-1">Status</p>
                <select
                  value={jobForm.status}
                  onChange={(e) => setJobForm({ ...jobForm, status: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
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
                />
              </div>

              <div>
                <p className="text-xs text-gray-500 mb-1">Address</p>
                <input
                  type="text"
                  value={jobForm.site_address}
                  onChange={(e) => setJobForm({ ...jobForm, site_address: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
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
                  />
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-1">Target End Date</p>
                  <input
                    type="date"
                    value={jobForm.target_end_date}
                    onChange={(e) => setJobForm({ ...jobForm, target_end_date: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div>
                <p className="text-xs text-gray-500 mb-1">Notes</p>
                <textarea
                  value={jobForm.notes}
                  onChange={(e) => setJobForm({ ...jobForm, notes: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm h-24"
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
                <p className="text-xs text-gray-500 mb-2">Assigned Equipment ({jobEquipment.length})</p>
                <div className="flex items-center gap-2 mb-2">
                  <select
                    value={equipmentToAssign}
                    multiple
                    onChange={(e) => {
                      const selectedIds = Array.from(e.target.selectedOptions).map((option) => option.value);
                      setEquipmentToAssign(selectedIds);
                    }}
                    className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  >
                    {availableEquipment.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name} - {item.type}
                      </option>
                    ))}
                  </select>
                  <Button variant="secondary" size="sm" onClick={handleAssignEquipment} disabled={equipmentActionLoading || equipmentToAssign.length === 0}>
                    Add
                  </Button>
                </div>
                <div className="space-y-1">
                  {jobEquipmentLoading ? (
                    <p className="text-sm text-gray-400">Loading equipment...</p>
                  ) : jobEquipment.map(eq => (
                    <div key={eq.id} className="flex items-center justify-between text-sm p-2 bg-gray-50 rounded">
                      <span>{eq.name}</span>
                      <div className="flex items-center gap-2">
                        <Badge variant="success" className="text-xs">Active</Badge>
                        <button
                          type="button"
                          onClick={() => handleUnassignEquipment(eq.id)}
                          className="text-xs text-red-600 hover:text-red-700"
                          disabled={equipmentActionLoading}
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

              <div>
                <p className="text-xs text-gray-500 mb-2">Assigned Crew ({jobEmployees.length})</p>
                <div className="flex items-center gap-2 mb-2">
                  <select
                    value={employeeToAssign}
                    multiple
                    onChange={(e) => {
                      const selectedIds = Array.from(e.target.selectedOptions).map((option) => option.value);
                      setEmployeeToAssign(selectedIds);
                    }}
                    className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  >
                    {availableEmployees.map((employee) => (
                      <option key={employee.id} value={employee.id}>
                        {employee.name} - {employee.role}
                      </option>
                    ))}
                  </select>
                  <Button variant="secondary" size="sm" onClick={handleAssignEmployee} disabled={crewActionLoading || employeeToAssign.length === 0}>
                    Add
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
                          disabled={crewActionLoading}
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

              <AttachmentPanel entityType="job" entityId={selectedJob.id} />

              {jobActionError && (
                <p className="text-sm text-red-600">{jobActionError}</p>
              )}

              <div className="flex items-center gap-2 pt-2">
                <Button
                  variant="brand"
                  size="sm"
                  onClick={handleSaveJob}
                  disabled={saveLoading || deleteLoading}
                  data-testid="jobs-save"
                >
                  {saveLoading ? 'Saving...' : 'Save'}
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={handleDeleteJob}
                  disabled={saveLoading || deleteLoading}
                  data-testid="jobs-delete"
                >
                  {deleteLoading ? 'Deleting...' : 'Delete'}
                </Button>
              </div>
            </div>
          </Card>
        ) : (
          <Card className="p-8 text-center text-gray-500">
            <Icon name="hand-pointer" className="text-4xl mb-2 text-gray-300" />
            <p>Select a job to view details</p>
          </Card>
        )}
      </div>
    </div>
  );
};
