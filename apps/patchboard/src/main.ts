import "./styles.css";
import { decodeCapsule } from "@ghostsync/capsule";
import { chooseScale, createScanSession } from "@ghostsync/qr-transfer/browser";
import { initOfflineReadiness } from "./offline/sw-register.js";
import { SessionController } from "./session/session-controller.js";
import { QrTransferController } from "./transfer/qr/qr-controller.js";
import { AppView } from "./ui/app-view.js";

const root = document.getElementById("app");
if (root === null) throw new Error("PatchBoard: #app missing");

let view: AppView | undefined;
const controller = new SessionController(
  localStorage,
  () => view?.render(),
  (text, channel) => view?.announce(text, channel),
);
const qr = new QrTransferController(
  controller,
  { createScan: (cb) => createScanSession({}, cb), decodeCapsule, chooseScale },
  () => view?.render(),
);
view = new AppView(root, controller, qr);
// Offline readiness and persistence are independent: neither calls the other.
view.setOfflineHandle(initOfflineReadiness((s) => view?.setOffline(s)));
view.render();
void controller.start(window.location.hash);
