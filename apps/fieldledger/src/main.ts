import "./styles.css";
import { initOfflineReadiness } from "./offline/sw-register.js";
import { SessionController } from "./session/session-controller.js";
import { AppView } from "./ui/app-view.js";

const root = document.getElementById("app");
if (root === null) throw new Error("FieldLedger: #app missing");

let view: AppView | undefined;
const controller = new SessionController(
  localStorage,
  () => view?.render(),
  (text) => view?.announce(text),
);
view = new AppView(root, controller);
// Offline readiness and persistence are independent: neither calls the other.
view.setOfflineHandle(initOfflineReadiness((s) => view?.setOffline(s)));
view.render();
void controller.start(window.location.hash);
