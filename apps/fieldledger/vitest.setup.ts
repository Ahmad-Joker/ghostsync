import fc from "fast-check";

// Same global property-test discipline as the capsule suite: fixed seed, 200 runs.
fc.configureGlobal({ numRuns: 200, seed: 424242 });
