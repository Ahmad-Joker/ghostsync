---
inclusion: always
---

# Testing

- **Require actual test outputs.** Run the suite and capture pass/fail and counts; do not report "should work" claims as results.
- Required coverage:
  - **Convergence** after all updates arrive.
  - **Duplicate import safety** — importing the same update twice is a no-op.
  - **Update ordering** — out-of-order arrival still converges.
  - **Persistence after reload** — state survives a reload.
  - **Invalid capsules** — malformed/oversized/unknown-version inputs are rejected without corrupting state.
  - **Offline behavior** — apps work with no network.
- Use **property-based tests** for merge invariants (commutativity, associativity, idempotency).
- Use **distinct browser profiles** for transfer tests — sender and receiver run in isolated sessions/profiles.
