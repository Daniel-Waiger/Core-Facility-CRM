# Changelog

All notable changes to Core Facility Tracker are documented here.
This project uses [Semantic Versioning](https://semver.org/).

## [1.11.0] — 2026-09-12

An adversarial review of the whole app — every screen driven in a real browser, the money and
report rules re-derived from the code, every fix then re-checked by an independent pass — turned
up a set of defects that had survived because no test reached them. This release closes them. The
data-safety fixes come first; the rest is the report layer telling the truth, dialogs that behave,
and phone-width layout.

### Added
- **Restoring a backup now shows a preview first.** Before anything is replaced you see how many
  projects, people, instruments, bookings and milestones are in your current data versus the file,
  when the backup was made and its most recent booking date. A backup made in the demo sandbox is
  refused in your real facility data (restoring it into the sandbox itself is still fine).
- **A second browser tab on the same data is read-only.** Two tabs used to race each other and
  whichever saved last silently won. A second tab now shows a banner on every screen, refuses to
  save, and if the tab that was saving is closed, the other one reloads from the last save before
  taking over — so it can never overwrite a save it never saw. Restoring a backup is refused in a
  read-only tab for the same reason.
- **Booking an instrument marked Maintenance or Down now warns you** — live while filling in the
  form, and with a confirmation before the booking is saved. It never blocks the booking.
- **A Notes sheet in the facility-wide spreadsheet export**, matching the Reports export,
  explaining the "(Retired)" suffix, what a waived cancellation shows, and why Overhead % is blank
  on a booking priced before pricing tiers existed.
- **Two new columns on the facility-wide Bookings & Costs sheet**, Overhead % and Effective Tax %,
  so a row's Subtotal → Before Tax → Total math can be checked without the app open. The last
  money column is now labelled "Charged Total" so a waived cancellation's zero does not read as a
  broken calculation. Existing columns keep their meaning.
- **The PDF project report renders Hebrew, Cyrillic and Greek.** A Hebrew PI or lab name used to
  print as garbage because the built-in PDF font only knows Western Latin. The report now embeds
  Open Sans (shipped with the app, so it works offline too) and draws right-to-left names in
  reading order, parentheses included. Arabic script is not covered by that font.

### Changed
- **Saves are all-or-nothing.** Every save that writes more than one thing at once — a booking and
  its attendees, instruments and staff; a milestone and its owners; a project and its PI; an
  instrument and its supervisors and rates; a grant and its people — now either lands completely
  or not at all. If something goes wrong midway the app says so and leaves the dialog open with
  your input, instead of failing silently with a half-written record.
- **Reports & Utilization is three to four times faster** on a large booking history: the screen
  reads the period's bookings once and every card works from that, and typing a date waits for a
  short pause instead of recalculating on each keystroke.
- **A saved booking's cost stays exactly as billed** unless something that affects price changes
  (instruments, staff time, times, discount, category, or the assigned lab/tier). Editing only the
  notes or next steps no longer silently reprices it at today's rates. Stored money is rounded to
  the cent, service entries included.
- **"Billed Revenue" and "Staff Revenue" are now "Line Charges"** — on the Reports screen, the
  Stewardship scorecard, the Custom Report builder, the exports and the manual — with a note that
  this is the raw per-line figure taken *before* discount, overhead and tax, so it will not match
  Total Cost. The numbers are unchanged; the old name implied they were something they were not.
- **The Staff × Instrument matrix gained a "No Instrument" column** for staff time on a booking
  with no instrument attached (a pure consult or sync). That time used to be dropped, so a
  person's row could add up to less than their real total.
- **Dialogs behave like dialogs.** Focus moves into a dialog when it opens (on a delete, retire or
  archive confirmation, onto the safe Cancel button), Tab stays inside it, Enter in a single-line
  field saves it, and navigating to another screen closes any open dialog rather than leaving it
  floating over the wrong record. Focus then lands on the new screen's heading.
- **Negative and out-of-range numbers are refused with a message** — rates, costs, quantities,
  durations, discounts, tax and category percentages — instead of being quietly stored. A negative
  discount used to *add* money to a booking.
- **Milestone status dropdowns show "Pending", "In Progress", "Done"** instead of the raw stored
  values. Every date in the app, including the Email Attendees subject, now uses one fixed format,
  matching the fixed money format introduced in 1.10.2.
- **Wording:** Project Detail's booking card, its button and Today's Agenda's quick-log button all
  say "Booking"; the Edit Booking dialog's dismiss button is "Close" so it no longer sits beside
  "Cancel Booking"; the Grants table says in plain text that "Allowed Users" is for reference and
  does not restrict who can be picked; the Settings startup checkbox reads in the same sense as the
  welcome screen's; the calendar's "Today" button no longer looks like the active view.

### Fixed
- **Restoring a corrupted, empty or unrelated file could break the app for good.** Such a file was
  accepted, overwrote your data, and left every screen unusable with no way back except clearing
  the browser's storage. Bad files are now rejected up front and your data is left untouched.
- **An edit made just before closing a tab could be lost.** Changes now also save the moment a tab
  is closed or hidden. If a save to this browser's storage fails, the indicator says so, the app
  retries every few seconds, and it warns once per run of failures rather than staying silent.
- **Saving from a dialog opened on top of another one did nothing.** Logging or editing a booking
  or milestone from inside Today's Agenda read the agenda's form instead of its own, failed with no
  message and stayed open. Every dialog now saves the form you are actually looking at.
- **Adding a milestone or an instrument could stall after the record was created**, leaving the
  dialog open with its assignments unsaved.
- **Editing a cancelled booking failed once its old slot had been re-booked.** A note can now be
  added to a cancelled booking regardless of what took its slot.
- **Renaming a person left the old name on every booking that listed them.** Changing a project's
  Principal Investigator left the old PI with the PI role and never gave it to the new one.
- **Deleting the two default pricing tiers brought them back on the next load.** Renaming a lab
  left its old name in every lab picker.
- **The archive dialog's "billing carried" figure counted waived charges** that Project Costs shows
  as zero. A booking could be saved without a date and then vanish from the calendar and reports
  while still counting in Project Costs.
- **Deleted attachments lingered in the browser's storage and shipped in every backup.** They are
  now removed with the record, and by Clear All Data.
- **The facility-wide spreadsheet omitted "(Retired)"** on the Milestones and Bookings & Costs
  sheets, unlike every other export. **Word and PDF reports printed unrounded money** with no
  currency, and printed a waived cancellation's full charge where the spreadsheet showed zero. The
  PDF also used two symbols its built-in font cannot draw.
- **A project or milestone created late at night landed in the wrong month** in the Reports funnel
  at the facility's own clock — the issue #14 class of bug, in a timestamp this time. A lab name
  with a trailing space counted twice toward "New Labs Onboarded".
- **Dashboard "Upcoming Milestones" listed overdue milestones too**, and with enough of them the
  genuinely upcoming ones were pushed off the list. Overdue items now appear only in Overdue.
- **Phone width:** the demo banner no longer takes a third of the screen; the Edit Booking dialog's
  buttons no longer run off the right edge; row action buttons are big enough to tap; long email
  addresses wrap instead of being cut off; faint text (table headings, dates, hints) now meets the
  accessibility contrast guideline in both themes. The week view opens at 07:00 instead of
  midnight, and a short booking on the Timeline shows its start time instead of shrinking to a
  sliver showing only an icon. Today's Agenda's card is titled "Bookings Today", since it lists every
  category of booking.
- **Custom status values and a person's role were rendered without escaping** in a few places, as
  was the instrument name in the new Maintenance/Down confirmation. Both are now displayed safely.
- **A required-field message now also outlines the field it refers to**, not only a toast in the
  corner. The "Category" label in the booking form no longer truncates to "Categ…": the "+ Add New"
  button beside it shortens to "+ Add" only when its column is too narrow for both.
- **From the review of this release's own changes:** every dialog now carries a name a screen
  reader announces; a booking's subtotal always equals the sum of the lines shown under it (it
  could differ by a cent); Billing Rates, Group Discounts & Tiers and Category Billing save all
  their fields or none; a new booking refuses a cleared date instead of silently using today; the
  safety backup before a restore and the daily automatic backup are no longer skipped for a
  facility whose data is only bookings, milestones, grants or service entries; an undated
  research output logged late in the day lands on the right local day in the funnel; and on the
  Timeline, back-to-back and untimed bookings no longer hide one another.
- The manual: four pages still said "Load Sample Data"; the Backups chapter promised Word tables
  the export never had; the Reports chapter's "Try it" for the matrix promised a total that did not
  hold; the Instruments page said a Down instrument booked with no warning.

### Known and deferred
- The PDF's right-to-left handling is a targeted fix for the names and notes this report draws,
  not a full text engine, and the embedded font has no Arabic glyphs, so Arabic text still does
  not display correctly (unchanged from before).
- The facility-wide spreadsheet's Bookings & Costs sheet still runs one name lookup per row for
  instruments and staff, so "Export All" on a very large history takes a couple of seconds.

## [1.10.2] — 2026-09-10

### Fixed
- **The Settings button offering sample data said the wrong thing.** It still read "Load Sample
  Data" after that action changed to open the practice sandbox in a new tab, so the button named
  something it no longer did — the same kind of mismatch this release set out to remove. It now
  reads "Open Demo Sandbox", matching the welcome screen.
- **On the welcome screen, a stray click could start a delete.** "Start Fresh" was clickable
  across its whole card while the sandbox option needed a precise click on its button, so the
  larger, easier-to-hit target was the one that erases everything. Both options now activate only
  from their own button.
- **Removed "Back to Real App" from the sandbox banner.** It opened your real records in the demo
  tab while the tab you came from was almost certainly still showing them — and two copies of the
  app open at once can overwrite one another's edits, since whichever saves last wins. Closing the
  sandbox tab returns you to your records untouched, which is what the explanation now says.

- **A browser test believed it was covering the admin-only Settings screens and was not.** The
  suites set the app's preferences under plain keys, but a sandbox tab reads them under its own
  prefixed names, so the flags were ignored there — including the one that turns Admin Mode on.
  The group-discount and rename-lab editors were therefore never displayed during the run, and
  nothing failed, because nothing checked. The flags are now written under both names, and the
  test asserts those editors really are on screen, so the coverage is a claim rather than an
  assumption. No effect on the app itself.
- **The welcome screen stayed open behind the demo sandbox.** Opening the sandbox from the
  welcome screen launches a new tab, which means the original tab is never navigated away — so
  the welcome screen sat there in front of the app, waiting to be dismissed by hand, and the
  first-run explanation of where your data lives never appeared on that path even though every
  other way out of that screen shows it. Picking the sandbox now clears the welcome screen and
  shows that notice, the same as choosing Start Fresh does.
- **Money and hours no longer change shape depending on who is looking.** Both were formatted
  without pinning a locale, so the figures followed each viewer's browser rather than the
  facility's settings — and the difference is not cosmetic: the same total reads `$1,234,567.50`
  for one person and `$1.234.567,50` for another, `$1 234 567,50` for a third, or
  `$12,34,567.50` where digits group in lakhs. A period standing in for the thousands separator
  beside a configured `$` is actively misleading, and two people reading one invoice figure should
  not see two different numbers. Both now format identically everywhere, which also keeps an
  export or a printed report the same whoever generated it. Raised in review on
  [#42](https://github.com/Daniel-Waiger/Core-Facility-CRM/pull/42), and now covered by tests that
  re-run the formatter under five locales — the only way to catch it, since a locale is fixed when
  a process starts.

## [1.10.1] — 2026-09-10

### Added
- **A test suite, runnable on a bare copy of the repo.** Node's built-in runner needs no
  `package.json` and no install, so the zero-install design is intact: `node --test
  'test/unit/*.test.js'` covers the billing calculator (the 1-hour staff floor, the discount
  applying only to time-billed instrument cost, the subtotal → discount → overhead → tax order,
  and the 490 / 546.25 / 589.95 figures a seeded booking has to reproduce), the local-calendar-day
  date rules that caused issue #14, the database invariants this project had verified once by hand
  (the `foreign_keys` pragma that `db.export()` silently clears, every cascade, the `projects.pi_id`
  gap cascade cannot cover, retire/archive, cancellation billing, and the denormalized attendee
  string staying in step with its join table), and the Reports aggregations agreeing with the
  booking modal. A second group guards the wiring this app is built on: every `data-act` has a
  handler and every handler an emitter, every icon name resolves, no file reintroduces the
  UTC date bug, and the version strings stay in step. Browser checks — the demo sandbox
  isolation guarantee, all seven screens rendering, and the note sanitizer — live apart and skip
  cleanly when Playwright is absent. Everything runs on GitHub for pushes and pull requests.

### Fixed
- **Two backup and export filenames could be stamped with yesterday's date.** Both built their
  date from `toISOString()`, which re-describes the moment in UTC — so anywhere east of Greenwich,
  a file saved shortly after midnight was labelled with the previous day. For the silent automatic
  backup this was not cosmetic: the filename is what identifies the day's backup, so the misdated
  file **overwrote the previous day's backup** instead of joining it. The "Export All" spreadsheet
  had the same flaw in its filename. Both now use the same local-calendar-day helper as the rest
  of the app. Found by the new date-rule check on its first run.

## [1.10.0] — 2026-09-10

### Changed
- **Sample data can no longer touch your real records — it opens in its own sandbox.** Loading
  the demo dataset used to erase everything first: every project, person, instrument, milestone
  and booking, with no confirmation, from a Settings button captioned "Load Sample Data" — while
  the manual promised in bold that it "does not erase your own projects". The demo now runs as a
  **demo sandbox** in its own browser tab, against storage of its own, and the real records are
  never opened by that tab at all. Practice edits are kept, so you can come back to them; a
  Reset control restores the sandbox to its original state. The sandbox never writes automatic
  backups either, since both modes name their backup files identically and a demo write could
  otherwise overwrite the day's real backup. The old destructive path is now unreachable rather
  than merely unused: seeding refuses outright unless it is running in the sandbox, checked as
  the first thing it does.
- **One money formatter for the whole app.** The booking modal and the Reports screen each had
  their own, and they disagreed at exact half-cent values — 2.675 printed as 2.67 in the modal
  and 2.68 in Reports. Both now read the single copy in `js/ui.js`, resolving it in favour of
  Reports; money also gains thousands separators in the booking modal (`$1,250.00`). Stored
  values are untouched — this is display only.
- **"Booking" everywhere for the scheduled record**, instead of alternating between "booking" and
  "meeting" — the project page called it a meeting while its own dialog called it a booking, and
  one Reports footnote managed both in a single sentence. "Meeting notes" survives where it
  genuinely means the notes. Database tables and export sheet names keep their existing spelling,
  being data rather than display. Display text likewise settles on "Utilization".
- **Plainer wording in three places aimed at the wrong audience:** the one permanently visible
  tooltip said "Real-time SQLite autosave status"; a Settings row was headed "Startup Welcome
  Modal"; and the storage-failure screen sent readers to a README they cannot reach from the app,
  now pointing at the user manual instead.
- **Danger dialogs name their verb.** Four of them rendered a generic "Confirm" against the
  project's own rule, including Clear All Data and Start Fresh, which now read "Delete
  Everything".

### Fixed
- **The People and Instruments project counts said "active" while counting archived projects.**
  Both counts now exclude archived projects, so the number matches the label — which matters
  precisely for the records the archive feature exists to preserve.
- **Instrument cost, billing unit and staff hourly rate showed no currency.** A rate read as a
  bare `450` next to a raw lowercase `time`, with no way to tell it meant 450 per hour in the
  configured currency. Spreadsheet exports keep the figure a sortable number and put the currency
  symbol in the column heading instead.
- **Settings referred to an overhead percentage it never showed you.** Four strings explained
  that a lab with no pricing tier is charged "the legacy Internal + External overhead sum", but
  those two rates are not editable or displayed anywhere, so the number behind them was
  invisible — while still being added to every such booking. The resolved percentage is now
  stated, read-only, in Billing Rates. Pricing behaviour is unchanged.
- **Empty lists blamed a filter that was not set.** A brand-new tracker opened Projects and was
  told "No matching projects", implying something to clear. The three registry screens now
  distinguish an empty tracker from a filtered one — including the case where rows are hidden
  behind the archived or retired toggle, where no filter is set at all.
- **The guided tour described a sidebar that did not exist**, listing Settings (which is in the
  footer) while omitting Dashboard and Reports. Its 19 step titles also carried hand-written
  numbers duplicating the counter the tour already draws, and it still described clicking a
  milestone badge to "cycle" its status, replaced by a status picker several releases ago.
- **The first-run notice named a button that does not exist**, telling users to use "Import
  Backup" on the other device. The button is "Restore from Backup".
- **The manual documented the old, destructive sample-data behaviour** — in a warning callout, a
  self-test answer, a glossary entry, the chapter blurb and twenty-odd "Try it" exercises — and
  in one place advised a reader who already held real data to press Start Fresh, which deletes
  everything. Rewritten around the sandbox. A cross-reference pointing chapter 12 at the Reports
  chapter (it is chapter 13) is corrected.

## [1.9.1] — 2026-09-09

### Changed
- **One capitalization rule for UI text, written down and applied.** Controls and column
  headings are Title Case (buttons, table headers, form labels, tab and nav items, dialog and
  card titles); anything that reads as a sentence — help text, placeholders, toasts,
  confirmation bodies, empty states, validation messages — stays sentence case. The rule, its
  lowercase-joining-word list, and the trap that makes it dangerous (plenty of visible strings
  are also data: vocabulary values, `data-act` names, XLSX sheet names, anything compared with
  `===`) are recorded in `CLAUDE.md`. Applied to the stragglers only; strings that already
  complied were left byte-for-byte alone, and every candidate was grepped across `js/` first to
  confirm nothing compares or stores it. Where the same control appears on two screens — the
  service-entry actions on Project Costs and on the Reports screen — both copies move together,
  and the four places the docs quoted a label by name were updated with it.
- **The user manual covers the app as it is, not as it was in 1.5.x.** Four releases had passed
  it by. `bookings` gains the month/week/timeline views and what each pre-fills, recurring
  bookings with their 52-occurrence cap, per-instrument limits, and booking categories — and
  drops a claim that had gone flatly false, that conflicts are "only caught when you save".
  `reports` grows from four cards to ten plus charts and the custom report builder.
  `settings-admin` gains pricing tiers, category billing, grants and cancellation billing rules.
  `costs-math` corrects the overhead step, which described the pre-tier calculation.
  `cancelling` stops stating the charge rule as law now that it is a per-facility setting.
  `projects` documents research outputs. A new **Service Entries** chapter covers billable work
  outside a booking. The glossary corrects "Conflict" and "Overhead" and defines five terms the
  app had gained without them. Written for facility managers: no CRUD, schema or join tables.
- **README speaks plainly.** "Full CRUD Capabilities" and "Custom Metadata (KV)" were developer
  shorthand on the page that decides whether a facility tries the app at all.

### Fixed
- **A code comment claimed authority it did not have.** `js/reports.js` justified computing two
  time-in-stage medians instead of one per stage transition with "per the roadmap spec". The
  roadmap said no such thing. The comment now names it as the deliberate narrowing it is, and
  the roadmap records it on item 3.3 — as does 3.4's maintenance slice and 3.2's two columns
  that wait on Tier 4 data.
- **Two manual claims a reader could have been burned by.** The Grants section said the
  "Allowed Users" list controls who can be picked when that grant is chosen — it controls
  nothing; the grant stays pickable by anyone, and the list is a record, not a lock. And a
  "Try it" exercise asserted that reopening a booking after a tax change leaves its total
  unmoved; the edit form's breakdown panel always prices at today's rates, so the exercise
  showed the opposite of what it promised. Both corrected, along with the note that a lab
  rename also moves (or, on a merge, discards) the lab's pricing-tier assignment — which
  changes what its future bookings cost.
- **The Reports export told you to look for a label that does not exist.** Both Notes sheets
  stated that archived projects appear with an "(Archived)" suffix. Nothing in the app has ever
  written one — `UI.retiredName` appends "(Retired)" and there is no archived equivalent — so an
  archived project sits in a report under its ordinary name. The note now says that, and the
  manual says it too.
- **Manual chapter numbers agree with the manual's own registry.** Inserting Service Entries as
  chapter 11 shifted six chapters, and each page carries its number twice — once in
  `manual.js`, once hardcoded in the page. All 17 now match, verified programmatically.

## [1.9.0] — 2026-09-08

### Added
- **Instrument stewardship scorecard (roadmap 3.2).** Reports & Utilization gains a new card,
  grouped by supervising staff, showing per-instrument bookings, hours, revenue, distinct/new
  users, projects served, facility-wide sessions, and consults; exported to XLSX as a matching
  "Stewardship" sheet.
- **Breadth and activity-mix views (roadmap 3.4).** Reports & Utilization gains a Breadth card
  (distinct labs/people served and new labs onboarded per period, per instrument, occupancy-rule
  scoped) with an opt-in, off-by-default per-lab consult attribution table, and an Activity Mix
  card breaking down facility hours by booking category per period; both export to XLSX as
  matching "Breadth" and "Activity Mix" sheets (the lab-consult sheet only when the toggle is on).
- **Funnel analysis with project outputs (roadmap 3.3).** A new `project_outputs` entity
  (publication/acknowledgement/dataset/other, with a "Research Outputs" card and add/edit/delete
  modals on the project detail screen) backs a new Reports & Utilization "Funnel: Consult to
  Output" card — consult volume, project created, active (first booking), milestones progressing,
  completed, and research output, with adjacent conversion % and a median time-in-stage for
  created→first-booking and first-booking→first-output. Negative day-deltas (the later event
  predating the earlier one — real for backfilled/imported projects) are excluded from the median
  but always counted and disclosed, in the card's own footnote and the exported "Notes"/"Funnel"
  sheets. Exported to XLSX as a matching "Funnel" sheet in the Reports export, an "Outputs" sheet
  in the per-project XLSX/DOCX/PDF exports, and a facility-wide "Research Outputs" listing sheet
  in the all-projects XLSX export. Every surface that lists outputs — the project screen, the
  funnel, and all three export paths — orders them by that same effective date, defined once as
  `DB.outputEffDate()`, so an output logged today with no date set sorts above an older dated one
  rather than falling to the bottom of the list.
- **Charts on the Reports screen (roadmap 3.5).** Instrument Utilisation, the Funnel, and Activity
  Mix cards each gain a hand-rolled inline SVG chart (horizontal bars, a stage funnel with
  conversion labels, and a stacked bar chart with legend) directly above their existing tables —
  no chart library, and each chart reads the exact same `Reports.compute*` result the table below
  it renders from, so a chart can never disagree with its own table. Colors come from six new
  `--chart-1`..`--chart-6` CSS custom properties (light/dark themed), so switching themes recolors
  the charts instantly with no re-render. Retired instrument names truncate the base name first
  and append the " (Retired)" suffix after truncating (never the reverse), and every bar/segment
  carries a `<title>` with the full, untruncated name. Display-only — no export changes.
- **Custom report generator (roadmap 3.6).** Reports & Utilization gains a "Custom Report" button
  opening a modal to pick an entity (Instrument Utilization, Staff Time, Projects & Groups,
  Consults, Service Entries, Stewardship, Activity Mix, Funnel, or the new row-level Bookings
  listing), a set of columns, and a date range, with a live preview table and its own "Export
  XLSX" — all driven from one declarative column map per entity in `js/reports.js`
  (`Reports.computeCustomRows`) so the preview and the export can never disagree. The date range
  always prefills from the Reports screen's own current range on every open (never a stale
  persisted value); only the last-used entity and column selection are remembered. Columns whose
  dataset repeats the same underlying entity across rows (Projects & Groups' Scope, Consults'
  Breakdown, Stewardship's Supervisor, Activity Mix's Category) render checked-and-disabled and
  are force-re-added even if omitted, so a flattened dataset can never be summed as if its rows
  were all distinct — each such dataset's duplication note appears in both the preview footnote
  and the exported workbook's Notes sheet.

### Fixed
- **Exported Research Outputs show the date they sort by.** Undated outputs displayed "—" while
  ordering (and range reasoning) used their effective date; every export path now carries that
  effective date. The two XLSX sheets mark a fallback row with "*", explained in the column header;
  the per-project DOCX and PDF write it as "(date, logged)", prose having no header to carry a
  legend.

## [1.8.0] — 2026-09-08

### Added
- **Search filter in token pickers.** Token pickers (People/Instruments/Staff/etc.) gain a
  type-to-filter search box above the dropdown, narrowing the available options without ever
  hiding an already-picked badge.
- **Per-category staff billing policy and staff requirement (roadmap item B).** A new Settings
  card lets a facility set what percent of a Facility Staff member's normal rate each booking
  category bills (e.g. discounted for training), and whether that category requires a facility
  staff assignee before it can be saved; the booking modal shows a live advisory and price note,
  and enforcement applies only to new/edited bookings so legacy history is untouched.

### Changed
- **Category "Add New" button alignment; notes toolbar simplified to bullets only.** The
  label+Add-New header on vocab/category fields (and the PI "New Member" field) now uses a
  fixed-height flex row instead of an absolute-positioned button, so the button can no longer
  overlap the label on narrow columns. The meeting notes rich-text toolbar drops Bold/Italic and
  the font-size picker, keeping only the bullet-list button; existing notes with that formatting
  still render and export unchanged.

### Fixed
- **Training's disabled Staff % no longer masquerades as the applied rate.** While "Same as
  assisted session" is on, the Category Billing row shows a live hint with the assisted-session
  percent that actually bills, updating as that value is edited.
- **Typing in a picker's search box no longer recomputes the booking cost per keystroke.** The
  cost breakdown and conflict advisory now refresh only when the actual selection changes; the
  search input also carries an accessible label.
- **Category staff percentages can't go negative.** The policy is clamped to zero at save and at
  read, so a stray minus sign can't produce negative staff lines or booking totals.
- **The requires-staff advisory honors the legacy-edit bypass.** Editing an old booking that was
  saved with a requires-staff category and no staff no longer shows a warning the save gate
  itself waives for notes-only edits.

## [1.7.0] — 2026-09-08

### Added
- **Week calendar view (roadmap 1.1).** The Calendar screen gains a Month/Week toggle alongside
  the existing Prev/Today/Next controls. Week mode shows an hourly grid (with an all-day lane for
  milestones and untimed bookings) for the Monday–Sunday of the current week; clicking an hour
  slot opens a new booking pre-filled with that hour's start/end. Month and Week share one
  milestone/meeting fetch and one event-chip renderer so the two views can never disagree, and the
  hour-grid layout math is factored out for reuse by the resource timeline (roadmap 1.3). Also
  fixes cancelled bookings not rendering with the cancelled style on the calendar (the month query
  was missing `is_cancelled`).
- **Per-instrument booking constraints (roadmap 1.3).** Instruments gain optional min/max session
  duration, minimum gap between bookings, and minimum advance notice fields on the Add/Edit
  Instrument modal (0 = unconstrained). `findBookingConflicts` enforces all four alongside the
  existing overlap checks, shared by the booking modal's live advisory and its save-time hard
  block so the two can never disagree; advance notice is skipped for notes-only edits and
  reinstating a cancelled booking so it can't retroactively fail a slot already locked in.
- **Per-instrument resource timeline (roadmap 1.4).** The Calendar screen gains a Timeline mode
  alongside Month/Week: one lane per instrument across the same Monday–Sunday week as Week mode,
  with each booking rendered as a proportional block reusing the Week grid's time-layout helpers
  at a percent-per-hour scale. Clicking an empty slot opens a new booking pre-filled with that
  lane's instrument as well as the date/time; retired instruments still show their booking history
  but are excluded from that pre-fill.
- **Recurring bookings (roadmap 1.5).** The new-booking modal gains an optional "Repeat every N
  week(s) until" field; saving generates one occurrence per date (same BOM/pricing snapshot for
  all), checking every date's conflicts up front so the save is all-or-nothing, with a 52-occurrence
  sanity cap on the schedule length.
- **Configurable pricing tiers (roadmap 2.2).** Named pricing tiers (e.g. Internal / Academia /
  Industry) replace the binary internal/external overhead pair: each is a named overhead percent,
  assignable per group/lab from the Group Discounts editor, with optional per-instrument rate
  overrides. The booking cost calculator resolves a group's assigned tier (falling back to the
  legacy Internal+External overhead sum when none is assigned, so untouched facilities are
  unaffected) and snapshots the resolved tier and percent onto the booking at save time so past
  costs never recompute. Existing `overhead_internal`/`overhead_external` settings migrate once
  into two default tiers.
- **Standalone service entries (roadmap 2.3).** Billable work can now be logged outside any
  booking — technician time, sample prep, per-unit items — as a new `service_entries` record
  (project/grant/person/instrument attribution, qty × rate → a frozen cost snapshot). Entries
  follow the same cancel-with-optional-billing-retained pattern as bookings, are counted into
  Project Costs, Reports & Utilization (new Standalone Service Entries card), and the XLSX/DOCX/PDF
  exports alongside meetings, and count toward person/instrument/project/grant reference checks so
  a referenced record retires/archives instead of deleting.

### Fixed
- **Service Entries table columns aligned.** The Reports table's rows rendered quantity and unit
  in one cell under separate Qty/Unit headers, shifting Total and Actions under the wrong headers.
- **Retired timeline lanes no longer claim an instrument prefill.** An empty slot in a retired
  instrument's lane now omits the instrument from the click-to-book shortcut's markup and tooltip,
  matching the documented intent (the picker would exclude the retired instrument anyway).
- **Editing a service entry keeps its date.** Clearing the Date field while editing stored an
  empty date that fell outside every Reports date-range filter, hiding the entry from ranged
  reports and exports; it now defaults to today, exactly as creating one does.
- **Archive dialog no longer credits all billing to bookings.** The preserved-billing figure
  includes service entries, and the copy now says so.
- **The 23:00 calendar slot no longer prefills a 59-minute booking.** The last hour slot in the
  week view and timeline leaves the end time blank instead of forcing 23:59, which could trip a
  60-minute minimum-duration constraint before the user touched anything.
- **Zero-length or inverted booking windows are rejected.** An end time at or before the start
  slipped past every conflict and constraint check (nothing could overlap an empty window); the
  live advisory and the save gate now flag it.
- **Calendar hour slots are keyboard-accessible.** Week-view and timeline click-to-book slots take
  focus, respond to Enter/Space, and carry accessible labels for screen readers. The week view's
  all-day columns got the same treatment.
- **Cancelling or reinstating a service entry closes the right modal.** Both flows closed the
  first open overlay instead of the topmost one, which could dismiss a parent modal when dialogs
  were stacked.

## [1.6.0] — 2026-09-07

### Added
- **Grants table with pickers, costs, and exports (roadmap 2.1).** A new Settings card manages
  Grants (name, number, note, an "Allowed Users" token picker backed by `grant_users`), pickable on
  the Project and Booking modals via a shared `grant_id` selector. Grants are retired rather than
  deleted once referenced (`DB.countGrantRefs`), and a Settings toggle chooses whether the app
  displays a grant by name or number everywhere — resolved through one shared `DB.grantLabel`
  helper (no denormalized grant-name column) so Project Detail, Project Costs, and the XLSX/DOCX/PDF
  exports can never disagree.
- **Live conflict feedback in the booking modal.** As instrument/staff selections and the
  date/start/end fields change, the modal now shows an as-you-type conflict advisory (or an
  all-clear line once start/end are set), reusing `findBookingConflicts` verbatim so it can never
  drift from the hard-block check `bookingSave`/`bookingEditSave` still run at save time.
- **Configurable cancellation billing rules in Settings.** A new "Cancellation Billing Rules" card
  lets each facility choose, independently for before- and after-start cancellations, whether a
  booking's charge still counts toward Project Costs — defaulting to the app's original hard-coded
  behavior (before = dropped, after = kept) so existing data behaves unchanged until configured.
  `cancelBooking`'s confirm-dialog copy is driven by the same settings so the rule described can
  never drift from the rule applied.
- **Instrument → supervising staff mapping.** Instruments can now list one or more Facility Staff
  as "Supervising Staff" via a token picker on the Add/Edit Instrument modals, backed by a new
  many-to-many `instrument_staff` join table. Supervisors show on the Instruments table, are
  searchable there, and appear in the XLSX instrument export.
- **Consult type tag on meetings (roadmap 3.1).** Bookings can now be tagged with a Category
  (sync, consult, training, assisted session — extensible via the usual "+ Add New" vocab flow),
  shown as a badge on the meeting list and included in the XLSX/DOCX/PDF exports. Reports &
  Utilization gains a "Consults" card breaking down category = "consult" bookings by instrument
  and by calendar month, backed by `Reports.computeConsultRows` and mirrored in the Reports XLSX
  export so the two can never disagree.
- **Periodic local exports into the silent backup folder (roadmap 3.7).** When an automatic backup
  writes silently into the configured backup folder, it now also drops a companion facility-wide
  XLSX export (projects, milestones, people, instruments, bookings & costs) into the same folder,
  reusing `Exports.buildAllXlsxBlob` so the XLSX content can never drift from the manual "Export
  All" report. Purely additive — any failure building or writing the XLSX is swallowed and never
  falls back to an unprompted browser download; only the JSON backup is load-bearing.

### Fixed
- **Orphaned grant references render the fallback dash, not a blank.** `grant_id` is a soft
  link, so a referenced grant row can be missing; Project Detail, the bookings table, and every
  export now decide between label and "—" from the *resolved* label rather than from `grant_id`
  alone.
- **Live conflict advisory matches the save-time date default.** The New Booking form defaults a
  blank date to today at save; the as-you-type conflict check now applies the same default (the
  edit form stores a blank date as no-date, where no conflict is possible — unchanged).

## [1.5.7] — 2026-09-07

### Fixed
- **The sidebar's collapse button was invisible on every screen** — the button, its click target
  and its tooltip were all there, but its icon rendered at 0×0, so there was nothing to see or
  aim at. An inline `<svg>` carrying only a `viewBox` has no natural size, and this one sat in one
  of the few places with no `… svg { width; height }` rule of its own. `UI.icon()` now emits a
  default `width`/`height`, which every context that sizes its own icons still overrides, so no
  icon can silently render at nothing again. The same bug was hiding the green "facility staff"
  ticks on the People table — those pills were empty.
- **Collapsing the sidebar no longer clips the logo and the expand button.** Side by side they
  don't fit a 68px rail, and the overflow was cut off by the sidebar itself; they're now stacked.
- **The dashboard's milestone feeds no longer wrap a word per line or push the due date outside
  the card.** The name, project, status pill and date were four flex items sharing one line, each
  squeezed to its narrowest, and the date was clipped by the card's edge (the row needed 315px in
  a 274px card). The name and project now stack as a title and subtitle, the pill and date stay
  together as a unit, and the row wraps rather than squeezing.
- **"Overdue milestones" showed a `+` icon.** The `alert` icon's path drew a vertical line and a
  horizontal line — a plus sign. It's now a warning triangle.
- **Sidebar footer tooltips no longer render on top of the button above them** (the last of the
  overlap fixed for the nav items in 1.5.4): "Switch to Light Mode" appeared over *Tour*. The
  footer controls now use the same native tooltips the nav items were moved to.

## [1.5.6] — 2026-09-07

### Fixed
- **Tables now scroll sideways when they don't fit, instead of squeezing their columns until the
  text breaks apart.** 1.5.5 fixed the narrow-screen switch but not the reason the switch didn't
  help: every cell carried `overflow-wrap: anywhere`, which lets a word break at *any* character
  and so drops each cell's *minimum* width to one character. A table whose minimum is one
  character per column always fits its container, so it never overflowed and never scrolled — it
  just shredded each heading into a vertical stack of letters (`R`/`A`/`T`/`E`/`H`/`R` where
  "Rate/hr" belongs). Cells now use `overflow-wrap: break-word`, which still breaks a word too
  long for its column as a last resort but leaves the minimum at the longest word, so a table
  that can't fit overflows and its wrapper scrolls.
- **Registry tables no longer force columns to a fixed share of the width regardless of what's in
  them.** `table-layout: fixed` sized columns purely from the `<col>` percentages and ignored
  content, so a column whose share was too small for its own text had nowhere to put it — the
  Instruments Status column's 8% would have needed a 1600px-wide table to fit the word
  "Maintenance", which is why that badge broke apart even on a full-width desktop window. The
  `<col>` percentages are now hints that the browser honours where the content fits and widens
  where it doesn't.

## [1.5.5] — 2026-09-06

### Fixed
- **Registry tables (Projects, People, Instruments) no longer shred their column headers into a single vertical character per line** on a narrower browser window or a higher OS/browser zoom level. The "switch to a scrollable table" fallback was gated on the full window width, which doesn't account for the sidebar eating a fixed chunk of it — it's now measured against the space actually left for the table.
- **Sidebar nav-item tooltips no longer render on top of the item above them.** They showed directly above the hovered row, which in the tightly stacked nav list landed on the previous item's label; tooltips now appear beside the item instead.

## [1.5.4] — 2026-09-06

### Fixed
- **A page could show stale content for up to 10 minutes after a deploy, on any plain navigation
  — reopening a tab, clicking back into an already-visited page — not just after a hard refresh.**
  This first surfaced as the manual's new theme-toggle button appearing once and then vanishing
  on every page, including the manual's own home page. The cause was in `sw.js`'s "network-first"
  handling of the app shell and (since this worker's scope covers the whole site) every
  `docs/manual/*.html` page: its `fetch(event.request)` still consulted the browser's own HTTP
  cache first, and GitHub Pages serves these pages with `Cache-Control: max-age=600` — so an
  ordinary navigation, as opposed to an explicit reload (which forces revalidation), could return
  a response cached before the last deploy with no network request at all. Reproduced locally
  against a server that mimics GitHub Pages' actual cache headers (the plain dev server used
  elsewhere sends none, which is why this didn't show up in testing until now), confirming both
  the bug and the fix: the shell fetch now uses `cache: 'reload'`, the same technique the
  install-time precache step already used for exactly this reason.

## [1.5.3] — 2026-09-06

### Added
- **A full user manual**, searchable and illustrated, hosted at `docs/manual/`.
- **A new Manual button in the sidebar**, linking straight to the hosted manual.
- **Browser Back/forward now works, and every screen has its own address** (`#/projects`, `#/project/12`, `#/reports`, …) so a screen can be bookmarked, reloaded, or shared between devices. Dialogs and the guided tour stay out of the URL.
- **A safety copy of your current data is downloaded automatically before a Restore** replaces the database (skipped when the database is empty), named `core-facility-pre-restore-backup-<date>.json`.
- **"Show all labs" on the booking form's Assign People picker** — tick it to invite a collaborator from another lab without switching the booking's Group/Lab. The chosen Group/Lab still decides the group discount.
- **Rename / Merge Lab tool** in Settings (Admin Mode): renames a lab everywhere at once — people, the lab's standing discount row, and the lab label saved on past bookings. Merging into an existing name keeps that name's own discount; historical booking totals are never recomputed.

### Changed
- **Milestone status is picked directly** from a small chooser (project page, dashboard lists, Today's Agenda) instead of click-cycling pending → in-progress → done.
- **"+ Add New" Lab/Group and Department values now persist immediately**, even if the form they were added from is cancelled.
- **The "Single Instrument Booking?" question has a "Don't ask me again" checkbox**; Settings → Preferences can turn the question back on.

## [1.5.2] — 2026-09-06

### Fixed
- **Installed clients were stuck on an old release even though the server was serving the new one.** A user reported that the booking form still forced them to pick the core facility as the Group/Lab before any facility staff appeared — the exact thing 1.5.1 fixed. Their Settings screen read **Version: 1.4.0** while the hosted app, every version string on it, and its service worker all said 1.5.1. The cause was in `sw.js`, not in the booking form:
  - `index.html` and `./` are the only precached URLs with **no `?v=` on them** — they are what *names* which versioned assets to load. GitHub Pages serves them with `Cache-Control: max-age=600`, and `cache.addAll()` is free to satisfy a request from the browser's own HTTP cache. So a newly-installing service worker could fill its brand-new `…-1.5.1` cache with the **previous release's** `index.html` — a shell still asking for `?v=1.4.0` files. Those weren't in the precache list, so the cache-first fetch handler fetched and cached them too. The result was a client pinned to 1.4.0 inside a correctly-named 1.5.1 cache, with no reload count able to break out of it.
  - Precaching now requests every entry with `cache: 'reload'`, so the new cache can only ever be filled from the network.
  - The HTML shell is now served **network-first** (falling back to cache when offline) instead of cache-first. Versioned assets stay cache-first — their URLs are immutable per release, so a cache hit is always correct — but the shell must be allowed to change, or a stale one keeps pointing at a stale release forever.
  - Cache lookups are now scoped to the current release's cache, so a leftover cache can never answer for it.
  Reproduced end-to-end against a server sending the same `max-age=600` GitHub Pages sends: a client on 1.4.0 stayed on 1.4.0 across three reloads with the old worker, and moved to the new release with the fixed one. Anyone currently stuck will pick this up on their next couple of reloads; from here on an update arrives on the first reload after a deploy.

## [1.5.1] — 2026-09-06

### Changed
- **The demo dataset now actually exercises the Reports screen.** 1.5.0 shipped Reports & Utilization against a demo dataset with three bookings, only one of which carried any billing data at all — so a new user loading the sample data saw one instrument of five, one staff member, no cancellations, and nothing on the third project. The feature looked broken on the very dataset meant to demonstrate it. The seed now has ten bookings covering all five instruments and three facility staff, deliberately including the cases that make each part of the report meaningful:
  - a **multi-instrument** session (parallel sample runs), the only thing that exercises the even-split staff attribution — and it reconciles: 4 staff hours across two instruments shows as 2h against each, and the row still sums to the person's true total;
  - a **per-unit** instrument line (Glacios Cryo-TEM, billed per sample rather than per hour), whose cost is correctly excluded from the discount base;
  - a **facility-wide** booking with no project, so the "Facility-wide" row is demonstrated rather than theoretical;
  - **both kinds of cancellation** — one cancelled before its start (hours and charge both drop out) and one cancelled after, with the charge retained (hours drop out, revenue stands). On the Leica SP8 these two rules visibly disagree, which is the point;
  - a **partial staff window** (40 minutes inside a four-hour booking), so worked hours and billed hours differ and the 1-hour floor is visible;
  - two consultations with **no line items**, because plenty of real sessions aren't billable.
- **Demo dates are now relative to the day the sample data is loaded** rather than hardcoded to 2025–2026. Eighteen fixed dates across projects, milestones and bookings became offsets from today, so the demo never reads as stale history and always falls inside the Reports screen's default range. Milestone statuses keep their narrative shape — completed ones in the past, upcoming ones ahead, and one deliberately overdue so the dashboard's overdue feed isn't empty.
- **Seeded cost snapshots are computed, not typed in.** `computeBookingBOM` moved from `app.js` into `ui.js` (it was already pure — times, rates and line items in, numbers out), so the seed prices its bookings with the exact calculator the booking modal uses. Every stored `subtotal` / `total_before_tax` / `total_cost` and every `line_cost` is therefore what the app itself would have written had a user entered the booking by hand, and none of it can drift if the seeded overhead or tax rates are ever changed. Verified in a browser by recomputing all ten bookings from their own line items and comparing against what was stored — and the original demo booking still prices at exactly $490 / $546.25 / $589.95, unchanged.
- A `seedBooking()` helper replaces the per-booking blocks of raw INSERTs. It builds the denormalized `meetings.attendees` display string and the `meeting_people` rows from one shared id list, so the pair cannot drift — the exact failure this project hit once before.

## [1.5.0] — 2026-09-06

### Added
- **A Reports & Utilization screen**, answering the two questions a core facility is actually asked: how much each instrument gets used, and where facility-staff time goes. Pick any date range (or This Month / This Year / All Time) and get four tables:
  - **Instrument utilisation** — bookings, booked hours, billed revenue and each instrument's share of total facility hours.
  - **Facility staff time** — sessions, hours actually worked, hours billed, and revenue per staff member. Worked and billed hours are reported separately because billing applies a 1-hour floor and rounds up to whole hours; one number is workload, the other is the invoice.
  - **Staff × instrument** — for "am I mostly helping users on one scope?". **Sessions** counts bookings unsplit, which is the figure that actually answers the question. **Attributed hours** divides a booking's staff hours evenly across every instrument on it, purely so the column reconciles against the person's true total — multi-instrument bookings are usually parallel sample runs, so that split is a bookkeeping convenience, not a claim about where the time "really" went. Both rules are stated on the card.
  - **Projects & groups** — bookings, hours and cost per project and per lab. A booking with no project is grouped as "Facility-wide".
  Two rules are applied consistently and spelled out on screen: booked hours exclude cancelled bookings entirely (a cancellation releases the slot, so the instrument was never held), while revenue follows the same retained-charge rule as Project Costs. Retired people, retired instruments and archived projects still appear — that is the point of keeping them.
- **XLSX export of the whole report**, including a Notes sheet carrying the date range and both of those rules, so an exported total can be reconciled against its rows. Screen and export are built from the same aggregation functions, so an exported figure cannot drift from the on-screen one.
- `UI.ymd()` / `UI.todayPlusDays()` for local calendar dates, and `UI.timeToMinutes` / `UI.hoursBetween` / `UI.billableStaffHours` moved into `ui.js` so the Reports screen and the booking cost calculator count hours with one shared implementation rather than two copies.
- A **"Facility staff only (N)"** filter on the People list, alongside the existing retired toggle.

### Fixed
- **The calendar showed bookings on the wrong day for anyone east of Greenwich.** A booking created on 9 September appeared in the cell captioned 9 but opened, correctly, as 8 September. The calendar built each day cell as a local-midnight date, then captioned it with the local day number while looking its bookings up under a **UTC** date string — and at a UTC+ offset local midnight falls on the previous UTC day. Replaying the cell loop under Node: at `Asia/Jerusalem` and `Europe/Paris` all 35 cells in the grid disagreed with their own caption; at `UTC` and `America/Los_Angeles` none did, which is why this went unreported for so long. The edit form had been right all along — it reads the stored date directly.
  - The same wrong date was handed to click-to-book, so clicking an empty cell opened a new booking on the previous day, and the cell's tooltip named the previous day.
  - The calendar's own query bounds carried the same shift, silently excluding the last day of the visible grid from its results.
  - Two other places used the same conversion and are fixed with it: the dashboard's 30-day upcoming-milestone window (one day short) and a project's overdue-milestone flag (could fire a day early). `UI.today()` itself returned *yesterday* between local midnight and 02:00/03:00 at UTC+ offsets, affecting every caller.
- **Un-ticking Facility Staff on a person silently deleted them from bookings they had already worked.** The booking form's staff picker only ever listed people currently flagged as Facility Staff, and saving a booking rebuilds its staff rows from whatever the form shows — so the next save of any booking that person was on destroyed their assignment *and* the billing line behind it. Confirmed end-to-end in a browser before and after the fix: pre-fix, a re-save took `meeting_staff` from one row to none, taking a $190 line with it. The picker now keeps anyone already assigned to the booking, exactly as it already did for retired staff, while still not offering them for new assignments.

### Changed
- **"Core Staff" is now "Facility Staff" everywhere**, and the forms say what the flag actually does. The person form explains that ticking it puts someone in the "Assign Facility Staff" picker and bills their hourly rate, and that researchers and lab members should be left unticked because they belong in "Assign People". Both booking modals carry a line distinguishing the two pickers and stating that only people ticked as Facility Staff appear in the staff one. The People list's column is labelled "Facility Staff" with a tooltip saying where the flag is set. No stored data changed — this is naming and help text only.

## [1.4.0] — 2026-09-05

### Changed
- **People, instruments and projects are retired or archived instead of deleted.** Deleting them destroyed historical fact: who actually attended a booking, which instrument a session actually ran on, who was PI on a project, and the billing behind a cost snapshot. None of that should disappear because someone leaves the facility or a scope is decommissioned. The delete actions are now **Retire** (people, instruments) and **Archive** (projects), which keep every existing link exactly as it is and only take the record out of the day-to-day lists.
  - Retired and archived records are labelled **(Retired)** / **Archived** everywhere they appear — lists, project team and instrument cards, milestone assignees, booking badges, and XLSX/DOCX/PDF exports (the facility-wide export gains an explicit status column). The stored name is never modified; the suffix is added at display time, so historical records read back exactly as they were entered.
  - They stop being offered when assigning new work, but stay selected wherever they already are. This matters more than it sounds: saving a milestone or a booking rebuilds its assignees from what the form shows, so a hidden assignee would have been silently dropped on the next save. Retired records still render on the forms they already belong to.
  - Lists hide them by default behind a **Show retired / Show archived (N)** toggle that only appears when there are any. The dashboard's counters and overdue alerts now cover active projects only.
  - Both are reversible with **Restore**. Only a record that nothing references at all — a typo or duplicate, with no history to protect — still offers a permanent delete.
- **On a destructive confirmation, the red button is now Cancel, not Confirm.** Colour is what the eye lands on first, and on a dialog whose whole purpose is to prevent an accident, the safe way out deserves that attention rather than the irreversible choice. The destructive action stays plainly labelled — the buttons now read "Delete", "Retire" or "Archive" instead of a generic "Confirm" — but is styled quietly. Non-destructive confirmations keep the ordinary neutral-Cancel / primary-Confirm pairing.
- **Bookings are cancelled, not deleted.** A booking is an accounting record as much as a diary entry — it says the facility held instrument and staff time on a date, and what that was worth. Cancelling keeps the booking and its line items logged, and frees the instrument and staff time so the slot can be booked by someone else. Whether the charge still stands follows when it was cancelled:
  - cancelled **before** its start time — nothing was held, so the charge is dropped from Project Costs;
  - cancelled **after** its start time — the slot was held, so the charge stands. **Admin Mode** (which already gates every other billing decision in this app) offers a three-way choice to waive it instead; without Admin Mode the charge stands and the dialog says so.
  - Cancelled bookings are badged in the project's Meetings and Project Costs cards (waived charges struck through and excluded from the running total), struck through on the calendar, and carry a Status column in the XLSX exports plus an inline marker in DOCX/PDF. **Reinstate** puts one back, re-running the double-booking check first since it starts holding its slot again.
  - A booking with no attendees, line items or cost is an empty note and can still be deleted.

### Added
- `people.is_retired` / `retired_at`, `instruments.is_retired` / `retired_at`, `projects.is_archived` / `archived_at`, and `meetings.is_cancelled` / `cancelled_at` / `billing_retained`, with additive migrations so existing databases pick them up on load.

## [1.3.9] — 2026-09-04

### Fixed
- **A custom metadata field's Edit and Delete icons were invisible and impossible to click.** On a project's Metadata & Custom Fields card, both icons are bare `<span>`s, so none of the CSS rules that size the app's inline SVG icons (`.btn svg`, `.card-title svg`, …) applied to them. Unsized inside an inline span, each SVG collapsed to 0×0 — measured in a browser, the controls were 0px wide and a click at their position landed on the row behind them, so a custom field could never be edited or removed once saved. Both icons now have a real 22×22 hit area with a 14px glyph and a hover background, fitting the row's existing 48px action column. (This also made 1.3.8's new "Delete Field" confirmation reachable — it was previously behind an unclickable icon.)

## [1.3.8] — 2026-09-04

### Fixed
- **One-click deletes now ask first.** The trash icons for meetings/bookings (in a project's meeting list), milestones, custom key-value fields, and file links deleted immediately with no confirmation — a stray tap permanently removed the record (and, for a booking, its billing line items). All four now show the same danger-styled confirmation dialog every other delete in the app already used, naming the record about to be deleted.
- **Deleting a person now fully unlinks them.** Their meeting attendee and core-staff assignments are removed, the denormalized attendee display list on affected meetings is recomputed so it no longer shows the deleted name, and any project that had them as PI has its PI cleared (that reference carries no foreign key, so nothing else would ever have cleaned it up).
- **Booking cost breakdown no longer overstates discounts.** When a group discount plus a manual discount together exceeded 100%, the actual deduction was correctly capped at 100% of the instrument-time charge, but the two summary rows still displayed their uncapped amounts. The displayed rows are now scaled so they always sum to the real deduction.

### Changed
- **The Delete Project dialog now tells the truth about meetings.** It claimed the project's "meeting records" would be deleted; they never were — bookings are kept and become facility-wide (the schema unlinks them via `ON DELETE SET NULL`). The dialog now says milestones, files, and custom fields are deleted while meetings are kept as facility-wide bookings.
- **Delete paths clean up linked records explicitly.** Deleting a project, person, instrument, or booking now removes its dependent join-table rows directly instead of relying on SQLite cascades alone — a belt-and-suspenders guard, since sql.js's `export()` silently disables foreign-key enforcement as a side effect (the app reasserts it after every autosave, verified working, but explicit cleanup survives even if a future code path forgets to). Person and instrument delete dialogs now also warn that affected bookings keep their historical cost snapshots while losing the deleted line items.
- **Documentation refresh (docs-only, no app change).** Every screenshot in `docs/screenshots/` was re-captured: the whole set still showed the pre-1.3.7 stock palette. Added shots for the new confirmation dialogs, and rewrote the hosted release-notes page (`docs/index.html`) for 1.3.7–1.3.8 — its hero, highlight cards, and screenshot walkthrough are hand-maintained rather than generated from this changelog. The README gained a "Safe deletes" section covering the same ground.

## [1.3.7] — 2026-09-04

### Changed
- **Restyled color palette and motion tokens.** Moved off the stock Tailwind indigo/violet palette (shared with other apps built on the same starting template) onto a distinct neutral/violet "Facility Design Language" system, in both light and dark themes: backgrounds, borders, text, and status colors (success/warning/danger) all recolored, with WCAG-AA-verified contrast. The logo gradient and PWA theme colors (favicon, manifest, meta tag) moved to the same violet identity. Dark-mode primary buttons now use a dedicated dark-ink text color instead of white, fixing a contrast failure against the lighter dark-mode primary. Added shared motion tokens (`--dur-fast`, `--dur-move`, `--ease`) and retargeted existing transitions to them, plus a `prefers-reduced-motion` override. No layout, typography, or component structure changes.

## [1.3.6] — 2026-09-03

### Added
- **Interactive screenshot gallery.** `docs/gallery.html` — a full-size carousel of every screenshot with prev/next controls, a thumbnail rail, keyboard and swipe navigation, and a shareable link per shot. Lists `docs/screenshots/` live from GitHub so newly added screenshots need no code change. Linked from the README's Screenshots section.

### Changed
- **Group / Lab is now required before assigning Core Staff too, not just People.** The "Assign Core Staff" picker locks the same way the "Assign People" picker already did — no group picked yet blocks it with a "Choose Group/Lab First" hint — since every core-staff member also belongs to a facility group. Dropped the "(optional)" label off the Group / Lab field itself: it's never actually skippable, since it's either picked directly or auto-filled from the project's PI.

## [1.3.5] — 2026-09-03

### Added
- **Single-instrument booking precheck.** The first time an instrument is added to a booking, a prompt asks whether only that one is needed. Answering yes locks the "Assign Instruments" picker — no further instrument can be added — until that instrument is removed from the booking.

## [1.3.4] — 2026-09-03

### Changed
- **Group / Lab is now required before assigning people to a booking.** Clicking the "Assign People" dropdown while no Group/Lab is chosen shows a not-allowed cursor and a rounded hint box ("Choose Group/Lab First") next to it instead of opening the list. Already-assigned people stay on the booking regardless (removing them, or switching labs, is never blocked); picking a Group/Lab — directly, or auto-filled from a project's PI — unlocks the dropdown immediately.

## [1.3.3] — 2026-09-03

### Fixed
- **Browser tab and bookmarks bar showed a generic globe/sphere icon instead of the app logo.** The only favicon declared was an SVG (`favicon.svg`), and Chrome's bookmarks bar (along with some other browser surfaces) doesn't render SVG-only favicons, falling back to its default globe icon. Added PNG (`icons/icon-16.png`, `icons/icon-32.png`) and `.ico` fallbacks alongside the existing SVG, plus an `apple-touch-icon`, so every surface shows the real logo. The PWA manifest also now lists PNG icons (192/512) alongside the SVG.

## [1.3.2] — 2026-09-03

### Fixed
- **"Load Sample Data" broke on the second run, silently.** `seedSampleData()` re-inserted the billing rates and the Bio-Photonics Lab group discount with a plain `INSERT`, but `clearAllData()` deliberately never clears `app_config`/`group_discounts` (they're facility settings, not sample data to wipe). Re-running it — including via the welcome screen's "Load Demo & Start Tour", which calls it on every click — hit a `UNIQUE constraint failed` that aborted the whole handler mid-flight: no toast, no dismissal, and (from the welcome screen) the tour never started, leaving it looking like the button just didn't work. Now uses the existing `DB.setConfig`/`DB.setGroupDiscount` upserts, so reseeding is safe to run any number of times.

## [1.3.1] — 2026-09-03

### Added
- **Group / Lab selector on bookings.** A new "Group / Lab" dropdown next to Project narrows the "Assign People" picker down to one lab — relief for facilities with everyone in one flat list — while already-selected people (e.g. a cross-lab collaborator) stay on the booking regardless of the filter. Picking a project auto-fills the Group from its PI's lab; it can also be set directly for a facility-wide booking.
- **The Group selector now drives the standing group discount**, offered automatically whenever a lab is chosen. In Admin Mode, a **Revoke**/**Apply** control on the discount line lets you turn it off for this booking — asking whether to remove it **just for this booking** or **for every future booking under that lab too** (the latter updates the lab's standing rate in Settings, same as editing it there directly). Re-applying restores the rate with no prompt.
- Bookings now store which Group/Lab they were made under (`group_org`), so reopening one restores its exact filter and discount state rather than re-deriving it live.

### Fixed
- No functional bug in the cost breakdown itself — a documentation screenshot of it was cropped mid-way through the summary. Re-captured showing the full Subtotal → Total breakdown.

## [1.3.0] — 2026-09-02

### Added
- **Timed instrument & core-staff bookings.** Bookings now carry an optional start/end time alongside the date. A new "Assign Core Staff" picker (people flagged as Core Staff, billable by the hour) sits alongside the existing attendee and instrument pickers.
- **Double-booking prevention.** Saving a booking is hard-blocked if any selected instrument or core-staff member already has an overlapping time window booked elsewhere the same day — the save is rejected with a message naming the clash, no override.
- **Instrument cost & billing unit.** Instruments gain a Cost field and a Unit (`time`, `unit`, `weight`, `other` — extensible like every other dropdown). Time-priced instruments bill by the booking's duration; other units bill by an amount typed into the booking.
- **Core-staff hourly rate & 1-hour billing floor.** People can be flagged as Core Staff with an hourly rate. Each assignee can be given a partial window within the booking (defaulting to the full booking); billable time is never less than 1 hour and always rounds up to the next whole hour.
- **Live Cost & Time Breakdown in the booking modal.** Every instrument/staff line, a standing per-lab group discount (auto-applied from the project's PI's lab) plus a manual admin-only override, both overhead percentages (stacked), and the resulting subtotal → before-tax → after-tax total are shown live and recomputed on every change.
- **Billing Rates & Admin Mode in Settings.** Facility-wide internal/external overhead %, tax %, and currency symbol now live in Settings. An unsecured local "Admin Mode" toggle (no accounts exist in this app) reveals the per-lab Group Discounts editor and the manual per-booking discount override.
- **Project Costs.** Each project page now lists every booking's stored cost snapshot (subtotal, before-tax, total) with a running project total.
- **Custom project statuses.** The project status list is now user-extensible via the same "+ Add New" vocabulary flow used elsewhere, seeded with a review → kickoff → billing workflow (Submitted for review, Under review, Kickoff scheduled, Invoiced, Paid, …) alongside the original statuses.
- **Cost data in exports.** Instrument cost/unit and staff rate now appear in the per-project XLSX/DOCX/PDF exports and the facility-wide export, which also gains a dedicated "Bookings & Costs" sheet.
- Calendar bookings now show and sort by start time.

## [1.2.8] — 2026-09-02

### Added
- **Email Attendees** on a meeting/booking — opens a modal listing the attendee emails, subject, and body (date, notes, action items), each with its own copy button, plus an "Open Email App" button that launches a blank `mailto:` compose window to paste them into. Available on each meeting in a project's Meetings & Syncs card, and in the Edit Booking modal footer (for facility-wide bookings with no card row of their own).

### Fixed
- **Seed/demo data** — the sample meetings only ever set the denormalized `attendees` display text, never the actual `meeting_people` link rows, so any real per-attendee feature (like Email Attendees) saw "no attendees" on demo data despite names being shown. Meetings now get the same join-table rows the seed data already gives milestones.

## [1.2.4] — 2026-08-30

### Added
- **Release Notes button** in the sidebar — opens the hosted release-notes page (`/docs/`).

### Changed
- The release-notes page now renders the **full changelog inline as HTML** instead of linking to the raw Markdown file.

## [1.2.3] — 2026-08-30

### Added
- **The app is inert during the guided tour** — clicks, typing, and text selection on the page behind the tour are blocked so you can't accidentally change data or fill in a form while looking around. Only the tour bubble (Back / Skip / Next) responds; `Esc` exits the tour.

## [1.2.2] — 2026-08-30

### Added
- **Back button in the guided tour** — step backwards to revisit an earlier step (shown from step 2 onward).

## [1.2.1] — 2026-08-30

### Fixed
- **Guided tour targeting.** The walkthrough now spotlights stable, correct elements on every step: Project Details frames the project header (PI, code, timeline, status), Milestones frames the whole milestones card, Team frames the collaborators card, and Report Generation frames the export buttons — previously these landed on the wrong element or a row deep inside the page.
- **Tour scroll race.** Positioning now runs *after* an instant scroll settles instead of racing a smooth-scroll animation, so the spotlight is always on target even if you had scrolled the page before starting the tour. A passive scroll/resize listener keeps the spotlight glued to its element for the whole step.
- View steps route to the top of the page so the sticky title bar stays in view, and the highlight box is always clamped within the viewport.

## [1.2.0] — 2026-08-29

### Added
- **Booking modal — scalable people / instrument pickers.** People and Instruments are dropdowns instead of a full inventory of toggle chips. Picking one adds a removable badge (small `×` on the left) so you always see who / what is on the meeting; the dropdown shrinks as you pick. Person badges show the role on hover, instrument badges the modality.
- **"Register New Person"** in the booking modal is a vibrant mint-green button that opens the standard person form; each new person drops straight into the People picker and you can add several in a row.
- **Lab / Group and Department are proper dropdowns with "＋ Add New"** on the person forms — pick an existing value or register a new one via a quick modal, matching the app's other editable dropdowns.
- **Department** is its own field / column on a person (was crammed into "Lab / Group / Company" behind a comma). Shows as a separate tag in the People table and exports; seed data split accordingly.
- **Rich-text meeting notes** — bullet lists, **bold** (Ctrl/Cmd+B), *italic* (Ctrl/Cmd+I), preset font sizes (Small / Normal / Large / Huge), in the app's own font. Renders formatted in-app and in Word / PDF exports; Excel / CSV get plain text. Legacy plain-text notes still display.
- **Guided tour now walks every dialog** — the 19-step walkthrough opens each real modal (New Project, Add Milestone, Custom Field, Attach File, Register Person, Add Instrument, New Booking, Today's Agenda) so you see the actual forms, and glides between steps with a soft cross-fade instead of a hard cut.

### Changed
- **No more horizontal scrollbars** — wider max content width (1440px); tables use a fixed layout with wrapping cells and balanced columns; modal bodies and calendar day-cells clip overflow instead of scrolling.
- UI action labels follow the house rule: Capitalised Each Word.
- Nested modals close the topmost dialog on Cancel / Save, not the form underneath.
- The New Project dialog's inline "Register New Person" uses the same small, gender-neutral avatar and Lab / Group dropdown as the rest of the app.

### Removed
- The separate **Meeting Link** field — paste links into Notes instead. Existing saved links stay in the database and exports but are no longer shown in the UI.

## [1.1.3] — 2026-08-29

### Changed
- **Editable dropdowns** — picking "Other" now opens the same "+ Add New" prompt as the button next to the field (instead of saving the literal text "Other"), and "Other" always sorts last in the list, after every real term. Also added "Other" to Position / Role, which was missing it.

## [1.1.2] — 2026-08-29

### Fixed
- **Orphaned records on delete** — deleting a project, person, or instrument left its linked milestones, meetings, files, and team/instrument assignments behind in the database instead of cleaning them up, despite the UI implying otherwise. Root cause: sql.js's `db.export()` (called by every autosave) silently resets the database connection's `foreign_keys` enforcement to OFF as a side effect, so `ON DELETE CASCADE` stopped firing roughly 400ms after the very first save of a session. Now reasserted after every export — cascading deletes work for the life of the session, not just before the first autosave.

## [1.1.1] — 2026-08-29

### Added
- **Editable dropdowns** — Funding Source, Modality / Technique, Sample Type, Role on Project, and Position / Role are now `<select>`s with a "+ Add New" option that opens a small modal to add a facility-wide term (saved to the database, available everywhere immediately).
- **Interactive calendar** — click any day (past or future) to create a booking on that date; bookings can be assigned any combination of people, instruments, and an optional project (or left facility-wide, unassigned to any project); a compact Notes box plus a dedicated Meeting Link field (Zoom/Meet/Teams) that renders as a clickable link.
- Instrument "Location" is now its own field, separate from "Configuration Notes".

### Changed
- Files & Attachments links now render as a bold, rounded-rectangle button with a properly sized icon (matching the app's existing card style) instead of a plain underlined URL.

### Fixed
- Projects page Actions column (Edit / Open Details buttons) — a stray `stopPropagation()` was silently blocking every click in that column from reaching the app's event handler.

## [1.1.0] — 2026-08-28

### Added
- **Duplicate project** — clone an existing project as a starting template from its detail page. Copies details, team, assigned instruments, custom fields, and milestones (reset to pending, dates cleared). Meetings and files are not copied.
- **Facility-wide export** — "Export All" on the Projects page produces a single XLSX workbook with facility-wide sheets: Projects, Milestones, People, Instruments, and Meetings.
- **Keyboard shortcuts** — `Esc` closes the topmost modal; `/` focuses the current view's search box.
- **Copy project code** — one-click copy button next to a project's code on its detail page.
- **Version display** — the app version now shows in Settings → About.

## [1.0.0] — 2026-08-27

### Added
- **Tablet support (Android / iPad)** — the app no longer shows a blank page when storage is blocked; it renders a clear "Storage unavailable" screen with OS-tailored guidance and a "Continue anyway (temporary session)" option.
- **PWA** — `manifest.json` + service worker for home-screen install and offline use when served over https.
- **GitHub Pages hosting** — `.nojekyll` and relative paths so the app can be hosted as-is.
- **First-run device notice** — up-front explanation that data is per-device (no sync), plus an independent backup-folder setup prompt.

### Changed
- Boot is now fail-visible: startup errors render a diagnostic screen instead of a silent blank page.
- All `localStorage` access is routed through a safe wrapper that falls back to memory when storage is blocked.

### Fixed
- `confirmModal` removed the wrong DOM node, leaving the modal backdrop stuck after "Start Fresh".
- Tapping outside a modal now resolves its promise instead of hanging.
