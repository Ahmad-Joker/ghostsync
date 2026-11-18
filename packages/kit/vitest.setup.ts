import fc from "fast-check";

// Correction 2: use fast-check's supported global options only.
// `seed` and `numRuns` are valid; `baseSeed` and `verbose: 2` are not used.
fc.configureGlobal({ numRuns: 200, seed: 424242 });
