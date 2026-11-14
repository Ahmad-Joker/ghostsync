import { createKit, type Replica } from "@ghostsync/kit";
import { cardAdapter } from "../src/model/adapters.js";
import { readBoard } from "../src/model/read-model.js";
import { SessionController } from "../src/session/session-controller.js";

/** The private members a test fills (by cast) to drive the controller without a browser. */
export interface Seams {
  phase: string;
  cards: unknown;
  replicaId: string;
  boardId: string;
  session: unknown;
  onSaveState(state: string, info: { sequence: number }): void;
}

export interface ControllerFixture {
  readonly c: SessionController;
  readonly replica: Replica;
  readonly notified: () => number;
}

/** A controller whose `cards` is the given wrapper of the real collection. */
export function controllerOver(wrap: <T extends object>(col: T) => T = (c) => c): ControllerFixture {
  const replica = createKit().createReplica("test-board");
  const real = replica.collection(cardAdapter);
  let n = 0;
  const c = new SessionController({} as Storage, () => n++, () => undefined);
  const s = c as unknown as Seams;
  s.phase = "ready";
  s.replicaId = "replica-1";
  s.boardId = "test-board";
  s.cards = wrap(real);
  c.model = readBoard(real);
  return { c, replica, notified: () => n };
}