import { sql } from "./helpers";

// The development database persists between runs; leftovers from earlier runs
// (old background jobs, opt-outs for the example addresses) would skew these tests.
export default function globalSetup() {
  sql("DELETE FROM river.river_job");
  sql("DELETE FROM suppression WHERE email LIKE '%@acme.com'");
}
