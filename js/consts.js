/* consts.js — shared vocabularies (keep in sync with UI) */
window.APP_VERSION = '1.3.0';
window.CONST = {
  STATUS: ['Draft', 'Submitted', 'Under Review', 'Revisions Requested', 'Kick-off Scheduled', 'Active', 'On-hold', 'Completed', 'Archived'],
  PRIORITY: ['Low', 'Medium', 'High'],
  FUNDING: ['NSF', 'NIH', 'DOE', 'Internal', 'Industry', 'Other'],
  ROLE: ['Principal Investigator', 'Co-PI', 'Researcher', 'Postdoc', 'Student', 'Technician', 'Collaborator', 'Other'],
  MODALITY: ['Confocal', 'SEM', 'TEM', 'AFM', 'Light-sheet', 'Super-res', 'Widefield', 'Other'],
  SAMPLE: ['Cells', 'Tissue', 'Biomaterial', 'Materials', 'Other'],
  FLAGS: ['At-risk', 'Blocked', 'Needs-review'],
  PERSON_TYPES: ['Undergrad', 'MSc', 'PhD', 'Postdoc', 'Technician', 'PI', 'Other'],
  INSTRUMENT_STATUS: ['Available', 'In-use', 'Maintenance', 'Down'],
  MS_STATUS: ['pending', 'in-progress', 'done'],

  /* ---------------- Lab ↔ Facility workflow (v1.3.0) ---------------- */
  SIDES: ['lab', 'facility'],
  CONTAINER_KIND: 'core-facility-project-container',
  CONTAINER_VERSION: 1,

  // Per-status display metadata. `phase` groups statuses for the pipeline strip / dashboard
  // framing: 'submission' = still in the lab<->facility handoff, 'execution' = day-to-day work.
  STATUS_META: {
    'Draft': { badge: 'neutral', phase: 'submission' },
    'Submitted': { badge: 'primary', phase: 'submission' },
    'Under Review': { badge: 'warning', phase: 'submission' },
    'Revisions Requested': { badge: 'danger', phase: 'submission' },
    'Kick-off Scheduled': { badge: 'primary', phase: 'submission' },
    'Active': { badge: 'primary', phase: 'execution' },
    'On-hold': { badge: 'warning', phase: 'execution' },
    'Completed': { badge: 'success', phase: 'execution' },
    'Archived': { badge: 'neutral', phase: 'execution' },
  },

  // The status state machine. `side` says who is allowed to trigger the transition in that
  // side's UI: 'lab', 'facility', or 'any'. `label` is the button text.
  TRANSITIONS: [
    { from: 'Draft', to: 'Submitted', side: 'lab', label: 'Submit to Facility' },
    { from: 'Submitted', to: 'Draft', side: 'lab', label: 'Withdraw' },
    { from: 'Submitted', to: 'Under Review', side: 'facility', label: 'Start Review' },
    { from: 'Under Review', to: 'Revisions Requested', side: 'facility', label: 'Request Revisions' },
    { from: 'Under Review', to: 'Kick-off Scheduled', side: 'facility', label: 'Schedule Kick-off' },
    { from: 'Under Review', to: 'Active', side: 'facility', label: 'Activate (fast-track)' },
    { from: 'Revisions Requested', to: 'Submitted', side: 'lab', label: 'Resubmit' },
    { from: 'Kick-off Scheduled', to: 'Active', side: 'any', label: 'Activate' },
    { from: 'Active', to: 'On-hold', side: 'any', label: 'Put On-hold' },
    { from: 'On-hold', to: 'Active', side: 'any', label: 'Resume' },
    { from: 'Active', to: 'Completed', side: 'facility', label: 'Mark Completed' },
    { from: 'Completed', to: 'Archived', side: 'any', label: 'Archive' },
    { from: 'Archived', to: 'Active', side: 'facility', label: 'Reopen' },
    { from: 'Completed', to: 'Active', side: 'facility', label: 'Reopen' },
  ],
};
