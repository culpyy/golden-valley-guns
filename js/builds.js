// ─────────────────────────────────────────────
//  GOLDEN VALLEY GUNS LLC — ACTIVE BUILD BOARD
//  Edit this file to update the In Shop page.
//
//  status options (in order):
//    "intake"        — just received, being assessed
//    "parts-ordered" — waiting on parts to arrive
//    "in-progress"   — actively being worked on
//    "testing"       — function check in progress
//    "atf-filed"     — build done, ATF transfer paperwork submitted
//    "atf-approved"  — ATF approved, cleared to transfer
//    "ready"         — done, waiting for pickup or transfer
//
//  atf_form: "Form 1", "Form 4", etc. — leave "" if not an NFA item
//  atf_filed: "YYYY-MM-DD" — date ATF paperwork was submitted, or "" if not filed yet
//
//  progress: 0–100 (percent complete, your best estimate)
//  eta: "YYYY-MM-DD" format, or "" to leave blank
//  notes: short public-facing note, or "" for none
// ─────────────────────────────────────────────

const builds = [
  {
    title: "AK-47 Parts Kit Build",
    type: "Rifle",
    caliber: "7.62x39mm",
    status: "testing",
    progress: 90,
    received: "2026-04-22",
    eta: "2026-06-15",
    atf_form: "",
    atf_filed: "",
    notes: "Assembly complete. Function check in progress."
  },
  {
    title: "Form 1 SBR Build",
    type: "Short-Barreled Rifle",
    caliber: "5.56 NATO",
    status: "atf-filed",
    progress: 95,
    received: "2026-03-10",
    eta: "2026-07-20",
    atf_form: "Form 1",
    atf_filed: "2026-06-01",
    notes: "Build and function check complete. ATF Form 1 submitted. Awaiting approval."
  },
  {
    title: "Custom AR-15 Pistol Build",
    type: "Pistol",
    caliber: "300 Blackout",
    status: "in-progress",
    progress: 55,
    received: "2026-05-05",
    eta: "2026-06-28",
    atf_form: "",
    atf_filed: "",
    notes: "Upper assembled. BCG and brace fitting in progress."
  },
  {
    title: "Glock 17 Trigger & Sight Job",
    type: "Pistol",
    caliber: "9mm Parabellum",
    status: "parts-ordered",
    progress: 15,
    received: "2026-05-28",
    eta: "2026-07-05",
    atf_form: "",
    atf_filed: "",
    notes: "Trigger group and night sights on order."
  },
  {
    title: "Remington 870 Refurb",
    type: "Shotgun",
    caliber: "12 Gauge",
    status: "intake",
    progress: 5,
    received: "2026-06-07",
    eta: "",
    atf_form: "",
    atf_filed: "",
    notes: "Assessment in progress. Quote within 48 hours."
  }
];
