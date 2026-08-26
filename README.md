# Core Facility Project Tracker & CRM

A portable, standalone web application tailored for microscopy, bioimaging, flow cytometry, and scientific image-analysis core facilities.

Track research projects from initiation to completion with full lifecycle tracking, milestone deliverables, equipment allocation, team management, consultation notes, and one-click report exports (XLSX, DOCX, and multi-page PDF).

---

## Key Features

- **Zero-Install & Zero-Server:** Runs instantly on PC, Mac, Linux, and tablets by opening `index.html` directly in modern web browsers (Chrome, Edge, Firefox, Safari). No Node.js, Python, or local server required.
- **Embedded SQLite Database:** Uses `sql.js` (asm.js single-file build) backed by browser `IndexedDB` storage with automatic debounced autosave.
- **Welcome & Onboarding Experience:**
  - **Seeded Example & Walkthrough:** Load a realistic bioimaging facility dataset (Multiphoton, STED, Lightsheet, etc.) with an interactive step-by-step tour.
  - **Start Fresh (Empty Workspace):** One-click initialization of a clean, empty database ready for direct entry.
- **Full CRUD Capabilities:**
  - **Projects:** Title, unique project code generation (`PRJ-YYMM-###`), status lifecycle (`Initiated` → `Active` → `On-hold` → `Completed` → `Archived`), priority, funding sources, modality/techniques, sample types, risk flags, timelines, tags, and notes. Includes inline researcher/PI registration.
  - **Milestones:** Deliverables with due dates, notes, assigned staff/collaborators, assigned instruments, and single-click status cycling (`pending` → `in-progress` → `done`). Overall project progress is automatically derived.
  - **Team & Lab Registry:** Principal Investigators, lab members, postdoctoral fellows, students, and core technicians with Lab/Group/Company affiliations.
  - **Core Instruments:** Microscopes, cytometers, workstations, and equipment tracking with operational status (`Available`, `In-use`, `Maintenance`, `Down`).
  - **Meetings & Consultations:** Consultation notes, known attendee tagging with lab affiliations, inline attendee registration, discussion summaries, and next step action items.
  - **Custom Metadata (KV):** Extensible project attributes (e.g. grant numbers, ethics protocol IDs, billing codes).
  - **Attachments & Links:** Local file storage (embedded safely in IndexedDB) and network/cloud link management.
- **Interactive Derived Calendar:** 7-day monthly schedule grid showing upcoming milestone deadlines and consultation meetings with direct navigation and "Today" quick view.
- **Collapsible Navigation & Adaptive Theme:** Compact icon-only sidebar mode and smart next-theme switcher (`🌙 Dark Mode` / `☀️ Light Mode`).
- **Search & Live Filtering:** Search by project title, code, PI name, modality, funding, sample type, or tags.
- **Multi-Format Report Export:**
  - **XLSX:** Comprehensive multi-sheet workbook (Overview, Milestones, Team, Instruments, Meetings, Files) via SheetJS.
  - **DOCX:** Formatted Word document summary via `docx`.
  - **PDF:** Multi-page paginated report with headers, footers, and page numbers via `jsPDF`.
- **Single-File Backup & Recovery:** Export your entire facility database into a self-contained `.json` backup file and restore it on any machine anytime.
- **Modern SaaS Minimalist UI:** Hand-written CSS design system with Dark/Light theme switching, toast feedback, custom brand favicon, and guided onboarding tour.

---

## Screenshots

**Onboarding & first run**

<img src="docs/screenshots/01-onboarding.png" width="720" alt="Welcome onboarding modal">

*Figure 1 — The startup modal offers a seeded demo dataset with a guided walkthrough, or a clean empty workspace.*

**Dashboard, theming & layout**

<img src="docs/screenshots/02-dashboard.png" width="720" alt="Dashboard overview">

*Figure 2 — Facility Dashboard: at-a-glance KPI counters (total/active projects, overdue milestones, completed) plus upcoming and overdue milestone feeds.*

<img src="docs/screenshots/02b-sidebar-collapsed.png" width="720" alt="Collapsed icon-only sidebar">

*Figure 3 — The sidebar collapses to an icon-only rail to maximize working canvas width.*

<img src="docs/screenshots/02c-light-theme.png" width="720" alt="Light theme">

*Figure 4 — One-click Dark/Light theme switching across the entire UI.*

**Projects registry**

<img src="docs/screenshots/03-projects-registry.png" width="720" alt="Projects registry with search and filters">

*Figure 5 — Projects Registry with live search and filtering by modality, lifecycle status, and priority.*

**Project detail**

<img src="docs/screenshots/04-project-header.png" width="720" alt="Project header with status lifecycle and export actions">

*Figure 6 — Project header: unique project code, PI, timeline, priority/status badges, one-click lifecycle stage buttons, and inline XLSX/DOCX/PDF export/delete actions.*

<img src="docs/screenshots/06-metadata-tags.png" width="420" alt="Metadata and custom fields"> <img src="docs/screenshots/07-team-collaborators.png" width="420" alt="Team and collaborators">

*Figure 7 — Left: funding, modality, sample type, tags, and extensible custom key-value metadata (e.g. laser wavelength, biosafety level, grant account). Right: team & collaborator roster with roles and inline contact info.*

<img src="docs/screenshots/08-assigned-instruments.png" width="720" alt="Assigned instruments">

*Figure 8 — Instruments assigned to a project, with live operational status badges.*

<img src="docs/screenshots/09-milestones.png" width="720" alt="Milestones and deliverables timeline">

*Figure 9 — Milestones & Deliverables timeline: due dates, status (done/in-progress/pending/overdue), and assigned owners/instruments per deliverable. Clicking a status node cycles its state.*

<img src="docs/screenshots/10-meetings.png" width="720" alt="Meetings and consultation notes">

*Figure 10 — Consultation meeting notes with attendee tagging and next-step action items.*

**People, instruments & scheduling**

<img src="docs/screenshots/11-people-labs.png" width="720" alt="People, labs and researchers directory">

*Figure 11 — People, Labs & Researchers directory: PIs, postdocs, students, and core staff with lab/organization affiliations and active project counts.*

<img src="docs/screenshots/12-instruments.png" width="720" alt="Core instruments inventory">

*Figure 12 — Core Instruments inventory with operational status (Available, In-use, Maintenance, Down) and imaging modality.*

<img src="docs/screenshots/13-calendar.png" width="720" alt="Derived monthly calendar">

*Figure 13 — Interactive derived calendar combining milestone deadlines and scheduled consultations.*

**Settings & data portability**

<img src="docs/screenshots/14-settings.png" width="720" alt="Settings, backup and theme preferences">

*Figure 14 — Settings: single-file JSON backup/restore, sample data reload, and appearance preferences — all data stays local to the browser's IndexedDB.*

---

## Directory Structure

```text
Core-Facility-CRM/
├── index.html          # Application entry point
├── favicon.svg         # Brand logo favicon
├── css/
│   └── app.css         # Modern SaaS Minimalist design system
├── js/
│   ├── consts.js       # Shared vocabularies (modalities, statuses, priorities)
│   ├── db.js           # sql.js engine, schema, IndexedDB persistence, sample dataset & clear
│   ├── ui.js           # Toasts, modals, theme switcher, icons, interactive tour engine
│   ├── views.js        # Screen renderers (Dashboard, Projects, Detail, People, Instruments, Calendar, Settings)
│   ├── exports.js      # Multi-page PDF, DOCX, and XLSX export engines
│   └── app.js          # Routing, startup welcome modal, action dispatcher, CRUD modal logic
├── libs/
│   ├── sql-asm.js      # SQLite engine compiled to JS (asm.js, file:// compatible)
│   ├── xlsx.full.min.js# SheetJS spreadsheet export engine
│   ├── jspdf.umd.min.js# Client-side PDF generation engine
│   └── docx.iife.js    # Client-side DOCX document generator
├── LICENSE             # MIT License
└── README.md           # Documentation
```

---

## Quick Start

1. Download or clone this repository.
2. Double-click `index.html` to open it in your browser.
3. Choose **Load Demo & Start Tour** to explore with sample data or **Start Fresh** to begin with an empty database.
4. Click **"New Project"** in the sidebar to start tracking projects!

---

## Data Safety & Privacy

All project data, attachments, and metadata remain **100% local to your machine**. No data is ever sent to external cloud servers or third parties. Regular backups can be downloaded anytime via **Settings → Export Backup**.

---

## License

This project is open source under the [MIT License](LICENSE).
