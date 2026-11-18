import type { Card } from "../src/model/adapters.js";

/** ORD-FIX-PB-1 (design 7.2), in the scrambled insertion order. */
export const ORD_FIXTURE: ReadonlyArray<readonly [string, Card]> = [
  ["card-c3", { title: "Write tests", notes: "", placement: "doing|00002048" }],
  ["card-f6", { title: "Ship v1", notes: "", placement: "done|00001024" }],
  ["card-a1", { title: "Draft spec", notes: "", placement: "todo|00002048" }],
  ["card-B2", { title: "Review spec", notes: "", placement: "todo|00002048" }],
  ["card-e5", { title: "Collect notes", notes: "", placement: "todo|00000512" }],
  ["card-a", { title: "Plan sprint", notes: "", placement: "todo|00002048" }],
  ["card-d4", { title: "Set up repo", notes: "", placement: "doing|00001024" }],
  ["card-b2", { title: "Estimate work", notes: "", placement: "todo|00002048" }],
  ["card-g7", { title: "Tag release", notes: "", placement: "done|00001024" }],
  ["card-h8", { title: "Build UI", notes: "", placement: "doing|00002048" }],
];

// Hand-derived (design 7.2). Never computed with an app helper.
export const ORD_TODO_EXPECTED = ["card-e5", "card-B2", "card-a", "card-a1", "card-b2"];
export const ORD_DOING_EXPECTED = ["card-d4", "card-c3", "card-h8"];
export const ORD_DONE_EXPECTED = ["card-f6", "card-g7"];
export const ORD_TODO_CONCURRENT_EXPECTED = ["card-e5", "card-B2", "card-a", "card-a1", "card-b2", "card-n1", "card-n2"];