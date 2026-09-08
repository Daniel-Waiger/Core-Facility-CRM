/* consts.js — shared vocabularies (keep in sync with UI) */
window.APP_VERSION = '1.9.0';
window.CONST = {
  // A lab→facility review/billing workflow by default; facilities can add their own via the
  // "+ Add New" vocab flow (DB.vocabList/addVocab), same as every other list here.
  STATUS: ['Initiated', 'Submitted for review', 'Under review', 'Kickoff scheduled', 'Active', 'On-hold', 'Completed', 'Invoiced', 'Paid', 'Archived'],
  PRIORITY: ['Low', 'Medium', 'High'],
  FUNDING: ['NSF', 'NIH', 'DOE', 'Internal', 'Industry', 'Other'],
  ROLE: ['Principal Investigator', 'Co-PI', 'Researcher', 'Postdoc', 'Student', 'Technician', 'Collaborator', 'Other'],
  MODALITY: ['Confocal', 'SEM', 'TEM', 'AFM', 'Light-sheet', 'Super-res', 'Widefield', 'Other'],
  SAMPLE: ['Cells', 'Tissue', 'Biomaterial', 'Materials', 'Other'],
  FLAGS: ['At-risk', 'Blocked', 'Needs-review'],
  PERSON_TYPES: ['Undergrad', 'MSc', 'PhD', 'Postdoc', 'Technician', 'PI', 'Other'],
  INSTRUMENT_STATUS: ['Available', 'In-use', 'Maintenance', 'Down'],
  MS_STATUS: ['pending', 'in-progress', 'done'],
  // How an instrument's cost is priced: 'time' = price per hour (drives off booking start/end);
  // anything else = price per amount the user types in on the booking (e.g. per sample, per gram).
  UNIT: ['time', 'unit', 'weight', 'other'],
  // Consult-type tag on a booking/meeting, so Reports can count consults per instrument/period.
  // Facilities can add their own via the "+ Add New" vocab flow, same as every other list here.
  BOOKING_CATEGORY: ['sync', 'consult', 'training', 'assisted session'],
  // Billing unit for a standalone service entry (roadmap 2.3) — qty is "how many" of this unit,
  // rate is price-per-unit. Distinct from instruments' UNIT (which describes how an INSTRUMENT is
  // priced) since an entry's unit is a literal quantity label shown next to Qty, not a pricing mode.
  SERVICE_UNIT: ['hour', 'sample', 'unit', 'day', 'other'],
  // Research output type on project_outputs (roadmap 3.3) — the funnel's exit stage. Facilities
  // can add their own via the "+ Add New" vocab flow, same as every other list here.
  OUTPUT_TYPE: ['publication', 'acknowledgement', 'dataset', 'other'],
};
