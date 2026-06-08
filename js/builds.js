// ─────────────────────────────────────────────
//  GOLDEN VALLEY GUNS LLC — ACTIVE BUILD BOARD
//  Edit this file to update the In Shop page.
//
//  status options:
//    "intake"        — just received, being looked over
//    "parts-ordered" — waiting on parts to arrive
//    "in-progress"   — actively being worked on
//    "testing"       — function check in progress
//    "ready"         — done, waiting for customer pickup
//
//  progress: 0–100 (percent complete, your best estimate)
//  eta: "YYYY-MM-DD" format, or "" to leave blank
//  notes: short public-facing note, or "" for none
// ─────────────────────────────────────────────

const builds = [
  {
    title: "Custom AR-15 Pistol Build",
    type: "Pistol",
    caliber: "5.56 NATO",
    status: "in-progress",
    progress: 55,
    received: "2025-05-20",
    eta: "2025-06-20",
    notes: "Upper assembled. Waiting on brace and BCG."
  },
  {
    title: "Glock 19 Trigger Job",
    type: "Pistol",
    caliber: "9mm Parabellum",
    status: "ready",
    progress: 100,
    received: "2025-05-15",
    eta: "2025-06-01",
    notes: "Complete. Contact us to arrange pickup."
  },
  {
    title: "Remington 870 Refurb",
    type: "Shotgun",
    caliber: "12 Gauge",
    status: "parts-ordered",
    progress: 20,
    received: "2025-06-01",
    eta: "2025-06-28",
    notes: "New stock and forend on order."
  },
  {
    title: "AK-47 Parts Kit Build",
    type: "Rifle",
    caliber: "7.62×39mm",
    status: "intake",
    progress: 5,
    received: "2025-06-05",
    eta: "",
    notes: "Assessment in progress. Will call with quote."
  }
];
